create or replace function alvorecer_private.can_read_frame_asset(asset text)
returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.cosmetics c
    where c.kind='frame' and c.asset_path=asset
      and public.is_member(c.campaign_id)
      and (
        public.is_master(c.campaign_id)
        or (
          c.active and c.archived_at is null and (
            exists(
              select 1
              from public.cosmetic_equipment e
              join public.social_identities i on i.id=e.identity_id
              where e.cosmetic_id=c.id and e.kind='frame'
                and i.campaign_id=c.campaign_id and i.active
            )
            or (
              c.visible and (
                not c.secret or exists(
                  select 1 from public.cosmetic_grants g
                  join public.social_identities i on i.id=g.identity_id
                  where g.cosmetic_id=c.id and g.removed_at is null
                    and i.user_id=(select auth.uid())
                )
              )
            )
          )
        )
      )
  )
$$;
revoke all on function alvorecer_private.can_read_frame_asset(text) from public,anon;
grant usage on schema alvorecer_private to authenticated,service_role;
grant execute on function alvorecer_private.can_read_frame_asset(text) to authenticated,service_role;

drop policy frame_asset_read on storage.objects;
create policy frame_asset_read on storage.objects for select to authenticated using(
  bucket_id='avatar-frames'
  and (select alvorecer_private.can_read_frame_asset(storage.objects.name))
);

create or replace function public.frame_catalog(c uuid)
returns table(
  id uuid,campaign_id uuid,kind text,name text,description text,color text,icon text,active boolean,
  asset_path text,rarity text,collection_id uuid,collection_name text,acquisition_origin text,
  visible boolean,secret boolean,archived_at timestamptz,display_order integer,scale numeric,
  offset_x numeric,offset_y numeric,effects jsonb,exclusive_identity_id uuid,created_at timestamptz,
  updated_at timestamptz,owned boolean
)
language sql stable security definer set search_path='' as $$
  with viewer as (
    select public.is_master(c) master, i.id identity_id
    from (values(1)) v(n)
    left join public.social_identities i on i.campaign_id=c and i.user_id=(select auth.uid())
    where public.is_member(c)
  )
  select f.id,f.campaign_id,f.kind,
    case when f.secret and not v.master and not coalesce(own.owned,false) then '???' else f.name end,
    case when f.secret and not v.master and not coalesce(own.owned,false) then '' else f.description end,
    f.color,f.icon,f.active,
    case when f.secret and not v.master and not coalesce(own.owned,false)
      and not coalesce(public_use.equipped,false) then null else f.asset_path end,
    f.rarity,f.collection_id,
    case when f.secret and not v.master and not coalesce(own.owned,false) then null else col.name end,
    f.acquisition_origin,f.visible,f.secret,f.archived_at,f.display_order,f.scale,
    f.offset_x,f.offset_y,
    case when f.secret and not v.master and not coalesce(own.owned,false)
      and not coalesce(public_use.equipped,false) then '[]'::jsonb else f.effects end,
    f.exclusive_identity_id,f.created_at,f.updated_at,coalesce(own.owned,false)
  from public.cosmetics f
  cross join viewer v
  left join public.cosmetic_collections col on col.id=f.collection_id
  left join lateral (
    select true owned from public.cosmetic_grants g
    where g.cosmetic_id=f.id and g.identity_id=v.identity_id and g.removed_at is null
    limit 1
  ) own on true
  left join lateral (
    select true equipped
    from public.cosmetic_equipment e
    join public.social_identities i on i.id=e.identity_id
    where e.cosmetic_id=f.id and e.kind='frame'
      and i.campaign_id=c and i.active
    limit 1
  ) public_use on true
  where f.campaign_id=c and f.kind='frame'
    and (
      v.master
      or (
        f.active and f.archived_at is null
        and (f.visible or coalesce(public_use.equipped,false))
      )
    )
  order by f.display_order,f.name,f.id
$$;

revoke all on function public.frame_catalog(uuid) from public,anon;
grant execute on function public.frame_catalog(uuid) to authenticated,service_role;
