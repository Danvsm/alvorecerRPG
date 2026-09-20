create table if not exists public.profile_wallpapers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  storage_path text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(campaign_id,storage_path)
);

alter table public.profile_wallpapers enable row level security;

alter table public.social_identities
  add column if not exists wallpaper_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.social_identities'::regclass
      and conname='social_identities_wallpaper_id_fkey'
  ) then
    alter table public.social_identities
      add constraint social_identities_wallpaper_id_fkey
      foreign key (wallpaper_id)
      references public.profile_wallpapers(id)
      on delete set null;
  end if;
end
$$;

create index if not exists profile_wallpapers_campaign_active_idx
  on public.profile_wallpapers(campaign_id,active,created_at desc);
create index if not exists social_identities_wallpaper_id_idx
  on public.social_identities(wallpaper_id)
  where wallpaper_id is not null;

revoke all on table public.profile_wallpapers from anon,authenticated;
grant select on table public.profile_wallpapers to authenticated;
grant all on table public.profile_wallpapers to service_role;

drop policy if exists profile_wallpapers_read on public.profile_wallpapers;
create policy profile_wallpapers_read
on public.profile_wallpapers
for select
to authenticated
using (
  public.is_master(campaign_id)
  or (active and public.is_member(campaign_id))
  or exists (
    select 1
    from public.social_identities identity
    where identity.wallpaper_id=profile_wallpapers.id
      and identity.user_id=(select auth.uid())
      and identity.active
  )
);

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'profile-wallpapers',
  'profile-wallpapers',
  false,
  1048576,
  array['image/webp']::text[]
)
on conflict(id) do update
set
  public=false,
  file_size_limit=1048576,
  allowed_mime_types=array['image/webp']::text[];

drop policy if exists profile_wallpaper_insert on storage.objects;
create policy profile_wallpaper_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id='profile-wallpapers'
  and storage.extension(name)='webp'
  and (storage.foldername(name))[2]='wallpapers'
  and exists (
    select 1
    from public.campaign_members member
    where member.user_id=(select auth.uid())
      and member.role='master'
      and member.campaign_id::text=(storage.foldername(objects.name))[1]
      and member.access_active
      and member.archived_at is null
  )
);

drop policy if exists profile_wallpaper_read on storage.objects;
create policy profile_wallpaper_read
on storage.objects
for select
to authenticated
using (
  bucket_id='profile-wallpapers'
  and exists (
    select 1
    from public.profile_wallpapers wallpaper
    where wallpaper.storage_path=objects.name
      and (
        public.is_master(wallpaper.campaign_id)
        or (wallpaper.active and public.is_member(wallpaper.campaign_id))
        or exists (
          select 1
          from public.social_identities identity
          where identity.wallpaper_id=wallpaper.id
            and identity.user_id=(select auth.uid())
            and identity.active
        )
      )
  )
);

drop policy if exists profile_wallpaper_delete on storage.objects;
create policy profile_wallpaper_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id='profile-wallpapers'
  and exists (
    select 1
    from public.campaign_members member
    where member.user_id=(select auth.uid())
      and member.role='master'
      and member.campaign_id::text=(storage.foldername(objects.name))[1]
      and member.access_active
      and member.archived_at is null
  )
);

create or replace function public.profile_wallpaper_catalog(c uuid)
returns table(
  id uuid,
  campaign_id uuid,
  name text,
  storage_path text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz,
  usage_count bigint
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  return query
  select
    wallpaper.id,
    wallpaper.campaign_id,
    wallpaper.name,
    wallpaper.storage_path,
    wallpaper.active,
    wallpaper.created_at,
    wallpaper.updated_at,
    wallpaper.archived_at,
    (
      select count(*)
      from public.social_identities identity
      where identity.wallpaper_id=wallpaper.id
        and identity.active
    )::bigint
  from public.profile_wallpapers wallpaper
  where wallpaper.campaign_id=c
    and (
      public.is_master(c)
      or wallpaper.active
      or exists (
        select 1
        from public.social_identities identity
        where identity.wallpaper_id=wallpaper.id
          and identity.user_id=(select auth.uid())
          and identity.active
      )
    )
  order by wallpaper.active desc,wallpaper.created_at desc,wallpaper.id;
end
$function$;

create or replace function public.profile_wallpaper_action(
  c uuid,
  op text,
  d jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  actor public.social_identities;
  target_id uuid;
  selected public.profile_wallpapers;
  saved_name text;
  saved_path text;
  cleared_count integer:=0;
begin
  if (select auth.uid()) is null or not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  if op='select' then
    actor:=alvorecer_private.require_community_actor(
      c,(d->>'actor_id')::uuid
    );
    target_id:=nullif(d->>'wallpaper_id','')::uuid;

    if target_id is not null then
      select wallpaper.*
      into selected
      from public.profile_wallpapers wallpaper
      where wallpaper.id=target_id
        and wallpaper.campaign_id=c
        and wallpaper.active
        and wallpaper.archived_at is null;

      if selected.id is null then
        raise exception 'Wallpaper indisponível';
      end if;
    end if;

    update public.social_identities
    set wallpaper_id=target_id
    where id=actor.id
      and campaign_id=c;

    return jsonb_build_object(
      'identity_id',actor.id,
      'wallpaper_id',target_id
    );
  end if;

  if not public.is_master(c) then
    raise exception 'Somente Pink';
  end if;

  if op='create' then
    saved_path:=coalesce(d->>'storage_path','');
    if saved_path not like c::text||'/wallpapers/%.webp' then
      raise exception 'Arquivo de wallpaper inválido';
    end if;

    if not exists (
      select 1
      from storage.objects object
      where object.bucket_id='profile-wallpapers'
        and object.name=saved_path
    ) then
      raise exception 'Arquivo de wallpaper não encontrado';
    end if;

    saved_name:=left(trim(coalesce(d->>'name','')),80);
    if saved_name='' then
      raise exception 'Informe o nome do wallpaper';
    end if;

    insert into public.profile_wallpapers(
      campaign_id,name,storage_path,created_by
    )
    values(
      c,saved_name,saved_path,(select auth.uid())
    )
    returning * into selected;

  elsif op='update' then
    target_id:=(d->>'wallpaper_id')::uuid;

    update public.profile_wallpapers wallpaper
    set
      name=case
        when d ? 'name' then left(trim(d->>'name'),80)
        else wallpaper.name
      end,
      active=case
        when d ? 'active' then (d->>'active')::boolean
        else wallpaper.active
      end,
      archived_at=case
        when d ? 'active' and not (d->>'active')::boolean
          then coalesce(wallpaper.archived_at,now())
        when d ? 'active' and (d->>'active')::boolean
          then null
        else wallpaper.archived_at
      end,
      updated_at=now()
    where wallpaper.id=target_id
      and wallpaper.campaign_id=c
      and (not (d ? 'name') or trim(d->>'name')<>'')
    returning * into selected;

    if selected.id is null then
      raise exception 'Wallpaper inválido';
    end if;

    if not selected.active then
      update public.social_identities
      set wallpaper_id=null
      where wallpaper_id=selected.id;
      get diagnostics cleared_count=row_count;
    end if;
  else
    raise exception 'Ação de wallpaper inválida';
  end if;

  perform public.record_event(
    c,
    null,
    'profile_wallpaper_'||op,
    jsonb_build_object(
      'wallpaper_id',selected.id,
      'name',selected.name,
      'active',selected.active,
      'cleared_profiles',cleared_count
    ),
    (select auth.uid())
  );

  return jsonb_build_object(
    'wallpaper_id',selected.id,
    'name',selected.name,
    'active',selected.active,
    'cleared_profiles',cleared_count
  );
end
$function$;

revoke all on function public.profile_wallpaper_catalog(uuid)
  from public,anon;
grant execute on function public.profile_wallpaper_catalog(uuid)
  to authenticated,service_role;

revoke all on function public.profile_wallpaper_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.profile_wallpaper_action(uuid,text,jsonb)
  to authenticated,service_role;
