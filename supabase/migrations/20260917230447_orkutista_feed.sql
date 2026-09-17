-- Orkutista home feed: one-photo posts, likes, comments and one-level replies.

create table public.community_posts(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author_id uuid not null references public.social_identities(id) on delete cascade,
  image_path text not null unique,
  caption text not null check(char_length(trim(caption)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table public.community_post_likes(
  post_id uuid not null references public.community_posts(id) on delete cascade,
  identity_id uuid not null references public.social_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,identity_id)
);

create table public.community_post_comments(
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references public.social_identities(id) on delete cascade,
  parent_id uuid references public.community_post_comments(id) on delete cascade,
  body text not null check(char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table public.community_comment_likes(
  comment_id uuid not null references public.community_post_comments(id) on delete cascade,
  identity_id uuid not null references public.social_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(comment_id,identity_id)
);

create index community_posts_campaign_date_idx
  on public.community_posts(campaign_id,created_at desc);
create index community_posts_author_idx on public.community_posts(author_id);
create index community_post_likes_identity_idx
  on public.community_post_likes(identity_id);
create index community_post_comments_post_date_idx
  on public.community_post_comments(post_id,created_at);
create index community_post_comments_parent_idx
  on public.community_post_comments(parent_id) where parent_id is not null;
create index community_post_comments_author_idx
  on public.community_post_comments(author_id);
create index community_comment_likes_identity_idx
  on public.community_comment_likes(identity_id);

alter table public.community_posts enable row level security;
alter table public.community_post_likes enable row level security;
alter table public.community_post_comments enable row level security;
alter table public.community_comment_likes enable row level security;

create policy community_posts_read on public.community_posts
  for select to authenticated
  using(public.is_member(campaign_id));

create policy community_post_likes_read on public.community_post_likes
  for select to authenticated
  using(exists(
    select 1 from public.community_posts p
    where p.id=post_id and public.is_member(p.campaign_id)
  ));

create policy community_post_comments_read on public.community_post_comments
  for select to authenticated
  using(exists(
    select 1 from public.community_posts p
    where p.id=post_id and public.is_member(p.campaign_id)
  ));

create policy community_comment_likes_read on public.community_comment_likes
  for select to authenticated
  using(exists(
    select 1
    from public.community_post_comments comment
    join public.community_posts post on post.id=comment.post_id
    where comment.id=comment_id and public.is_member(post.campaign_id)
  ));

grant select on public.community_posts,public.community_post_likes,
  public.community_post_comments,public.community_comment_likes to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-posts','community-posts',false,1048576,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=1048576,
  allowed_mime_types=array['image/webp'];

create policy community_post_media_read on storage.objects
  for select to authenticated using(
    bucket_id='community-posts'
    and exists(
      select 1 from public.community_posts post
      where post.image_path=storage.objects.name
        and public.is_member(post.campaign_id)
    )
  );

create policy community_post_media_insert on storage.objects
  for insert to authenticated with check(
    bucket_id='community-posts'
    and storage.extension(name)='webp'
    and exists(
      select 1 from public.social_identities identity
      where identity.campaign_id::text=(storage.foldername(storage.objects.name))[1]
        and identity.id::text=(storage.foldername(storage.objects.name))[2]
        and identity.active
        and (
          identity.user_id=(select auth.uid())
          or (
            identity.user_id is null
            and public.is_master(identity.campaign_id)
          )
        )
    )
  );

create policy community_post_media_delete on storage.objects
  for delete to authenticated using(
    bucket_id='community-posts'
    and not exists(
      select 1 from public.community_posts post
      where post.image_path=storage.objects.name
    )
    and exists(
      select 1 from public.social_identities identity
      where identity.campaign_id::text=(storage.foldername(storage.objects.name))[1]
        and identity.id::text=(storage.foldername(storage.objects.name))[2]
        and identity.active
        and (
          identity.user_id=(select auth.uid())
          or (
            identity.user_id is null
            and public.is_master(identity.campaign_id)
          )
        )
    )
  );

create function alvorecer_private.require_community_actor(
  c uuid,
  requested uuid
) returns public.social_identities
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
begin
  if (select auth.uid()) is null or not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select identity.* into actor
  from public.social_identities identity
  where identity.id=requested
    and identity.campaign_id=c
    and identity.active
    and (
      identity.user_id=(select auth.uid())
      or (
        identity.user_id is null
        and public.is_master(c)
      )
    );

  if actor.id is null then raise exception 'Identidade inválida'; end if;
  return actor;
end$$;

revoke all on function alvorecer_private.require_community_actor(uuid,uuid)
  from public,anon,authenticated;

create function alvorecer_private.enforce_community_reply()
returns trigger language plpgsql set search_path=public as $$
declare parent_post uuid;
declare parent_parent uuid;
begin
  if new.parent_id is null then return new; end if;

  select post_id,parent_id into parent_post,parent_parent
  from public.community_post_comments
  where id=new.parent_id;

  if parent_post is null or parent_post<>new.post_id then
    raise exception 'Comentário principal inválido';
  end if;
  if parent_parent is not null then
    raise exception 'Respostas aceitam somente um nível';
  end if;
  return new;
end$$;

create trigger community_reply_depth
before insert or update of parent_id,post_id on public.community_post_comments
for each row execute function alvorecer_private.enforce_community_reply();

create function public.community_feed(c uuid,requested_actor uuid)
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
    post.image_path,post.caption,
    post.created_at,
    (select count(*) from public.community_post_likes likes where likes.post_id=post.id),
    (select count(*) from public.community_post_comments comments where comments.post_id=post.id),
    exists(
      select 1 from public.community_post_likes likes
      where likes.post_id=post.id and likes.identity_id=actor.id
    )
  from public.community_posts post
  join public.social_identities identity on identity.id=post.author_id
  left join public.profiles profile on profile.id=identity.user_id
  where post.campaign_id=c
  order by post.created_at desc,post.id desc
  limit 100;
end$$;

create function public.community_post_comments(
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
  ) then raise exception 'Publicação inválida'; end if;

  return query
  select comment.id,comment.post_id,comment.author_id,profile.username,
    comment.parent_id,
    comment.body,comment.created_at,
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

create function public.community_feed_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.social_identities;
declare result_id uuid;
declare target_post uuid;
declare target_comment uuid;
declare requested_parent uuid;
declare active boolean;
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

  elsif op='post_like' then
    target_post:=(d->>'post_id')::uuid;
    if not exists(
      select 1 from public.community_posts post
      where post.id=target_post and post.campaign_id=c
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
  return jsonb_build_object('id',result_id,'active',active);
end$$;

revoke all on function public.community_feed(uuid,uuid) from public,anon;
revoke all on function public.community_post_comments(uuid,uuid,uuid)
  from public,anon;
revoke all on function public.community_feed_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_feed(uuid,uuid) to authenticated;
grant execute on function public.community_post_comments(uuid,uuid,uuid)
  to authenticated;
grant execute on function public.community_feed_action(uuid,text,jsonb)
  to authenticated;
