-- Orkutista Stories: image-only stories, per-identity views and 24-hour cleanup.

create table public.community_stories(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author_id uuid not null references public.social_identities(id) on delete cascade,
  image_path text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  check(expires_at=created_at+interval '24 hours')
);

create table public.community_story_views(
  story_id uuid not null references public.community_stories(id) on delete cascade,
  identity_id uuid not null references public.social_identities(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(story_id,identity_id)
);

create table public.community_story_cleanup(
  image_path text primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  queued_at timestamptz not null default now()
);

create index community_stories_campaign_expiry_idx
  on public.community_stories(campaign_id,expires_at,created_at);
create index community_stories_author_idx
  on public.community_stories(author_id);
create index community_story_views_identity_idx
  on public.community_story_views(identity_id);
create index community_story_cleanup_queued_idx
  on public.community_story_cleanup(queued_at);

alter table public.community_stories enable row level security;
alter table public.community_story_views enable row level security;
alter table public.community_story_cleanup enable row level security;

create policy community_stories_read on public.community_stories
  for select to authenticated
  using(public.is_member(campaign_id) and expires_at>now());

grant select on public.community_stories to authenticated;
grant all on public.community_stories,public.community_story_views,
  public.community_story_cleanup to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-stories','community-stories',false,1048576,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=1048576,
  allowed_mime_types=array['image/webp'];

create function alvorecer_private.can_manage_story_media(
  path text,
  require_queue boolean default false
) returns boolean language sql stable security definer
set search_path=public,storage as $$
  select exists(
    select 1 from public.social_identities identity
    where identity.campaign_id::text=(storage.foldername(path))[1]
      and identity.id::text=(storage.foldername(path))[2]
      and (
        identity.user_id=(select auth.uid())
        or public.is_master(identity.campaign_id)
      )
      and (
        not require_queue
        or exists(
          select 1 from public.community_story_cleanup cleanup
          where cleanup.image_path=path
            and cleanup.campaign_id=identity.campaign_id
        )
      )
  )
$$;

revoke all on function alvorecer_private.can_manage_story_media(text,boolean)
  from public,anon;
grant usage on schema alvorecer_private to authenticated,service_role;
grant execute on function alvorecer_private.can_manage_story_media(text,boolean)
  to authenticated,service_role;

create policy community_story_media_read on storage.objects
  for select to authenticated using(
    bucket_id='community-stories'
    and exists(
      select 1 from public.community_stories story
      where story.image_path=storage.objects.name
        and story.expires_at>now()
        and public.is_member(story.campaign_id)
    )
  );

create policy community_story_media_insert on storage.objects
  for insert to authenticated with check(
    bucket_id='community-stories'
    and storage.extension(name)='webp'
    and exists(
      select 1 from public.social_identities identity
      where identity.campaign_id::text=(storage.foldername(storage.objects.name))[1]
        and identity.id::text=(storage.foldername(storage.objects.name))[2]
        and identity.active
        and identity.user_id=(select auth.uid())
    )
  );

create policy community_story_media_delete on storage.objects
  for delete to authenticated using(
    bucket_id='community-stories'
    and (select alvorecer_private.can_manage_story_media(storage.objects.name))
  );

-- Storage deletion resolves the object with SELECT before applying DELETE.
-- Keep queued media readable only by its owner or the campaign master until
-- the client or the minute-by-minute cleanup removes it.
create policy community_story_media_cleanup_read on storage.objects
  for select to authenticated using(
    bucket_id='community-stories'
    and (select alvorecer_private.can_manage_story_media(
      storage.objects.name,true
    ))
  );

create function alvorecer_private.require_story_actor(c uuid,requested uuid)
returns public.social_identities
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
    and identity.user_id=(select auth.uid());

  if actor.id is null then raise exception 'Identidade inválida'; end if;
  return actor;
end$$;

revoke all on function alvorecer_private.require_story_actor(uuid,uuid)
  from public,anon,authenticated;

create function alvorecer_private.queue_story_media()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.community_story_cleanup(image_path,campaign_id)
  values(old.image_path,old.campaign_id)
  on conflict(image_path) do update set queued_at=now();
  return old;
end$$;

create trigger community_story_queue_media
after delete on public.community_stories
for each row execute function alvorecer_private.queue_story_media();

create function public.community_stories(c uuid,requested_actor uuid)
returns table(
  id uuid,
  campaign_id uuid,
  author_id uuid,
  author_username text,
  image_path text,
  created_at timestamptz,
  expires_at timestamptz,
  viewer_seen boolean
)
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
begin
  actor:=alvorecer_private.require_story_actor(c,requested_actor);
  return query
  select story.id,story.campaign_id,story.author_id,profile.username,
    story.image_path,story.created_at,story.expires_at,
    exists(
      select 1 from public.community_story_views views
      where views.story_id=story.id and views.identity_id=actor.id
    )
  from public.community_stories story
  join public.social_identities identity on identity.id=story.author_id
  left join public.profiles profile on profile.id=identity.user_id
  where story.campaign_id=c and story.expires_at>now()
  order by min(story.created_at) over(partition by story.author_id),
    story.created_at,story.id;
end$$;

create function public.community_story_action(c uuid,op text,d jsonb)
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

revoke all on function public.community_stories(uuid,uuid) from public,anon;
revoke all on function public.community_story_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_stories(uuid,uuid) to authenticated;
grant execute on function public.community_story_action(uuid,text,jsonb)
  to authenticated;

-- Production scheduler: the Edge Function uses the Storage API, never SQL, to
-- remove expired and queued objects before deleting their remaining records.
select cron.schedule('alvorecer-chat-media-cleanup','* * * * *',$job$
 select net.http_post(
  url:='https://wsihnbrnqdnmidjvjchn.supabase.co/functions/v1/alvorecer-api/media-cleanup',
  headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='alvorecer_media_cleanup')),
  body:='{}'::jsonb,
  timeout_milliseconds:=60000
 );
$job$);
