
alter table public.community_profile_settings
  add column if not exists session_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.community_profile_settings'::regclass
      and conname='community_profile_settings_session_count_check'
  ) then
    alter table public.community_profile_settings
      add constraint community_profile_settings_session_count_check
      check (session_count between 0 and 999999);
  end if;
end
$$;

create or replace function public.community_profile(
  c uuid,
  requested_actor uuid,
  target_identity uuid
)
returns table(
  identity_id uuid,
  username text,
  bio text,
  post_count bigint,
  session_count bigint,
  achievement_count bigint,
  medal_count bigint,
  wealth_rank bigint,
  viewer_following boolean,
  can_edit boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  actor public.social_identities;
  target public.social_identities;
begin
  actor:=alvorecer_private.require_community_actor(c,requested_actor);

  select identity.*
  into target
  from public.social_identities identity
  where identity.id=target_identity
    and identity.campaign_id=c
    and identity.active;

  if target.id is null then
    raise exception 'Perfil indisponível';
  end if;

  return query
  select
    target.id,
    profile.username,
    coalesce(settings.bio,''),
    (
      select count(*)
      from public.community_posts post
      where post.author_id=target.id
        and post.campaign_id=c
        and post.archived_at is null
    ),
    coalesce(settings.session_count,0)::bigint,
    0::bigint,
    (
      select count(*)
      from public.cosmetic_grants grant_row
      join public.cosmetics cosmetic
        on cosmetic.id=grant_row.cosmetic_id
      where grant_row.identity_id=target.id
        and grant_row.removed_at is null
        and cosmetic.kind='medal'
    ),
    (
      select ranking.rank
      from public.wealth_ranking(c) ranking
      where ranking.identity_id=target.id
    ),
    exists(
      select 1
      from public.community_profile_follows follow_row
      where follow_row.follower_identity_id=actor.id
        and follow_row.followed_identity_id=target.id
    ),
    actor.id=target.id
  from (values(1)) seed(value)
  left join public.profiles profile
    on profile.id=target.user_id
  left join public.community_profile_settings settings
    on settings.identity_id=target.id;
end
$function$;

create or replace function public.master_profile_session_catalog(c uuid)
returns table(
  identity_id uuid,
  name text,
  username text,
  kind text,
  session_count integer
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_master(c) then
    raise exception 'Somente o Mestre pode gerenciar sessões';
  end if;

  return query
  select
    identity.id,
    identity.name,
    profile.username,
    identity.kind,
    coalesce(settings.session_count,0)
  from public.social_identities identity
  left join public.profiles profile
    on profile.id=identity.user_id
  left join public.community_profile_settings settings
    on settings.identity_id=identity.id
  where identity.campaign_id=c
    and identity.active
    and identity.user_id is not null
    and identity.kind in ('master','player')
  order by
    case when identity.kind='master' then 0 else 1 end,
    lower(identity.name),
    identity.id;
end
$function$;

create or replace function public.master_profile_session_set(
  c uuid,
  target_identity uuid,
  session_total integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  target public.social_identities;
  previous_count integer;
begin
  if (select auth.uid()) is null or not public.is_master(c) then
    raise exception 'Somente o Mestre pode editar sessões';
  end if;

  if session_total is null or session_total < 0 or session_total > 999999 then
    raise exception 'Quantidade de sessões inválida';
  end if;

  select identity.*
  into target
  from public.social_identities identity
  where identity.id=target_identity
    and identity.campaign_id=c
    and identity.active
    and identity.user_id is not null
    and identity.kind in ('master','player');

  if target.id is null then
    raise exception 'Perfil inválido';
  end if;

  select coalesce(settings.session_count,0)
  into previous_count
  from (values(1)) seed(value)
  left join public.community_profile_settings settings
    on settings.identity_id=target.id;

  insert into public.community_profile_settings(
    identity_id,
    bio,
    session_count,
    updated_at
  )
  values(
    target.id,
    '',
    session_total,
    now()
  )
  on conflict(identity_id) do update
  set
    session_count=excluded.session_count,
    updated_at=excluded.updated_at;

  perform public.record_event(
    c,
    null,
    'profile_sessions_changed',
    jsonb_build_object(
      'identity_id',target.id,
      'name',target.name,
      'before',previous_count,
      'after',session_total
    ),
    (select auth.uid())
  );

  return jsonb_build_object(
    'identity_id',target.id,
    'session_count',session_total,
    'previous_count',previous_count
  );
end
$function$;

revoke all on function public.master_profile_session_catalog(uuid)
  from public,anon;
grant execute on function public.master_profile_session_catalog(uuid)
  to authenticated,service_role;

revoke all on function public.master_profile_session_set(uuid,uuid,integer)
  from public,anon;
grant execute on function public.master_profile_session_set(uuid,uuid,integer)
  to authenticated,service_role;
