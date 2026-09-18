-- Feed deletion has two paths: player-owned posts are retained for 24 hours,
-- while master deletions are permanent and queue the private image cleanup.

alter table public.community_posts
  add column archived_at timestamptz;

create index community_posts_archived_expiry_idx
  on public.community_posts(archived_at)
  where archived_at is not null;

drop policy community_posts_read on public.community_posts;
create policy community_posts_read on public.community_posts
  for select to authenticated using(
    public.is_member(campaign_id)
    and (archived_at is null or public.is_master(campaign_id))
  );

drop policy community_post_likes_read on public.community_post_likes;
create policy community_post_likes_read on public.community_post_likes
  for select to authenticated using(exists(
    select 1 from public.community_posts post
    where post.id=post_id
      and public.is_member(post.campaign_id)
      and (post.archived_at is null or public.is_master(post.campaign_id))
  ));

drop policy community_post_comments_read on public.community_post_comments;
create policy community_post_comments_read on public.community_post_comments
  for select to authenticated using(exists(
    select 1 from public.community_posts post
    where post.id=post_id
      and public.is_member(post.campaign_id)
      and (post.archived_at is null or public.is_master(post.campaign_id))
  ));

drop policy community_comment_likes_read on public.community_comment_likes;
create policy community_comment_likes_read on public.community_comment_likes
  for select to authenticated using(exists(
    select 1
    from public.community_post_comments comment
    join public.community_posts post on post.id=comment.post_id
    where comment.id=comment_id
      and public.is_member(post.campaign_id)
      and (post.archived_at is null or public.is_master(post.campaign_id))
  ));

drop policy community_post_media_read on storage.objects;
create policy community_post_media_read on storage.objects
  for select to authenticated using(
    bucket_id='community-posts'
    and exists(
      select 1 from public.community_posts post
      where post.image_path=storage.objects.name
        and public.is_member(post.campaign_id)
        and (post.archived_at is null or public.is_master(post.campaign_id))
    )
  );

create table public.community_post_cleanup(
  image_path text primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  queued_at timestamptz not null default now()
);

create index community_post_cleanup_campaign_idx
  on public.community_post_cleanup(campaign_id);
create index community_post_cleanup_queued_idx
  on public.community_post_cleanup(queued_at);

alter table public.community_post_cleanup enable row level security;
create policy community_post_cleanup_no_direct_access
  on public.community_post_cleanup
  for all to authenticated using(false) with check(false);
grant all on public.community_post_cleanup to service_role;
grant select,delete on public.community_posts to service_role;

create function alvorecer_private.can_manage_community_post_media(
  path text,
  require_queue boolean default false
) returns boolean language sql stable security definer
set search_path=public,storage as $$
  select exists(
    select 1 from public.social_identities identity
    where identity.campaign_id::text=(storage.foldername(path))[1]
      and identity.id::text=(storage.foldername(path))[2]
      and (
        (
          public.is_master(identity.campaign_id)
          and (
            not require_queue
            or exists(
              select 1 from public.community_post_cleanup cleanup
              where cleanup.image_path=path
                and cleanup.campaign_id=identity.campaign_id
            )
          )
        )
        or (
          not require_queue
          and identity.user_id=(select auth.uid())
          and not exists(
            select 1 from public.community_posts post
            where post.image_path=path
          )
        )
      )
  )
$$;

revoke all on function alvorecer_private.can_manage_community_post_media(
  text,boolean
) from public,anon;
grant usage on schema alvorecer_private to authenticated,service_role;
grant execute on function alvorecer_private.can_manage_community_post_media(
  text,boolean
) to authenticated,service_role;

drop policy community_post_media_delete on storage.objects;
create policy community_post_media_delete on storage.objects
  for delete to authenticated using(
    bucket_id='community-posts'
    and (select alvorecer_private.can_manage_community_post_media(
      storage.objects.name
    ))
  );

create policy community_post_media_cleanup_read on storage.objects
  for select to authenticated using(
    bucket_id='community-posts'
    and (select alvorecer_private.can_manage_community_post_media(
      storage.objects.name,true
    ))
  );

create function alvorecer_private.queue_community_post_media()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.community_post_cleanup(image_path,campaign_id)
  values(old.image_path,old.campaign_id)
  on conflict(image_path) do update set queued_at=now();
  return old;
end$$;

create trigger community_post_queue_media
after delete on public.community_posts
for each row execute function alvorecer_private.queue_community_post_media();

create or replace function public.community_feed(c uuid,requested_actor uuid)
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
begin
  actor:=alvorecer_private.require_community_actor(c,requested_actor);
  return query
  select post.id,post.campaign_id,post.author_id,profile.username,
    post.image_path,post.caption,post.created_at,
    (select count(*) from public.community_post_likes likes where likes.post_id=post.id),
    (select count(*) from public.community_post_comments comments where comments.post_id=post.id),
    exists(
      select 1 from public.community_post_likes likes
      where likes.post_id=post.id and likes.identity_id=actor.id
    )
  from public.community_posts post
  join public.social_identities identity on identity.id=post.author_id
  left join public.profiles profile on profile.id=identity.user_id
  where post.campaign_id=c and post.archived_at is null
  order by post.created_at desc,post.id desc
  limit 100;
end$$;

create function public.community_archived_posts(c uuid)
returns table(
  id uuid,
  author_id uuid,
  author_name text,
  author_username text,
  image_path text,
  caption text,
  created_at timestamptz,
  archived_at timestamptz,
  expires_at timestamptz
)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_master(c) then raise exception 'Sem permissão'; end if;
  return query
  select post.id,post.author_id,identity.name,profile.username,
    post.image_path,post.caption,post.created_at,post.archived_at,
    post.archived_at+interval '24 hours'
  from public.community_posts post
  join public.social_identities identity on identity.id=post.author_id
  left join public.profiles profile on profile.id=identity.user_id
  where post.campaign_id=c
    and post.archived_at is not null
    and post.archived_at>now()-interval '24 hours'
  order by post.archived_at desc,post.id desc;
end$$;

create or replace function public.community_post_comments(
  c uuid,
  target_post uuid,
  requested_actor uuid
)
returns table(
  id uuid,
  post_id uuid,
  author_id uuid,
  author_username text,
  parent_id uuid,
  body text,
  created_at timestamptz,
  like_count bigint,
  viewer_liked boolean
)
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
begin
  actor:=alvorecer_private.require_community_actor(c,requested_actor);
  if not exists(
    select 1 from public.community_posts post
    where post.id=target_post and post.campaign_id=c
      and post.archived_at is null
  ) then raise exception 'Publicação inválida'; end if;

  return query
  select comment.id,comment.post_id,comment.author_id,profile.username,
    comment.parent_id,comment.body,comment.created_at,
    (select count(*) from public.community_comment_likes likes where likes.comment_id=comment.id),
    exists(
      select 1 from public.community_comment_likes likes
      where likes.comment_id=comment.id and likes.identity_id=actor.id
    )
  from public.community_post_comments comment
  join public.social_identities identity on identity.id=comment.author_id
  left join public.profiles profile on profile.id=identity.user_id
  where comment.post_id=target_post
  order by coalesce(comment.parent_id,comment.id),
    (comment.parent_id is not null),comment.created_at,comment.id;
end$$;

create or replace function public.community_feed_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.social_identities;
declare target_post_record public.community_posts;
declare result_id uuid;
declare target_post uuid;
declare target_comment uuid;
declare requested_parent uuid;
declare active boolean;
declare archived boolean;
declare deleted boolean;
declare media_path text;
declare content text;
begin
  actor:=alvorecer_private.require_community_actor(c,(d->>'actor_id')::uuid);

  if op='create_post' then
    media_path:=trim(coalesce(d->>'image_path',''));
    content:=trim(coalesce(d->>'caption',''));
    if char_length(content) not between 1 and 2000 then
      raise exception 'Escreva uma legenda de até 2000 caracteres';
    end if;
    if media_path not like c::text||'/'||actor.id::text||'/%'
       or storage.extension(media_path)<>'webp' then
      raise exception 'Imagem da publicação inválida';
    end if;
    if not exists(
      select 1 from storage.objects object
      where object.bucket_id='community-posts' and object.name=media_path
    ) then raise exception 'Envie a foto antes de publicar'; end if;

    insert into public.community_posts(campaign_id,author_id,image_path,caption)
    values(c,actor.id,media_path,content)
    returning id into result_id;
    active:=true;

  elsif op='delete_post' then
    select post.* into target_post_record
    from public.community_posts post
    where post.id=(d->>'post_id')::uuid
      and post.campaign_id=c
    for update;
    if target_post_record.id is null then
      raise exception 'Publicação inválida';
    end if;

    if public.is_master(c) then
      delete from public.community_posts where id=target_post_record.id;
      deleted:=true;
      archived:=false;
      media_path:=target_post_record.image_path;
    elsif target_post_record.author_id=actor.id
      and target_post_record.archived_at is null then
      update public.community_posts
      set archived_at=now()
      where id=target_post_record.id;
      deleted:=false;
      archived:=true;
    else
      raise exception 'Sem permissão para excluir esta publicação';
    end if;
    result_id:=target_post_record.id;
    active:=false;

  elsif op='confirm_post_cleanup' then
    if not public.is_master(c) then raise exception 'Sem permissão'; end if;
    media_path:=trim(coalesce(d->>'image_path',''));
    if media_path not like c::text||'/%' then
      raise exception 'Imagem da publicação inválida';
    end if;
    if exists(
      select 1 from storage.objects object
      where object.bucket_id='community-posts' and object.name=media_path
    ) then raise exception 'A imagem ainda não foi removida'; end if;
    delete from public.community_post_cleanup cleanup
    where cleanup.image_path=media_path and cleanup.campaign_id=c;
    active:=false;

  elsif op='post_like' then
    target_post:=(d->>'post_id')::uuid;
    if not exists(
      select 1 from public.community_posts post
      where post.id=target_post and post.campaign_id=c
        and post.archived_at is null
    ) then raise exception 'Publicação inválida'; end if;

    delete from public.community_post_likes
    where post_id=target_post and identity_id=actor.id;
    if found then active:=false;
    else
      insert into public.community_post_likes(post_id,identity_id)
      values(target_post,actor.id);
      active:=true;
    end if;
    result_id:=target_post;

  elsif op='comment' then
    target_post:=(d->>'post_id')::uuid;
    content:=trim(coalesce(d->>'body',''));
    requested_parent:=nullif(d->>'parent_id','')::uuid;
    if char_length(content) not between 1 and 1000 then
      raise exception 'Escreva um comentário de até 1000 caracteres';
    end if;
    if not exists(
      select 1 from public.community_posts post
      where post.id=target_post and post.campaign_id=c
        and post.archived_at is null
    ) then raise exception 'Publicação inválida'; end if;
    if requested_parent is not null and not exists(
      select 1 from public.community_post_comments comment
      where comment.id=requested_parent and comment.post_id=target_post
        and comment.parent_id is null
    ) then raise exception 'Comentário principal inválido'; end if;

    insert into public.community_post_comments(post_id,author_id,parent_id,body)
    values(target_post,actor.id,requested_parent,content)
    returning id into result_id;
    active:=true;

  elsif op='comment_like' then
    target_comment:=(d->>'comment_id')::uuid;
    if not exists(
      select 1
      from public.community_post_comments comment
      join public.community_posts post on post.id=comment.post_id
      where comment.id=target_comment and post.campaign_id=c
        and post.archived_at is null
    ) then raise exception 'Comentário inválido'; end if;

    delete from public.community_comment_likes
    where comment_id=target_comment and identity_id=actor.id;
    if found then active:=false;
    else
      insert into public.community_comment_likes(comment_id,identity_id)
      values(target_comment,actor.id);
      active:=true;
    end if;
    result_id:=target_comment;

  else raise exception 'Ação de feed inválida';
  end if;

  update public.campaign_events
  set revision=revision+1 where campaign_id=c;
  return jsonb_strip_nulls(jsonb_build_object(
    'id',result_id,'active',active,'archived',archived,'deleted',deleted,
    'image_path',media_path
  ));
end$$;

revoke all on function public.community_archived_posts(uuid)
  from public,anon,authenticated;
grant execute on function public.community_archived_posts(uuid)
  to authenticated;

revoke all on function public.community_feed_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_feed_action(uuid,text,jsonb)
  to authenticated;
