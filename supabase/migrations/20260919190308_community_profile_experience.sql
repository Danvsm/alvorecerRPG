-- Public Orkutista profiles: editable biography, following, public collection
-- summary and cursor-paginated posts. Future session/achievement engines can
-- replace the prepared counters without changing the profile contract.

create table public.community_profile_settings(
  identity_id uuid primary key references public.social_identities(id) on delete cascade,
  bio text not null default '' check(char_length(bio)<=240),
  updated_at timestamptz not null default now()
);

create table public.community_profile_follows(
  follower_identity_id uuid not null references public.social_identities(id) on delete cascade,
  followed_identity_id uuid not null references public.social_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(follower_identity_id,followed_identity_id),
  check(follower_identity_id<>followed_identity_id)
);

create index community_profile_follows_target_idx
  on public.community_profile_follows(followed_identity_id,created_at desc);

alter table public.community_profile_settings enable row level security;
alter table public.community_profile_follows enable row level security;
revoke all on public.community_profile_settings,public.community_profile_follows
  from anon,authenticated;
grant all on public.community_profile_settings,public.community_profile_follows
  to service_role;

create function public.community_profile(
  c uuid,
  requested_actor uuid,
  target_identity uuid
)
returns table(
  identity_id uuid,
  username text,
  bio text,
  post_count bigint,
  session_count bigint,
  achievement_count bigint,
  medal_count bigint,
  wealth_rank bigint,
  viewer_following boolean,
  can_edit boolean
)
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
declare target public.social_identities;
begin
  actor:=alvorecer_private.require_community_actor(c,requested_actor);
  select identity.* into target
  from public.social_identities identity
  where identity.id=target_identity and identity.campaign_id=c and identity.active;
  if target.id is null then raise exception 'Perfil indisponível'; end if;

  return query
  select target.id,profile.username,coalesce(settings.bio,''),
    (select count(*) from public.community_posts post
      where post.author_id=target.id and post.campaign_id=c
        and post.archived_at is null),
    0::bigint,
    (select count(*) from public.cosmetic_grants grant_row
      join public.cosmetics cosmetic on cosmetic.id=grant_row.cosmetic_id
      where grant_row.identity_id=target.id and grant_row.removed_at is null
        and cosmetic.kind in ('title','medal')),
    (select count(*) from public.cosmetic_grants grant_row
      join public.cosmetics cosmetic on cosmetic.id=grant_row.cosmetic_id
      where grant_row.identity_id=target.id and grant_row.removed_at is null
        and cosmetic.kind='medal'),
    (select ranking.rank from public.wealth_ranking(c) ranking
      where ranking.identity_id=target.id),
    exists(select 1 from public.community_profile_follows follow_row
      where follow_row.follower_identity_id=actor.id
        and follow_row.followed_identity_id=target.id),
    actor.id=target.id
  from (values(1)) seed(value)
  left join public.profiles profile on profile.id=target.user_id
  left join public.community_profile_settings settings
    on settings.identity_id=target.id;
end$$;

revoke all on function public.community_profile(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.community_profile(uuid,uuid,uuid)
  to authenticated,service_role;

create function public.community_profile_collectibles(
  c uuid,
  requested_actor uuid,
  target_identity uuid
)
returns table(
  cosmetic_id uuid,
  kind text,
  equipped boolean,
  earned_at timestamptz
)
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
begin
  actor:=alvorecer_private.require_community_actor(c,requested_actor);
  if not exists(
    select 1 from public.social_identities identity
    where identity.id=target_identity and identity.campaign_id=c and identity.active
  ) then raise exception 'Perfil indisponível'; end if;

  return query
  select grant_row.cosmetic_id,cosmetic.kind,
    equipment.cosmetic_id is not null,grant_row.created_at
  from public.cosmetic_grants grant_row
  join public.cosmetics cosmetic on cosmetic.id=grant_row.cosmetic_id
    and cosmetic.campaign_id=c
  left join public.cosmetic_equipment equipment
    on equipment.identity_id=grant_row.identity_id
    and equipment.kind=cosmetic.kind
    and equipment.cosmetic_id=grant_row.cosmetic_id
  where grant_row.identity_id=target_identity and grant_row.removed_at is null
  order by equipment.cosmetic_id is not null desc,grant_row.created_at desc;
end$$;

revoke all on function public.community_profile_collectibles(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.community_profile_collectibles(uuid,uuid,uuid)
  to authenticated,service_role;

create function public.community_profile_posts(
  c uuid,
  requested_actor uuid,
  target_identity uuid,
  cursor_created_at timestamptz default null,
  cursor_id uuid default null,
  page_size integer default 6
)
returns table(
  id uuid,
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
  if not exists(
    select 1 from public.social_identities identity
    where identity.id=target_identity and identity.campaign_id=c and identity.active
  ) then raise exception 'Perfil indisponível'; end if;
  if (cursor_created_at is null)<>(cursor_id is null) then
    raise exception 'Cursor do perfil inválido';
  end if;
  safe_page_size:=least(greatest(coalesce(page_size,6),1),20);

  return query
  select post.id,post.image_path,post.caption,post.created_at,
    (select count(*) from public.community_post_likes likes
      where likes.post_id=post.id),
    (select count(*) from public.community_post_comments comments
      where comments.post_id=post.id),
    exists(select 1 from public.community_post_likes likes
      where likes.post_id=post.id and likes.identity_id=actor.id)
  from public.community_posts post
  where post.campaign_id=c and post.author_id=target_identity
    and post.archived_at is null
    and (
      cursor_created_at is null
      or (post.created_at,post.id)<(cursor_created_at,cursor_id)
    )
  order by post.created_at desc,post.id desc
  limit safe_page_size;
end$$;

revoke all on function public.community_profile_posts(
  uuid,uuid,uuid,timestamptz,uuid,integer
) from public,anon;
grant execute on function public.community_profile_posts(
  uuid,uuid,uuid,timestamptz,uuid,integer
) to authenticated,service_role;

create function public.community_profile_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.social_identities;
declare target public.social_identities;
declare content text;
declare active boolean;
begin
  actor:=alvorecer_private.require_community_actor(c,(d->>'actor_id')::uuid);

  if op='bio' then
    content:=trim(coalesce(d->>'bio',''));
    if char_length(content)>240 then
      raise exception 'A bio aceita até 240 caracteres';
    end if;
    insert into public.community_profile_settings(identity_id,bio,updated_at)
    values(actor.id,content,now())
    on conflict(identity_id) do update
      set bio=excluded.bio,updated_at=excluded.updated_at;
    return jsonb_build_object('identity_id',actor.id,'bio',content);

  elsif op='follow' then
    select identity.* into target
    from public.social_identities identity
    where identity.id=(d->>'target_id')::uuid
      and identity.campaign_id=c and identity.active;
    if target.id is null or target.id=actor.id then
      raise exception 'Perfil inválido para seguir';
    end if;
    if actor.user_id is null then
      raise exception 'Escolha seu perfil principal para seguir';
    end if;
    delete from public.community_profile_follows
    where follower_identity_id=actor.id and followed_identity_id=target.id;
    if found then active:=false;
    else
      insert into public.community_profile_follows(
        follower_identity_id,followed_identity_id
      ) values(actor.id,target.id);
      active:=true;
    end if;
    return jsonb_build_object('identity_id',target.id,'active',active);
  end if;

  raise exception 'Ação de perfil inválida';
end$$;

revoke all on function public.community_profile_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_profile_action(uuid,text,jsonb)
  to authenticated,service_role;

create function alvorecer_private.notify_community_profile_followers()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(campaign_id,user_id,kind,title,reference_id)
  select new.campaign_id,follower.user_id,'post',
    author.name||' publicou no Orkutista',new.id::text
  from public.community_profile_follows follow_row
  join public.social_identities follower
    on follower.id=follow_row.follower_identity_id
  join public.social_identities author
    on author.id=follow_row.followed_identity_id
  where follow_row.followed_identity_id=new.author_id
    and follower.user_id is not null and follower.active;
  return new;
end$$;

revoke all on function alvorecer_private.notify_community_profile_followers()
  from public,anon,authenticated;

create trigger community_post_follower_notification
after insert on public.community_posts
for each row execute function alvorecer_private.notify_community_profile_followers();
