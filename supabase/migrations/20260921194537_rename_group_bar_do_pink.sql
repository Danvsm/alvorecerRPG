update public.campaign_group_chats
set name='Bar do Pink'
where name is distinct from 'Bar do Pink';

create or replace function alvorecer_private.ensure_campaign_group(c uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare target_group uuid;
begin
  insert into public.campaign_group_chats(campaign_id,name)
  values(c,'Bar do Pink')
  on conflict(campaign_id) do update
    set name='Bar do Pink'
  returning id into target_group;
  return target_group;
end
$$;

revoke all on function alvorecer_private.ensure_campaign_group(uuid)
  from public,anon,authenticated;
grant execute on function alvorecer_private.ensure_campaign_group(uuid)
  to service_role;

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
  latest public.campaign_group_messages;
  last_read_at timestamptz;
  unread_count bigint;
  member_count bigint;
begin
  actor:=alvorecer_private.require_group_actor(c,actor_id);
  target_group:=alvorecer_private.ensure_campaign_group(c);

  select group_chat.name into group_name
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
