-- Story reactions are private: only the author and campaign master can inspect
-- the audience, while each authenticated player can toggle only their own like.
create table public.community_story_likes(
  story_id uuid not null references public.community_stories(id) on delete cascade,
  identity_id uuid not null references public.social_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(story_id,identity_id)
);

create index community_story_likes_identity_idx
  on public.community_story_likes(identity_id);

alter table public.community_story_likes enable row level security;
grant all on public.community_story_likes to service_role;

drop function public.community_stories(uuid,uuid);

create function public.community_stories(c uuid,requested_actor uuid)
returns table(
  id uuid,
  campaign_id uuid,
  author_id uuid,
  author_username text,
  image_path text,
  created_at timestamptz,
  expires_at timestamptz,
  viewer_seen boolean,
  viewer_liked boolean,
  like_count bigint,
  view_count bigint
)
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
declare can_see_audience boolean;
begin
  actor:=alvorecer_private.require_story_actor(c,requested_actor);
  can_see_audience:=public.is_master(c);

  return query
  select story.id,story.campaign_id,story.author_id,profile.username,
    story.image_path,story.created_at,story.expires_at,
    exists(
      select 1 from public.community_story_views views
      where views.story_id=story.id and views.identity_id=actor.id
    ),
    exists(
      select 1 from public.community_story_likes likes
      where likes.story_id=story.id and likes.identity_id=actor.id
    ),
    case when story.author_id=actor.id or can_see_audience then
      (select count(*) from public.community_story_likes likes
       where likes.story_id=story.id)
    else 0::bigint end,
    case when story.author_id=actor.id or can_see_audience then
      (select count(*) from public.community_story_views views
       where views.story_id=story.id)
    else 0::bigint end
  from public.community_stories story
  join public.social_identities identity on identity.id=story.author_id
  left join public.profiles profile on profile.id=identity.user_id
  where story.campaign_id=c and story.expires_at>now()
  order by min(story.created_at) over(partition by story.author_id),
    story.created_at,story.id;
end$$;

create or replace function public.community_story_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.social_identities;
declare target_story public.community_stories;
declare result_id uuid;
declare media_path text;
declare active boolean;
begin
  actor:=alvorecer_private.require_story_actor(c,(d->>'actor_id')::uuid);

  if op='create_story' then
    media_path:=trim(coalesce(d->>'image_path',''));
    if media_path not like c::text||'/'||actor.id::text||'/%'
       or storage.extension(media_path)<>'webp' then
      raise exception 'Imagem do Story inválida';
    end if;
    if not exists(
      select 1 from storage.objects object
      where object.bucket_id='community-stories' and object.name=media_path
    ) then raise exception 'Envie a imagem antes de publicar'; end if;

    insert into public.community_stories(
      campaign_id,author_id,image_path,created_at,expires_at
    ) values(c,actor.id,media_path,now(),now()+interval '24 hours')
    returning id into result_id;
    active:=true;

  elsif op='view_story' then
    select story.* into target_story
    from public.community_stories story
    where story.id=(d->>'story_id')::uuid
      and story.campaign_id=c
      and story.expires_at>now();
    if target_story.id is null then raise exception 'Story indisponível'; end if;

    insert into public.community_story_views(story_id,identity_id,viewed_at)
    values(target_story.id,actor.id,now())
    on conflict(story_id,identity_id)
    do update set viewed_at=excluded.viewed_at;
    result_id:=target_story.id;
    active:=true;

  elsif op='like_story' then
    select story.* into target_story
    from public.community_stories story
    where story.id=(d->>'story_id')::uuid
      and story.campaign_id=c
      and story.expires_at>now();
    if target_story.id is null then raise exception 'Story indisponível'; end if;

    delete from public.community_story_likes likes
    where likes.story_id=target_story.id and likes.identity_id=actor.id;
    if found then
      active:=false;
    else
      insert into public.community_story_likes(story_id,identity_id)
      values(target_story.id,actor.id);
      active:=true;
    end if;
    result_id:=target_story.id;

  elsif op='delete_story' then
    select story.* into target_story
    from public.community_stories story
    where story.id=(d->>'story_id')::uuid and story.campaign_id=c
    for update;
    if target_story.id is null then raise exception 'Story indisponível'; end if;
    if target_story.author_id<>actor.id and not public.is_master(c) then
      raise exception 'Sem permissão para excluir este Story';
    end if;

    delete from public.community_stories where id=target_story.id;
    result_id:=target_story.id;
    media_path:=target_story.image_path;
    active:=false;

  elsif op='confirm_story_cleanup' then
    media_path:=trim(coalesce(d->>'image_path',''));
    if media_path not like c::text||'/%' then
      raise exception 'Imagem do Story inválida';
    end if;
    if exists(
      select 1 from storage.objects object
      where object.bucket_id='community-stories' and object.name=media_path
    ) then raise exception 'A imagem ainda não foi removida'; end if;
    delete from public.community_story_cleanup cleanup
    where cleanup.image_path=media_path and cleanup.campaign_id=c;
    active:=false;

  else raise exception 'Ação de Story inválida';
  end if;

  update public.campaign_events
  set revision=revision+1 where campaign_id=c;
  return jsonb_strip_nulls(jsonb_build_object(
    'id',result_id,'active',active,'image_path',media_path
  ));
end$$;

create function public.community_story_audience(
  c uuid,target_story uuid,requested_actor uuid
)
returns table(
  identity_id uuid,
  name text,
  username text,
  viewed_at timestamptz,
  liked_at timestamptz
)
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
declare story public.community_stories;
begin
  actor:=alvorecer_private.require_story_actor(c,requested_actor);
  select item.* into story
  from public.community_stories item
  where item.id=target_story and item.campaign_id=c and item.expires_at>now();

  if story.id is null then raise exception 'Story indisponível'; end if;
  if story.author_id<>actor.id and not public.is_master(c) then
    raise exception 'Sem permissão para ver o público deste Story';
  end if;

  return query
  with participants as (
    select views.identity_id
    from public.community_story_views views
    where views.story_id=story.id
    union
    select likes.identity_id
    from public.community_story_likes likes
    where likes.story_id=story.id
  )
  select identity.id,identity.name,profile.username,
    views.viewed_at,likes.created_at
  from participants participant
  join public.social_identities identity on identity.id=participant.identity_id
  left join public.profiles profile on profile.id=identity.user_id
  left join public.community_story_views views
    on views.story_id=story.id and views.identity_id=identity.id
  left join public.community_story_likes likes
    on likes.story_id=story.id and likes.identity_id=identity.id
  order by greatest(
    coalesce(views.viewed_at,'-infinity'::timestamptz),
    coalesce(likes.created_at,'-infinity'::timestamptz)
  ) desc,identity.id;
end$$;

revoke all on function public.community_stories(uuid,uuid)
  from public,anon;
revoke all on function public.community_story_action(uuid,text,jsonb)
  from public,anon;
revoke all on function public.community_story_audience(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.community_stories(uuid,uuid)
  to authenticated;
grant execute on function public.community_story_action(uuid,text,jsonb)
  to authenticated;
grant execute on function public.community_story_audience(uuid,uuid,uuid)
  to authenticated;
