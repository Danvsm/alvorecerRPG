create or replace function public.campaign_group_messages(
  c uuid,
  actor_id uuid,
  page_size integer default 50
)
returns table(
  id uuid,
  group_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  target_group uuid;
begin
  actor:=alvorecer_private.require_group_actor(c,actor_id);

  select group_chat.id
    into target_group
  from public.campaign_group_chats group_chat
  where group_chat.campaign_id=c;

  if target_group is null then
    raise exception 'Grupo da campanha não encontrado';
  end if;

  return query
  select
    message.id,
    message.group_id,
    message.sender_id,
    message.body,
    message.created_at
  from public.campaign_group_messages message
  where message.group_id=target_group
  order by message.created_at desc
  limit greatest(1,least(coalesce(page_size,50),200));
end
$$;

revoke all on function public.campaign_group_messages(uuid,uuid,integer)
  from public,anon;
grant execute on function public.campaign_group_messages(uuid,uuid,integer)
  to authenticated;
