-- Keep Story likes realtime without touching campaign_events or reloading
-- the whole Story list. View events remain private/high-frequency and do not
-- emit a community-wide realtime event.

create or replace function public.community_story_like_count(
  c uuid,
  target_story uuid,
  requested_actor uuid
) returns bigint
language plpgsql
security definer
set search_path=public as $$
declare actor public.social_identities;
declare total bigint;
begin
  actor:=alvorecer_private.require_story_actor(c,requested_actor);

  if not exists(
    select 1
    from public.community_stories story
    where story.id=target_story
      and story.campaign_id=c
      and story.expires_at>now()
  ) then
    raise exception 'Story indisponível';
  end if;

  select count(*)::bigint into total
  from public.community_story_likes likes
  where likes.story_id=target_story;

  return total;
end$$;

revoke all on function public.community_story_like_count(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.community_story_like_count(uuid,uuid,uuid)
  to authenticated;

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

  if op in ('create_story','delete_story','like_story') then
    perform alvorecer_private.bump_community_event(
      c,'stories',actor.id,op,result_id
    );
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id',result_id,'active',active,'image_path',media_path
  ));
end$$;

revoke all on function public.community_story_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_story_action(uuid,text,jsonb)
  to authenticated;
