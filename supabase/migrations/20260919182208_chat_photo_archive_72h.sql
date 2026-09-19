alter table public.chat_media
  add column if not exists archive_expires_at timestamptz,
  add column if not exists removed_from_chat_at timestamptz;

update public.chat_media
set archive_expires_at = created_at + interval '72 hours'
where archive_expires_at is null;

alter table public.chat_media
  alter column archive_expires_at set default (now() + interval '72 hours'),
  alter column archive_expires_at set not null;

create index if not exists chat_media_archive_expiry_idx
  on public.chat_media(archive_expires_at)
  where deleted_at is null;

drop policy if exists chat_image_read on storage.objects;

create policy chat_image_read
on storage.objects
for select
to authenticated
using (
  bucket_id='chat-media'
  and exists (
    select 1
    from public.chat_media media
    join public.direct_conversations conversation
      on conversation.id=media.conversation_id
    where media.storage_path=storage.objects.name
      and media.deleted_at is null
      and (
        (
          media.removed_from_chat_at is null
          and media.expires_at>now()
          and public.can_converse(media.conversation_id)
        )
        or (
          media.archive_expires_at>now()
          and public.is_master(conversation.campaign_id)
        )
      )
  )
);

create or replace function public.master_chat_media_archive(c uuid)
returns table(
  id uuid,
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_name text,
  first_name text,
  second_name text,
  storage_path text,
  created_at timestamptz,
  chat_expires_at timestamptz,
  archive_expires_at timestamptz,
  removed_from_chat_at timestamptz,
  message_deleted_at timestamptz,
  message_cleared_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode acessar o arquivo de fotos';
  end if;

  return query
  select
    media.id,
    message.id,
    media.conversation_id,
    media.sender_id,
    sender.name,
    first_identity.name,
    second_identity.name,
    media.storage_path,
    media.created_at,
    media.expires_at,
    media.archive_expires_at,
    media.removed_from_chat_at,
    message.deleted_at,
    message.cleared_at
  from public.chat_media media
  join public.direct_messages message
    on message.media_id=media.id
  join public.direct_conversations conversation
    on conversation.id=media.conversation_id
  join public.social_identities sender
    on sender.id=media.sender_id
  join public.social_identities first_identity
    on first_identity.id=conversation.first_id
  join public.social_identities second_identity
    on second_identity.id=conversation.second_id
  where conversation.campaign_id=c
    and media.consumed=true
    and media.deleted_at is null
    and media.archive_expires_at>now()
  order by media.created_at desc,media.id desc
  limit 200;
end
$function$;

revoke all on function public.master_chat_media_archive(uuid) from public;
revoke all on function public.master_chat_media_archive(uuid) from anon;
grant execute on function public.master_chat_media_archive(uuid) to authenticated;
