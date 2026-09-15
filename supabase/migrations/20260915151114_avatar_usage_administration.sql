alter table public.campaign_avatars
  add column blocked boolean not null default false,
  add column shared boolean not null default false,
  add column exclusive_user_id uuid references public.profiles(id) on delete set null,
  add constraint campaign_avatars_sharing_exclusive_check
    check (not (shared and exclusive_user_id is not null));

create index campaign_avatars_exclusive_user_idx
  on public.campaign_avatars(exclusive_user_id)
  where exclusive_user_id is not null;

create function alvorecer_private.enforce_avatar_assignment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  selected_avatar campaign_avatars;
  target_user uuid;
  target_role text;
begin
  if new.avatar_id is null then
    if tg_table_name='characters' then new.image:=null; end if;
    return new;
  end if;

  if tg_op='UPDATE' and new.avatar_id is not distinct from old.avatar_id then
    return new;
  end if;

  if tg_table_name='characters' then target_user:=new.owner_id;
  else target_user:=new.user_id;
  end if;

  select * into selected_avatar
  from campaign_avatars
  where id=new.avatar_id and campaign_id=new.campaign_id
  for update;

  if selected_avatar.id is null then raise exception 'Avatar inválido'; end if;

  if tg_table_name='characters' then
    new.image:=selected_avatar.storage_path;
  end if;

  if not selected_avatar.active then raise exception 'Avatar arquivado'; end if;

  if target_user is null then
    if not is_master(new.campaign_id) then raise exception 'Avatar não permitido'; end if;
    return new;
  end if;

  select role into target_role
  from campaign_members
  where campaign_id=new.campaign_id
    and user_id=target_user
    and access_active
    and archived_at is null;

  if target_role='master' then return new; end if;
  if target_role is distinct from 'player' then raise exception 'Jogador inválido'; end if;
  if selected_avatar.blocked then raise exception 'Avatar bloqueado'; end if;
  if selected_avatar.exclusive_user_id is not null
     and selected_avatar.exclusive_user_id<>target_user then
    raise exception 'Avatar exclusivo de outro jogador';
  end if;

  if not selected_avatar.shared and exists(
    select 1
    from (
      select i.user_id
      from social_identities i
      join campaign_members m
        on m.campaign_id=i.campaign_id and m.user_id=i.user_id
      where i.campaign_id=new.campaign_id
        and i.avatar_id=new.avatar_id
        and i.user_id is not null
        and i.kind='player'
        and m.role='player'
        and m.access_active
        and m.archived_at is null
      union
      select ch.owner_id
      from characters ch
      join campaign_members m
        on m.campaign_id=ch.campaign_id and m.user_id=ch.owner_id
      where ch.campaign_id=new.campaign_id
        and ch.avatar_id=new.avatar_id
        and ch.owner_id is not null
        and not ch.archived
        and m.role='player'
        and m.access_active
        and m.archived_at is null
    ) current_usage
    where current_usage.user_id<>target_user
  ) then
    raise exception 'Avatar já está em uso';
  end if;

  return new;
end
$$;

create trigger enforce_character_avatar_assignment
before insert or update of avatar_id on public.characters
for each row execute function alvorecer_private.enforce_avatar_assignment();

create trigger enforce_identity_avatar_assignment
before insert or update of avatar_id on public.social_identities
for each row execute function alvorecer_private.enforce_avatar_assignment();

create function alvorecer_private.sync_character_avatar()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.owner_id is null
     or (tg_op='UPDATE' and new.avatar_id is not distinct from old.avatar_id)
     or pg_trigger_depth()>1 then
    return new;
  end if;

  update social_identities
  set avatar_id=new.avatar_id
  where campaign_id=new.campaign_id
    and user_id=new.owner_id
    and kind='player'
    and avatar_id is distinct from new.avatar_id;

  update characters
  set avatar_id=new.avatar_id,
      image=(select storage_path from campaign_avatars where id=new.avatar_id)
  where campaign_id=new.campaign_id
    and owner_id=new.owner_id
    and not archived
    and id<>new.id
    and avatar_id is distinct from new.avatar_id;

  return new;
end
$$;

create function alvorecer_private.sync_identity_avatar()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.user_id is null
     or new.kind<>'player'
     or (tg_op='UPDATE' and new.avatar_id is not distinct from old.avatar_id)
     or pg_trigger_depth()>1 then
    return new;
  end if;

  update characters
  set avatar_id=new.avatar_id,
      image=(select storage_path from campaign_avatars where id=new.avatar_id)
  where campaign_id=new.campaign_id
    and owner_id=new.user_id
    and not archived
    and avatar_id is distinct from new.avatar_id;

  return new;
end
$$;

create trigger sync_character_avatar_assignment
after insert or update of avatar_id on public.characters
for each row execute function alvorecer_private.sync_character_avatar();

create trigger sync_identity_avatar_assignment
after insert or update of avatar_id on public.social_identities
for each row execute function alvorecer_private.sync_identity_avatar();

create function public.avatar_catalog(c uuid)
returns table(
  id uuid,
  campaign_id uuid,
  name text,
  storage_path text,
  active boolean,
  blocked boolean,
  shared boolean,
  exclusive_user_id uuid,
  created_by uuid,
  created_at timestamptz,
  archived_at timestamptz,
  state text,
  usage jsonb,
  usage_count bigint,
  occupied_by_other boolean,
  exclusive_username text,
  exclusive_name text
)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;

  return query
  with raw_usage as (
    select i.avatar_id, i.user_id
    from social_identities i
    join campaign_members m
      on m.campaign_id=i.campaign_id and m.user_id=i.user_id
    where i.campaign_id=c
      and i.avatar_id is not null
      and i.user_id is not null
      and i.kind='player'
      and m.role='player'
      and m.access_active
      and m.archived_at is null
    union
    select ch.avatar_id, ch.owner_id
    from characters ch
    join campaign_members m
      on m.campaign_id=ch.campaign_id and m.user_id=ch.owner_id
    where ch.campaign_id=c
      and ch.avatar_id is not null
      and ch.owner_id is not null
      and not ch.archived
      and m.role='player'
      and m.access_active
      and m.archived_at is null
  ), grouped_usage as (
    select u.avatar_id,
      jsonb_agg(
        jsonb_build_object(
          'user_id',p.id,
          'username',p.username,
          'name',coalesce(nullif(p.display_name,''),p.username)
        ) order by coalesce(nullif(p.display_name,''),p.username),p.id
      ) as users,
      count(*) as user_count
    from raw_usage u
    join profiles p on p.id=u.user_id
    group by u.avatar_id
  )
  select a.id,a.campaign_id,a.name,a.storage_path,a.active,a.blocked,a.shared,
    a.exclusive_user_id,a.created_by,a.created_at,a.archived_at,
    case
      when not a.active then 'archived'
      when a.blocked then 'blocked'
      when a.exclusive_user_id is not null then 'exclusive'
      when a.shared then 'shared'
      when gu.avatar_id is not null then 'in_use'
      else 'available'
    end,
    case when is_master(c) then coalesce(gu.users,'[]'::jsonb)
      else '[]'::jsonb end,
    coalesce(gu.user_count,0),
    exists(
      select 1 from raw_usage current_usage
      where current_usage.avatar_id=a.id
        and current_usage.user_id<>auth.uid()
    ),
    exclusive_profile.username,
    coalesce(nullif(exclusive_profile.display_name,''),exclusive_profile.username)
  from campaign_avatars a
  left join grouped_usage gu on gu.avatar_id=a.id
  left join profiles exclusive_profile on exclusive_profile.id=a.exclusive_user_id
  where a.campaign_id=c
    and (
      is_master(c)
      or a.active
      or exists(
        select 1 from raw_usage own_usage
        where own_usage.avatar_id=a.id and own_usage.user_id=auth.uid()
      )
    )
  order by a.active desc,a.created_at desc,a.id;
end
$$;

revoke all on function public.avatar_catalog(uuid) from public,anon;
grant execute on function public.avatar_catalog(uuid) to authenticated,service_role;

create function public.admin_avatar_action(
  c uuid,
  target_id uuid,
  actor uuid,
  operation text,
  exclusive_user uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  selected_avatar campaign_avatars;
begin
  if not exists(
    select 1 from campaign_members
    where campaign_id=c and user_id=actor and role='master'
      and access_active and archived_at is null
  ) then raise exception 'Somente Pink'; end if;

  select * into selected_avatar
  from campaign_avatars
  where id=target_id and campaign_id=c
  for update;
  if selected_avatar.id is null then raise exception 'Avatar inválido'; end if;

  if operation='block' then
    update campaign_avatars set blocked=true where id=target_id;
  elsif operation='unblock' then
    update campaign_avatars set blocked=false where id=target_id;
  elsif operation='share' then
    update campaign_avatars set shared=true,exclusive_user_id=null where id=target_id;
  elsif operation='unshare' then
    update campaign_avatars set shared=false where id=target_id;
  elsif operation='exclusive' then
    if exclusive_user is null or not exists(
      select 1 from campaign_members
      where campaign_id=c and user_id=exclusive_user and role='player'
        and access_active and archived_at is null
    ) then raise exception 'Jogador exclusivo inválido'; end if;
    update campaign_avatars
    set exclusive_user_id=exclusive_user,shared=false
    where id=target_id;
  elsif operation='clear_exclusive' then
    update campaign_avatars set exclusive_user_id=null where id=target_id;
  else raise exception 'Operação de avatar inválida';
  end if;

  perform record_event(
    c,null,'avatar_'||operation,
    jsonb_build_object(
      'avatar_id',target_id,
      'name',selected_avatar.name,
      'exclusive_user_id',exclusive_user
    ),actor
  );

  return jsonb_build_object('id',target_id,'operation',operation);
end
$$;

revoke all on function public.admin_avatar_action(uuid,uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.admin_avatar_action(uuid,uuid,uuid,text,uuid)
  to service_role;
