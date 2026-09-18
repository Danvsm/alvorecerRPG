-- Internal Story tables are writable only through validated SECURITY DEFINER
-- functions. Explicit deny policies document that boundary and satisfy the RLS
-- advisor without exposing direct Data API access.
create policy community_story_views_no_direct_access
  on public.community_story_views
  for all to authenticated using(false) with check(false);

create policy community_story_cleanup_no_direct_access
  on public.community_story_cleanup
  for all to authenticated using(false) with check(false);

create index community_story_cleanup_campaign_idx
  on public.community_story_cleanup(campaign_id);
