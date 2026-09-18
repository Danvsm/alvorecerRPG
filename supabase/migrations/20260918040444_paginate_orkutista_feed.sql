-- Cursor pagination keeps the initial Orkutista feed light and fetches more
-- posts only as the player scrolls.

create index community_posts_feed_cursor_idx
  on public.community_posts(campaign_id,created_at desc,id desc)
  where archived_at is null;

create function public.community_feed_page(
  c uuid,
  requested_actor uuid,
  cursor_created_at timestamptz default null,
  cursor_id uuid default null,
  page_size integer default 6
)
returns table(
  id uuid,
  campaign_id uuid,
  author_id uuid,
  author_username text,
  image_path text,
  caption text,
  created_at timestamptz,
  like_count bigint,
  comment_count bigint,
  viewer_liked boolean
)
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
declare safe_page_size integer;
begin
  actor:=alvorecer_private.require_community_actor(c,requested_actor);
  if (cursor_created_at is null)<>(cursor_id is null) then
    raise exception 'Cursor do feed inválido';
  end if;
  safe_page_size:=least(greatest(coalesce(page_size,6),1),20);

  return query
  select post.id,post.campaign_id,post.author_id,profile.username,
    post.image_path,post.caption,post.created_at,
    (select count(*) from public.community_post_likes likes
      where likes.post_id=post.id),
    (select count(*) from public.community_post_comments comments
      where comments.post_id=post.id),
    exists(
      select 1 from public.community_post_likes likes
      where likes.post_id=post.id and likes.identity_id=actor.id
    )
  from public.community_posts post
  join public.social_identities identity on identity.id=post.author_id
  left join public.profiles profile on profile.id=identity.user_id
  where post.campaign_id=c
    and post.archived_at is null
    and (
      cursor_created_at is null
      or (post.created_at,post.id)<(cursor_created_at,cursor_id)
    )
  order by post.created_at desc,post.id desc
  limit safe_page_size;
end$$;

revoke all on function public.community_feed_page(
  uuid,uuid,timestamptz,uuid,integer
) from public,anon;
grant execute on function public.community_feed_page(
  uuid,uuid,timestamptz,uuid,integer
) to authenticated;
