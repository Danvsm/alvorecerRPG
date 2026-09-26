-- Deliberately public aggregate only. Definer access avoids granting visitors
-- access to membership or private application records. No arbitrary campaign input.
create or replace function public.public_recruitment_counts()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'registeredPlayers', (
      select count(distinct member.user_id)
      from public.campaign_members member
      join public.campaigns campaign on campaign.id = member.campaign_id
      where campaign.name = 'A Promessa do Amanhecer'
        and member.role = 'player'
        and member.access_active
        and member.archived_at is null
    ),
    'applications', (
      select count(*) from alvorecer_private.recruitment_applications
      where campaign_name = 'A Promessa do Amanhecer'
    )
  );
$$;
revoke all on function public.public_recruitment_counts() from public, anon, authenticated;
grant execute on function public.public_recruitment_counts() to anon, authenticated, service_role;
