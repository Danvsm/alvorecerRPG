create index if not exists activity_sessions_online_lookup_idx
  on public.activity_sessions(campaign_id, user_id, last_heartbeat_at desc)
  where ended_at is null;

create or replace function public.community_presence(c uuid)
returns table(user_id uuid, online boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  return query
  select
    identity.user_id,
    exists(
      select 1
      from public.activity_sessions session
      where session.campaign_id = c
        and session.user_id = identity.user_id
        and session.ended_at is null
        and session.last_heartbeat_at > now() - interval '2 minutes'
    ) as online
  from public.social_identities identity
  join public.campaign_members member
    on member.campaign_id = identity.campaign_id
   and member.user_id = identity.user_id
  where identity.campaign_id = c
    and identity.user_id is not null
    and identity.active
    and member.access_active
    and member.archived_at is null
  order by identity.user_id;
end
$$;

revoke all on function public.community_presence(uuid) from public, anon;
grant execute on function public.community_presence(uuid)
  to authenticated, service_role;
