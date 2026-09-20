create or replace function public.community_rankings(c uuid)
returns table(
  identity_id uuid,
  wealth_rank bigint,
  session_rank bigint,
  achievement_rank bigint,
  medal_rank bigint,
  session_count bigint,
  achievement_count bigint,
  medal_count bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_member(c) then
    raise exception 'Acesso negado';
  end if;

  return query
  with eligible as (
    select
      identity.id as identity_id,
      identity.name,
      (
        coalesce(member.dracmas_cents,0)
        + coalesce((
          select sum(character.dracmas_cents)
          from public.characters character
          where character.campaign_id=c
            and character.owner_id=identity.user_id
            and not character.archived
        ),0)
      )::bigint as wealth_cents,
      coalesce(settings.session_count,0)::bigint as session_count,
      coalesce((
        select count(*)
        from public.cosmetic_grants grant_row
        join public.cosmetics cosmetic
          on cosmetic.id=grant_row.cosmetic_id
        where grant_row.identity_id=identity.id
          and grant_row.removed_at is null
          and (
            grant_row.origin='achievement'
            or cosmetic.acquisition_origin='achievement'
          )
      ),0)::bigint as achievement_count,
      coalesce((
        select count(*)
        from public.cosmetic_grants grant_row
        join public.cosmetics cosmetic
          on cosmetic.id=grant_row.cosmetic_id
        where grant_row.identity_id=identity.id
          and grant_row.removed_at is null
          and cosmetic.kind='medal'
      ),0)::bigint as medal_count
    from public.social_identities identity
    join public.campaign_members member
      on member.campaign_id=identity.campaign_id
      and member.user_id=identity.user_id
      and member.access_active
    left join public.community_profile_settings settings
      on settings.identity_id=identity.id
    where identity.campaign_id=c
      and identity.active
      and identity.user_id is not null
      and identity.kind in ('master','player')
  )
  select
    eligible.identity_id,
    row_number() over(
      order by eligible.wealth_cents desc,lower(eligible.name),eligible.identity_id
    ) as wealth_rank,
    row_number() over(
      order by eligible.session_count desc,lower(eligible.name),eligible.identity_id
    ) as session_rank,
    row_number() over(
      order by eligible.achievement_count desc,lower(eligible.name),eligible.identity_id
    ) as achievement_rank,
    row_number() over(
      order by eligible.medal_count desc,lower(eligible.name),eligible.identity_id
    ) as medal_rank,
    eligible.session_count,
    eligible.achievement_count,
    eligible.medal_count
  from eligible;
end
$function$;

revoke all on function public.community_rankings(uuid)
  from public,anon;
grant execute on function public.community_rankings(uuid)
  to authenticated,service_role;
