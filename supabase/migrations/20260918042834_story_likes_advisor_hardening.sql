-- Story likes are available only through RPCs that validate the authenticated
-- identity. This explicit deny policy documents that boundary for the advisor.
create policy community_story_likes_no_direct_access
  on public.community_story_likes
  for all to authenticated using(false) with check(false);
