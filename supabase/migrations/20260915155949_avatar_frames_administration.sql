create table public.cosmetic_collections(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(campaign_id,name)
);
create index cosmetic_collections_campaign_order_idx
  on public.cosmetic_collections(campaign_id,display_order,name);

alter table public.cosmetics
  add column asset_path text,
  add column rarity text not null default 'common',
  add column collection_id uuid references public.cosmetic_collections on delete set null,
  add column acquisition_origin text not null default 'manual',
  add column visible boolean not null default true,
  add column secret boolean not null default false,
  add column archived_at timestamptz,
  add column display_order integer not null default 0,
  add column scale numeric(4,2) not null default 1,
  add column offset_x numeric(6,2) not null default 0,
  add column offset_y numeric(6,2) not null default 0,
  add column effects jsonb not null default '[]'::jsonb,
  add column exclusive_identity_id uuid references public.social_identities on delete set null,
  add column updated_at timestamptz not null default now();

alter table public.cosmetics
  add constraint cosmetics_rarity_check check(rarity in ('common','uncommon','rare','epic','legendary','event','supporter','master')),
  add constraint cosmetics_acquisition_origin_check check(acquisition_origin in ('free','achievement','session','event','supporter','gift','exclusive','manual')),
  add constraint cosmetics_scale_check check(scale between 0.25 and 3),
  add constraint cosmetics_offset_x_check check(offset_x between -100 and 100),
  add constraint cosmetics_offset_y_check check(offset_y between -100 and 100),
  add constraint cosmetics_effects_check check(
    jsonb_typeof(effects)='array'
    and jsonb_array_length(effects)<=2
    and not jsonb_path_exists(effects,'$[*] ? (!(@.type == "glow" || @.type == "shine" || @.type == "pulse" || @.type == "aura" || @.type == "particles" || @.type == "runes"))')
  );
create index cosmetics_frame_catalog_idx
  on public.cosmetics(campaign_id,display_order,name)
  where kind='frame';
create index cosmetics_collection_idx on public.cosmetics(collection_id);
create index cosmetics_exclusive_identity_idx on public.cosmetics(exclusive_identity_id)
  where exclusive_identity_id is not null;

alter table public.cosmetic_grants
  add column granted_by uuid references public.profiles on delete set null,
  add column removed_at timestamptz,
  add column removed_by uuid references public.profiles on delete set null;
create index cosmetic_grants_active_identity_idx
  on public.cosmetic_grants(identity_id,cosmetic_id)
  where removed_at is null;
create index cosmetic_grants_active_cosmetic_idx
  on public.cosmetic_grants(cosmetic_id,identity_id)
  where removed_at is null;

alter table public.cosmetic_collections enable row level security;
revoke all on public.cosmetic_collections from anon,authenticated;
grant select on public.cosmetic_collections to authenticated;
grant all on public.cosmetic_collections to service_role;
create policy cosmetic_collections_read on public.cosmetic_collections
  for select to authenticated using((select public.is_member(campaign_id)));

drop policy cosmetics_read on public.cosmetics;
create policy cosmetics_read on public.cosmetics for select to authenticated using(
  (select public.is_member(campaign_id)) and (
    kind<>'frame' or (select public.is_master(campaign_id)) or (
      active and archived_at is null and visible and (
        not secret or exists(
          select 1 from public.cosmetic_grants g
          join public.social_identities i on i.id=g.identity_id
          where g.cosmetic_id=cosmetics.id and g.removed_at is null
            and i.user_id=(select auth.uid())
        )
      )
    )
  )
);
drop policy grants_read on public.cosmetic_grants;
create policy grants_read on public.cosmetic_grants for select to authenticated using(
  exists(
    select 1 from public.social_identities i
    where i.id=identity_id and (select public.is_member(i.campaign_id))
      and (i.user_id=(select auth.uid()) or (select public.is_master(i.campaign_id)))
  )
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatar-frames','avatar-frames',false,1048576,array['image/webp','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
create policy frame_asset_read on storage.objects for select to authenticated using(
  bucket_id='avatar-frames' and exists(
    select 1 from public.cosmetics c
    where c.kind='frame' and c.asset_path=storage.objects.name
      and (select public.is_member(c.campaign_id))
      and ((select public.is_master(c.campaign_id)) or (
        c.active and c.archived_at is null and c.visible and (
          not c.secret or exists(
            select 1 from public.cosmetic_grants g
            join public.social_identities i on i.id=g.identity_id
            where g.cosmetic_id=c.id and g.removed_at is null
              and i.user_id=(select auth.uid())
          )
        )
      ))
  )
);
create policy frame_asset_insert on storage.objects for insert to authenticated with check(
  bucket_id='avatar-frames'
  and storage.extension(name) in ('webp','png')
  and (storage.foldername(name))[2]='frames'
  and exists(
    select 1 from public.campaign_members m
    where m.user_id=(select auth.uid()) and m.role='master'
      and m.access_active and m.archived_at is null
      and m.campaign_id::text=(storage.foldername(name))[1]
  )
);
create policy frame_asset_delete on storage.objects for delete to authenticated using(
  bucket_id='avatar-frames' and exists(
    select 1 from public.campaign_members m
    where m.user_id=(select auth.uid()) and m.role='master'
      and m.access_active and m.archived_at is null
      and m.campaign_id::text=(storage.foldername(name))[1]
  )
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
    case when f.secret and not v.master and not coalesce(own.owned,false) then null else f.asset_path end,
    f.rarity,f.collection_id,
    case when f.secret and not v.master and not coalesce(own.owned,false) then null else col.name end,
    f.acquisition_origin,f.visible,f.secret,f.archived_at,f.display_order,f.scale,
    f.offset_x,f.offset_y,
    case when f.secret and not v.master and not coalesce(own.owned,false) then '[]'::jsonb else f.effects end,
    f.exclusive_identity_id,f.created_at,f.updated_at,coalesce(own.owned,false)
  from public.cosmetics f
  cross join viewer v
  left join public.cosmetic_collections col on col.id=f.collection_id
  left join lateral (
    select true owned from public.cosmetic_grants g
    where g.cosmetic_id=f.id and g.identity_id=v.identity_id and g.removed_at is null
    limit 1
  ) own on true
  where f.campaign_id=c and f.kind='frame'
    and (v.master or (f.active and f.archived_at is null and f.visible))
  order by f.display_order,f.name,f.id
$$;
revoke all on function public.frame_catalog(uuid) from public,anon;
grant execute on function public.frame_catalog(uuid) to authenticated,service_role;

create or replace function public.frame_owners(c uuid,frame_id uuid)
returns table(identity_id uuid,name text,username text,granted_at timestamptz,granted_by_name text,equipped boolean)
language sql stable security definer set search_path='' as $$
  select i.id,i.name,p.username,g.created_at,coalesce(gp.username,'Pink'),e.identity_id is not null
  from public.cosmetic_grants g
  join public.cosmetics f on f.id=g.cosmetic_id and f.campaign_id=c and f.kind='frame'
  join public.social_identities i on i.id=g.identity_id
  left join public.profiles p on p.id=i.user_id
  left join public.profiles gp on gp.id=g.granted_by
  left join public.cosmetic_equipment e on e.identity_id=i.id and e.kind='frame' and e.cosmetic_id=f.id
  where g.cosmetic_id=frame_id and g.removed_at is null and public.is_master(c)
  order by i.name
$$;
revoke all on function public.frame_owners(uuid,uuid) from public,anon,authenticated;
grant execute on function public.frame_owners(uuid,uuid) to authenticated,service_role;

create or replace function public.frame_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  f cosmetics; target social_identities; result_id uuid; ids jsonb; target_id uuid;
  added integer:=0; skipped integer:=0; asset text; collection_name text;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  if op not in ('equip','unequip') and not is_master(c) then raise exception 'Somente Pink'; end if;

  if op in ('equip','unequip') then
    select * into target from social_identities
      where id=(d->>'identity_id')::uuid and campaign_id=c for update;
    if target.id is null or (not is_master(c) and (target.user_id is distinct from auth.uid() or not target.active)) then
      raise exception 'Perfil não autorizado';
    end if;
    result_id:=target.id;
    if op='unequip' then
      delete from cosmetic_equipment where identity_id=target.id and kind='frame';
    else
      select * into f from cosmetics where id=(d->>'frame_id')::uuid and campaign_id=c
        and kind='frame' and active and archived_at is null;
      if f.id is null then raise exception 'Moldura indisponível'; end if;
      if f.rarity='master' and target.kind<>'master' then raise exception 'Moldura exclusiva de Mestre'; end if;
      if f.exclusive_identity_id is not null and f.exclusive_identity_id<>target.id then raise exception 'Moldura exclusiva de outro jogador'; end if;
      if not exists(select 1 from cosmetic_grants where identity_id=target.id and cosmetic_id=f.id and removed_at is null) then
        raise exception 'Moldura bloqueada';
      end if;
      insert into cosmetic_equipment(identity_id,kind,cosmetic_id) values(target.id,'frame',f.id)
        on conflict(identity_id,kind) do update set cosmetic_id=excluded.cosmetic_id;
    end if;

  elsif op='collection_save' then
    collection_name:=trim(d->>'name');
    if length(collection_name) not between 1 and 80 then raise exception 'Nome da coleção inválido'; end if;
    result_id:=nullif(d->>'id','')::uuid;
    if result_id is null then
      insert into cosmetic_collections(campaign_id,name,display_order)
        values(c,collection_name,coalesce((d->>'display_order')::integer,0)) returning id into result_id;
    else
      update cosmetic_collections set name=collection_name,
        active=coalesce((d->>'active')::boolean,active),display_order=coalesce((d->>'display_order')::integer,display_order)
      where id=result_id and campaign_id=c;
      if not found then raise exception 'Coleção inválida'; end if;
    end if;

  elsif op in ('save','duplicate') then
    if op='duplicate' then
      select * into f from cosmetics where id=(d->>'frame_id')::uuid and campaign_id=c and kind='frame';
      if f.id is null then raise exception 'Moldura inválida'; end if;
      insert into cosmetics(campaign_id,kind,name,description,color,icon,active,asset_path,rarity,collection_id,
        acquisition_origin,visible,secret,display_order,scale,offset_x,offset_y,effects,exclusive_identity_id)
      values(c,'frame',left(f.name||' (cópia)',100),f.description,f.color,f.icon,false,f.asset_path,f.rarity,f.collection_id,
        f.acquisition_origin,f.visible,f.secret,f.display_order+1,f.scale,f.offset_x,f.offset_y,f.effects,f.exclusive_identity_id)
      returning id into result_id;
    else
      result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
      asset:=nullif(d->>'asset_path','');
      if asset is not null and (
        split_part(asset,'/',1)<>c::text or split_part(asset,'/',2)<>'frames'
        or not exists(select 1 from storage.objects o where o.bucket_id='avatar-frames' and o.name=asset)
      ) then raise exception 'Arquivo de moldura inválido'; end if;
      if nullif(d->>'collection_id','') is not null and not exists(
        select 1 from cosmetic_collections where id=(d->>'collection_id')::uuid and campaign_id=c
      ) then raise exception 'Coleção inválida'; end if;
      if nullif(d->>'exclusive_identity_id','') is not null and not exists(
        select 1 from social_identities where id=(d->>'exclusive_identity_id')::uuid and campaign_id=c and active
      ) then raise exception 'Jogador exclusivo inválido'; end if;
      insert into cosmetics(id,campaign_id,kind,name,description,color,icon,active,asset_path,rarity,collection_id,
        acquisition_origin,visible,secret,archived_at,display_order,scale,offset_x,offset_y,effects,exclusive_identity_id,updated_at)
      values(result_id,c,'frame',trim(d->>'name'),left(coalesce(d->>'description',''),2000),'#D02A43','star',
        coalesce((d->>'active')::boolean,true),asset,coalesce(d->>'rarity','common'),nullif(d->>'collection_id','')::uuid,
        coalesce(d->>'acquisition_origin','manual'),coalesce((d->>'visible')::boolean,true),coalesce((d->>'secret')::boolean,false),
        case when coalesce((d->>'archived')::boolean,false) then now() end,coalesce((d->>'display_order')::integer,0),
        coalesce((d->>'scale')::numeric,1),coalesce((d->>'offset_x')::numeric,0),coalesce((d->>'offset_y')::numeric,0),
        coalesce(d->'effects','[]'::jsonb),nullif(d->>'exclusive_identity_id','')::uuid,now())
      on conflict(id) do update set name=excluded.name,description=excluded.description,active=excluded.active,
        asset_path=coalesce(excluded.asset_path,cosmetics.asset_path),rarity=excluded.rarity,collection_id=excluded.collection_id,
        acquisition_origin=excluded.acquisition_origin,visible=excluded.visible,secret=excluded.secret,
        display_order=excluded.display_order,scale=excluded.scale,offset_x=excluded.offset_x,offset_y=excluded.offset_y,
        effects=excluded.effects,exclusive_identity_id=excluded.exclusive_identity_id,updated_at=now()
      where cosmetics.campaign_id=c and cosmetics.kind='frame';
      if not found then raise exception 'Moldura inválida'; end if;
      if not coalesce((d->>'active')::boolean,true) then
        delete from cosmetic_equipment where cosmetic_id=result_id;
      end if;
    end if;

  elsif op in ('archive','reactivate') then
    result_id:=(d->>'frame_id')::uuid;
    update cosmetics set archived_at=case when op='archive' then now() else null end,
      active=case when op='archive' then false else true end,updated_at=now()
    where id=result_id and campaign_id=c and kind='frame';
    if not found then raise exception 'Moldura inválida'; end if;
    if op='archive' then delete from cosmetic_equipment where cosmetic_id=result_id; end if;

  elsif op='grant' then
    select * into f from cosmetics where id=(d->>'frame_id')::uuid and campaign_id=c and kind='frame' and archived_at is null;
    if f.id is null then raise exception 'Moldura inválida'; end if;
    ids:=coalesce(d->'identity_ids',jsonb_build_array(d->>'identity_id'));
    if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)=0 or jsonb_array_length(ids)>100 then raise exception 'Destinatários inválidos'; end if;
    for target_id in select value::text::uuid from jsonb_array_elements_text(ids) loop
      select * into target from social_identities where id=target_id and campaign_id=c and active for update;
      if target.id is null or target.kind='npc' then raise exception 'Jogador inválido'; end if;
      if f.rarity='master' and target.kind<>'master' then raise exception 'Moldura exclusiva de Mestre'; end if;
      if f.exclusive_identity_id is not null and f.exclusive_identity_id<>target.id then raise exception 'Moldura exclusiva de outro jogador'; end if;
      if exists(select 1 from cosmetic_grants where identity_id=target.id and cosmetic_id=f.id and removed_at is null) then
        skipped:=skipped+1;
      else
        insert into cosmetic_grants(identity_id,cosmetic_id,origin,note,created_at,granted_by,removed_at,removed_by)
        values(target.id,f.id,'gift',left(coalesce(d->>'note',''),500),now(),auth.uid(),null,null)
        on conflict(identity_id,cosmetic_id) do update set origin='gift',note=excluded.note,created_at=now(),
          granted_by=auth.uid(),removed_at=null,removed_by=null;
        added:=added+1;
        if target.user_id is not null then
          insert into notifications(campaign_id,user_id,kind,title,reference_id)
          values(c,target.user_id,'cosmetic','Nova moldura desbloqueada: '||f.name,f.id::text);
        end if;
      end if;
    end loop;
    result_id:=f.id;
    if added=0 and jsonb_array_length(ids)=1 then raise exception 'Jogador já possui esta moldura'; end if;

  elsif op='revoke' then
    result_id:=(d->>'frame_id')::uuid; target_id:=(d->>'identity_id')::uuid;
    delete from cosmetic_equipment where identity_id=target_id and cosmetic_id=result_id;
    update cosmetic_grants set removed_at=now(),removed_by=auth.uid()
      where identity_id=target_id and cosmetic_id=result_id and removed_at is null
      and exists(select 1 from cosmetics cf where cf.id=result_id and cf.campaign_id=c and cf.kind='frame');
    if not found then raise exception 'Concessão ativa não encontrada'; end if;

  elsif op='delete' then
    result_id:=(d->>'frame_id')::uuid;
    select asset_path into asset from cosmetics where id=result_id and campaign_id=c and kind='frame';
    if not found then raise exception 'Moldura inválida'; end if;
    if exists(select 1 from cosmetic_grants where cosmetic_id=result_id) then
      raise exception 'Arquive a moldura: existe histórico de concessão';
    end if;
    if exists(select 1 from cosmetics where id<>result_id and asset_path=asset) then
      asset:=null;
    end if;
    delete from cosmetics where id=result_id;
  else raise exception 'Operação inválida'; end if;

  perform record_event(c,null,'frame_'||op,jsonb_build_object('id',result_id,'input',d));
  return jsonb_build_object('id',result_id,'added',added,'skipped',skipped,'asset_path',asset);
end$$;
revoke all on function public.frame_action(uuid,text,jsonb) from public,anon;
grant execute on function public.frame_action(uuid,text,jsonb) to authenticated,service_role;
