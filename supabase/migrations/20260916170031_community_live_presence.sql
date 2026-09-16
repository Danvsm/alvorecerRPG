create table alvorecer_private.presence_sessions(
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_heartbeat_at timestamptz not null default now(),
  ended_at timestamptz
);

alter table alvorecer_private.presence_sessions enable row level security;
revoke all on table alvorecer_private.presence_sessions
  from public, anon, authenticated;

create index presence_sessions_online_lookup_idx
  on alvorecer_private.presence_sessions(
    campaign_id,
    user_id,
    last_heartbeat_at desc
  )
  where ended_at is null;

create function public.presence_ping(c uuid, session_id uuid, online boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, alvorecer_private
as $$
declare
  actor_id uuid := (select auth.uid());
  previous alvorecer_private.presence_sessions;
begin
  if actor_id is null or not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select * into previous
  from alvorecer_private.presence_sessions session
  where session.id = session_id
  for update;

  if previous.id is null then
    insert into alvorecer_private.presence_sessions(
      id,
      campaign_id,
      user_id,
      ended_at
    ) values(
      session_id,
      c,
      actor_id,
      case when online then null else now() end
    );
  else
    if previous.campaign_id <> c or previous.user_id <> actor_id then
      raise exception 'Sessão inválida';
    end if;

    update alvorecer_private.presence_sessions session
    set last_heartbeat_at = now(),
        ended_at = case when online then null else now() end
    where session.id = session_id;
  end if;

  return jsonb_build_object('online', online);
end
$$;

revoke all on function public.presence_ping(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.presence_ping(uuid, uuid, boolean)
  to authenticated, service_role;

create or replace function public.community_presence(c uuid)
returns table(user_id uuid, online boolean)
language plpgsql
stable
security definer
set search_path = public, alvorecer_private
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
      from alvorecer_private.presence_sessions session
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
