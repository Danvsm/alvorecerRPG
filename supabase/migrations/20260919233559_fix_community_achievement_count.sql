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
    0::bigint,
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

revoke all on function public.community_profile(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.community_profile(uuid,uuid,uuid)
  to authenticated,service_role;
