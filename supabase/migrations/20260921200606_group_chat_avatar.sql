alter table public.campaign_group_chats
  add column if not exists avatar_storage_path text,
  add column if not exists avatar_updated_at timestamptz;

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'group-avatars',
  'group-avatars',
  false,
  262144,
  array['image/webp']
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists group_avatar_read on storage.objects;
create policy group_avatar_read
on storage.objects
for select
to authenticated
using(
  bucket_id='group-avatars'
  and public.is_member(((storage.foldername(storage.objects.name))[1])::uuid)
);

drop policy if exists group_avatar_insert on storage.objects;
create policy group_avatar_insert
on storage.objects
for insert
to authenticated
with check(
  bucket_id='group-avatars'
  and storage.extension(storage.objects.name)='webp'
  and (storage.foldername(storage.objects.name))[2]='groups'
  and public.is_master(((storage.foldername(storage.objects.name))[1])::uuid)
);

drop policy if exists group_avatar_delete on storage.objects;
create policy group_avatar_delete
on storage.objects
for delete
to authenticated
using(
  bucket_id='group-avatars'
  and public.is_master(((storage.foldername(storage.objects.name))[1])::uuid)
);

grant update(avatar_storage_path,avatar_updated_at)
on public.campaign_group_chats
to authenticated;

drop policy if exists campaign_group_chat_master_avatar_update
  on public.campaign_group_chats;
create policy campaign_group_chat_master_avatar_update
on public.campaign_group_chats
for update
to authenticated
using(public.is_master(campaign_id))
with check(public.is_master(campaign_id));

create or replace function public.campaign_group_avatar_set(
  c uuid,
  actor_id uuid,
  storage_path text
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  target_group uuid;
  previous_path text;
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode alterar a foto do grupo';
  end if;

  if storage_path is null
     or storage_path not like c::text||'/groups/%.webp' then
    raise exception 'Arquivo da foto do grupo inválido';
  end if;

  select
    group_chat.id,
    group_chat.avatar_storage_path
  into
    target_group,
    previous_path
  from public.campaign_group_chats group_chat
  where group_chat.campaign_id=c
  for update;

  if target_group is null then
    raise exception 'Grupo da campanha não encontrado';
  end if;

  update public.campaign_group_chats
  set avatar_storage_path=storage_path,
      avatar_updated_at=now()
  where id=target_group;

  return jsonb_build_object(
    'id',target_group,
    'storage_path',storage_path,
    'previous_path',previous_path
  );
end
$$;

revoke all on function public.campaign_group_avatar_set(uuid,uuid,text)
  from public,anon;
grant execute on function public.campaign_group_avatar_set(uuid,uuid,text)
  to authenticated;

create or replace function public.campaign_group_summary(c uuid, actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  target_group uuid;
  group_name text;
  group_avatar text;
  group_avatar_updated timestamptz;
  latest public.campaign_group_messages;
  last_read_at timestamptz;
  unread_count bigint;
  member_count bigint;
begin
  actor:=alvorecer_private.require_group_actor(c,actor_id);
  target_group:=alvorecer_private.ensure_campaign_group(c);

  select
    group_chat.name,
    group_chat.avatar_storage_path,
    group_chat.avatar_updated_at
  into
    group_name,
    group_avatar,
    group_avatar_updated
  from public.campaign_group_chats group_chat
  where group_chat.id=target_group;

  select message.* into latest
  from public.campaign_group_messages message
  where message.group_id=target_group
  order by message.created_at desc
  limit 1;

  select receipt.read_at into last_read_at
  from public.campaign_group_reads receipt
  where receipt.group_id=target_group and receipt.identity_id=actor.id;

  select count(*) into unread_count
  from public.campaign_group_messages message
  where message.group_id=target_group
    and message.sender_id<>actor.id
    and message.created_at>coalesce(last_read_at,'-infinity'::timestamptz);

  select count(*) into member_count
  from public.social_identities identity
  where identity.campaign_id=c
    and identity.active
    and identity.user_id is not null
    and identity.kind in ('player','master');

  return jsonb_build_object(
    'id',target_group,
    'name',coalesce(group_name,'Bar do Pink'),
    'avatar_storage_path',group_avatar,
    'avatar_updated_at',group_avatar_updated,
    'member_count',member_count,
    'unread',unread_count,
    'latest_id',latest.id,
    'latest_sender_id',latest.sender_id,
    'latest_body',latest.body,
    'latest_created_at',latest.created_at
  );
end
$$;

revoke all on function public.campaign_group_summary(uuid,uuid)
  from public,anon;
grant execute on function public.campaign_group_summary(uuid,uuid)
  to authenticated;
