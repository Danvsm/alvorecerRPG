alter table public.chat_media
  add column if not exists media_type text not null default 'image',
  add column if not exists mime_type text,
  add column if not exists byte_size bigint,
  add column if not exists duration_ms integer,
  add column if not exists waveform smallint[],
  add column if not exists verified_at timestamptz,
  add column if not exists upload_expires_at timestamptz
    not null default (now() + interval '15 minutes');

alter table public.chat_media
  drop constraint if exists chat_media_type_check,
  add constraint chat_media_type_check
    check (media_type in ('image','audio')),
  drop constraint if exists chat_media_byte_size_check,
  add constraint chat_media_byte_size_check
    check (byte_size is null or byte_size between 1 and 3145728),
  drop constraint if exists chat_media_duration_check,
  add constraint chat_media_duration_check
    check (duration_ms is null or duration_ms between 250 and 300000),
  drop constraint if exists chat_media_waveform_check,
  add constraint chat_media_waveform_check
    check (waveform is null or cardinality(waveform) between 1 and 64),
  drop constraint if exists chat_audio_complete_when_consumed_check,
  add constraint chat_audio_complete_when_consumed_check
    check (
      media_type <> 'audio'
      or not consumed
      or (
        mime_type in ('audio/webm','audio/ogg','audio/mp4')
        and byte_size is not null
        and duration_ms is not null
        and verified_at is not null
      )
    );

create index if not exists chat_media_audio_expiry_idx
  on public.chat_media(expires_at)
  where media_type='audio' and deleted_at is null;

create index if not exists chat_media_pending_upload_idx
  on public.chat_media(upload_expires_at)
  where consumed=false and deleted_at is null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'chat-audio',
  'chat-audio',
  false,
  3145728,
  array['audio/webm','audio/ogg','audio/mp4']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists chat_audio_insert on storage.objects;
create policy chat_audio_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id='chat-audio'
  and storage.extension(name)=any(array['webm','ogg','m4a'])
  and exists (
    select 1
    from public.chat_media media
    where media.storage_path=storage.objects.name
      and media.media_type='audio'
      and media.uploader_id=(select auth.uid())
      and not media.consumed
      and media.deleted_at is null
      and media.upload_expires_at>now()
      and public.can_converse(media.conversation_id)
  )
);

drop policy if exists chat_audio_read on storage.objects;
create policy chat_audio_read
on storage.objects
for select
to authenticated
using (
  bucket_id='chat-audio'
  and exists (
    select 1
    from public.chat_media media
    join public.direct_conversations conversation
      on conversation.id=media.conversation_id
    where media.storage_path=storage.objects.name
      and media.media_type='audio'
      and media.consumed
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

create or replace function public.chat_audio_reserve(
  c uuid,
  actor_id uuid,
  conversation_id uuid,
  requested_mime text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.social_identities;
  conversation public.direct_conversations;
  media public.chat_media;
  normalized_mime text;
  extension text;
  media_id uuid;
begin
  if not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select * into actor
  from public.social_identities identity
  where identity.id=actor_id
    and identity.campaign_id=c
    and identity.active;

  if actor.id is null
     or (
       actor.user_id is distinct from (select auth.uid())
       and not (actor.kind='npc' and public.is_master(c))
     ) then
    raise exception 'Identidade não autorizada';
  end if;

  select * into conversation
  from public.direct_conversations direct_conversation
  where direct_conversation.id=conversation_id
    and direct_conversation.campaign_id=c;

  if conversation.id is null
     or actor.id not in(conversation.first_id,conversation.second_id) then
    raise exception 'Conversa não autorizada';
  end if;

  normalized_mime:=split_part(lower(trim(requested_mime)),';',1);
  extension:=case normalized_mime
    when 'audio/webm' then 'webm'
    when 'audio/ogg' then 'ogg'
    when 'audio/mp4' then 'm4a'
    else null
  end;

  if extension is null then
    raise exception 'Formato de áudio não permitido';
  end if;

  if not public.throttle(
    'chat_audio_upload:'||(select auth.uid())::text,
    20
  ) then
    raise exception 'Limite temporário de áudios atingido';
  end if;

  media_id:=gen_random_uuid();
  insert into public.chat_media(
    id,
    conversation_id,
    sender_id,
    uploader_id,
    storage_path,
    media_type,
    mime_type,
    expires_at,
    archive_expires_at,
    upload_expires_at
  )
  values(
    media_id,
    conversation.id,
    actor.id,
    (select auth.uid()),
    conversation.id::text||'/'||media_id::text||'.'||extension,
    'audio',
    normalized_mime,
    now()+interval '7 days',
    now()+interval '10 days',
    now()+interval '15 minutes'
  )
  returning * into media;

  return jsonb_build_object(
    'id',media.id,
    'path',media.storage_path,
    'mime_type',media.mime_type,
    'upload_expires_at',media.upload_expires_at
  );
end
$function$;

revoke all on function public.chat_audio_reserve(uuid,uuid,uuid,text)
  from public,anon;
grant execute on function public.chat_audio_reserve(uuid,uuid,uuid,text)
  to authenticated;

create or replace function public.finalize_chat_audio(
  p_campaign_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_media_id uuid,
  p_mime_type text,
  p_byte_size bigint,
  p_duration_ms integer,
  p_waveform smallint[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.social_identities;
  conversation public.direct_conversations;
  media public.chat_media;
  message_id uuid;
  recipient uuid;
begin
  if p_byte_size not between 1 and 3145728
     or p_duration_ms not between 250 and 300000
     or p_mime_type not in ('audio/webm','audio/ogg','audio/mp4')
     or (p_waveform is not null and cardinality(p_waveform) not between 1 and 64)
     or exists(select 1 from unnest(coalesce(p_waveform,array[]::smallint[])) point where point not between 0 and 100) then
    raise exception 'Áudio inválido';
  end if;

  if not exists(
    select 1
    from public.campaign_members member
    where member.campaign_id=p_campaign_id
      and member.user_id=p_user_id
      and member.access_active
      and member.archived_at is null
  ) then
    raise exception 'Acesso à campanha desativado';
  end if;

  select * into actor
  from public.social_identities identity
  where identity.id=p_actor_id
    and identity.campaign_id=p_campaign_id
    and identity.active;

  if actor.id is null
     or (
       actor.user_id is distinct from p_user_id
       and not (
         actor.kind='npc'
         and exists(
           select 1
           from public.campaign_members member
           where member.campaign_id=p_campaign_id
             and member.user_id=p_user_id
             and member.role='master'
             and member.access_active
             and member.archived_at is null
         )
       )
     ) then
    raise exception 'Identidade não autorizada';
  end if;

  select * into media
  from public.chat_media candidate
  where candidate.id=p_media_id
  for update;

  if media.id is null
     or media.media_type<>'audio'
     or media.sender_id<>actor.id
     or media.uploader_id<>p_user_id
     or media.mime_type<>p_mime_type
     or media.upload_expires_at<=now()
     or media.expires_at<=now()
     or media.deleted_at is not null then
    raise exception 'Áudio indisponível';
  end if;

  if media.consumed then
    select message.id into message_id
    from public.direct_messages message
    where message.media_id=media.id;
    return jsonb_build_object('id',message_id,'media_id',media.id);
  end if;

  select * into conversation
  from public.direct_conversations direct_conversation
  where direct_conversation.id=media.conversation_id
    and direct_conversation.campaign_id=p_campaign_id;

  if conversation.id is null
     or actor.id not in(conversation.first_id,conversation.second_id) then
    raise exception 'Conversa não autorizada';
  end if;

  if not exists(
    select 1
    from storage.objects object
    where object.bucket_id='chat-audio'
      and object.name=media.storage_path
  ) then
    raise exception 'Envio do áudio incompleto';
  end if;

  update public.chat_media
  set byte_size=p_byte_size,
      duration_ms=p_duration_ms,
      waveform=p_waveform,
      verified_at=now(),
      consumed=true
  where id=media.id;

  insert into public.direct_messages(
    conversation_id,sender_id,body,media_id
  )
  values(media.conversation_id,actor.id,'',media.id)
  returning id into message_id;

  select identity.user_id into recipient
  from public.social_identities identity
  where identity.id=case
    when conversation.first_id=actor.id then conversation.second_id
    else conversation.first_id
  end;

  if recipient is not null
     and not exists(
       select 1
       from public.conversation_mutes mute
       where mute.conversation_id=conversation.id
         and mute.user_id=recipient
     ) then
    insert into public.notifications(
      campaign_id,user_id,kind,title,body,reference_id
    )
    values(
      p_campaign_id,
      recipient,
      'message',
      'Nova mensagem de voz',
      'Entre no Alvorecer para ouvir.',
      conversation.id::text
    );
  end if;

  perform public.record_event(
    p_campaign_id,
    null,
    'social_audio',
    jsonb_build_object('id',message_id,'duration_ms',p_duration_ms),
    p_user_id
  );

  return jsonb_build_object('id',message_id,'media_id',media.id);
end
$function$;

revoke all on function public.finalize_chat_audio(
  uuid,uuid,uuid,uuid,text,bigint,integer,smallint[]
) from public,anon,authenticated;
grant execute on function public.finalize_chat_audio(
  uuid,uuid,uuid,uuid,text,bigint,integer,smallint[]
) to service_role;

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
  join public.direct_messages message on message.media_id=media.id
  join public.direct_conversations conversation
    on conversation.id=media.conversation_id
  join public.social_identities sender on sender.id=media.sender_id
  join public.social_identities first_identity
    on first_identity.id=conversation.first_id
  join public.social_identities second_identity
    on second_identity.id=conversation.second_id
  where conversation.campaign_id=c
    and media.media_type='image'
    and media.consumed=true
    and media.deleted_at is null
    and media.archive_expires_at>now()
  order by media.created_at desc,media.id desc
  limit 200;
end
$function$;

revoke all on function public.master_chat_media_archive(uuid) from public,anon;
grant execute on function public.master_chat_media_archive(uuid)
  to authenticated;
