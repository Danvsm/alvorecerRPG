-- Scope high-frequency Orkutista realtime updates away from the global
-- campaign revision. Feed/story interactions no longer force Game.tsx to
-- reload the entire campaign snapshot.

create table public.community_events(
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  scope text not null check(scope in ('feed','stories')),
  revision bigint not null default 0,
  actor_id uuid references public.social_identities(id) on delete set null,
  event_kind text not null default '',
  entity_id uuid,
  updated_at timestamptz not null default now(),
  primary key(campaign_id,scope)
);

alter table public.community_events enable row level security;
revoke all on public.community_events from anon,authenticated;
grant select on public.community_events to authenticated;
grant all on public.community_events to service_role;

create policy community_events_read on public.community_events
  for select to authenticated
  using(public.is_member(campaign_id));

create or replace function alvorecer_private.bump_community_event(
  c uuid,
  event_scope text,
  event_actor uuid,
  kind text,
  entity uuid default null
) returns void
language plpgsql security definer set search_path=public as $$
begin
  if event_scope not in ('feed','stories') then
    raise exception 'Escopo de comunidade inválido';
  end if;

  insert into public.community_events(
    campaign_id,scope,revision,actor_id,event_kind,entity_id,updated_at
  )
  values(c,event_scope,1,event_actor,kind,entity,now())
  on conflict(campaign_id,scope) do update
  set revision=public.community_events.revision+1,
      actor_id=excluded.actor_id,
      event_kind=excluded.event_kind,
      entity_id=excluded.entity_id,
      updated_at=excluded.updated_at;
end$$;

revoke all on function alvorecer_private.bump_community_event(
  uuid,text,uuid,text,uuid
) from public,anon,authenticated;

do $$
begin
  if not exists(
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='community_events'
  ) then
    alter publication supabase_realtime add table public.community_events;
  end if;
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
    media_path:=nullif(trim(coalesce(d->>'image_path','')),'');
    content:=trim(coalesce(d->>'caption',''));
    if char_length(content) not between 1 and 2000 then
      raise exception 'Escreva uma publicação de até 2000 caracteres';
    end if;
    if media_path is null and char_length(content)>1000 then
      raise exception 'A publicação de texto aceita até 1000 caracteres';
    end if;
    if media_path is not null then
      if media_path not like c::text||'/'||actor.id::text||'/%'
         or storage.extension(media_path)<>'webp' then
        raise exception 'Imagem da publicação inválida';
      end if;
      if not exists(
        select 1 from storage.objects object
        where object.bucket_id='community-posts' and object.name=media_path
      ) then raise exception 'Envie a foto antes de publicar'; end if;
    end if;

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

  if op in ('create_post','delete_post','comment') then
    perform alvorecer_private.bump_community_event(
      c,
      'feed',
      actor.id,
      op,
      case when op='comment' then target_post else result_id end
    );
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id',result_id,'active',active,'archived',archived,'deleted',deleted,
    'image_path',media_path
  ));
end$$;

revoke all on function public.community_feed_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_feed_action(uuid,text,jsonb)
  to authenticated;

create or replace function public.community_comment_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.social_identities;
declare target public.community_post_comments;
begin
  actor:=alvorecer_private.require_community_actor(
    c,
    (d->>'actor_id')::uuid
  );

  if op<>'delete_comment' then
    raise exception 'Ação de comentário inválida';
  end if;

  select comment.* into target
  from public.community_post_comments comment
  join public.community_posts post on post.id=comment.post_id
  where comment.id=(d->>'comment_id')::uuid
    and post.campaign_id=c
    and post.archived_at is null
  for update of comment;

  if target.id is null then raise exception 'Comentário inválido'; end if;
  if target.author_id<>actor.id and not public.is_master(c) then
    raise exception 'Sem permissão para excluir este comentário';
  end if;

  delete from public.community_post_comments where id=target.id;
  perform alvorecer_private.bump_community_event(
    c,'feed',actor.id,op,target.post_id
  );

  return jsonb_build_object('id',target.id,'deleted',true);
end$$;

revoke all on function public.community_comment_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_comment_action(uuid,text,jsonb)
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

  if op in ('create_story','delete_story') then
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
