alter table public.campaign_avatars
  add column rarity text not null default 'common'
    check (rarity in ('common','uncommon','rare','epic','legendary','event','supporter','master'));

alter table public.cosmetics
  add column chest_only boolean not null default false;

alter table public.chest_rewards
  add column claimed_at timestamptz,
  add column claimed_by_identity_id uuid references public.social_identities(id) on delete set null;

create unique index chest_rewards_campaign_avatar_unique
  on public.chest_rewards(campaign_id,avatar_id) where avatar_id is not null;
create unique index chest_rewards_campaign_cosmetic_unique
  on public.chest_rewards(campaign_id,cosmetic_id) where cosmetic_id is not null;
create index chest_rewards_claimed_by_idx
  on public.chest_rewards(claimed_by_identity_id) where claimed_by_identity_id is not null;

-- A raridade do próprio cosmético é a fonte de verdade.
update public.chest_rewards r
set rarity=a.rarity
from public.campaign_avatars a
where r.avatar_id=a.id and r.rarity is distinct from a.rarity;

update public.chest_rewards r
set rarity=x.rarity
from public.cosmetics x
where r.cosmetic_id=x.id and r.rarity is distinct from x.rarity;

update public.cosmetics x
set chest_only=true
where exists(select 1 from public.chest_rewards r where r.cosmetic_id=x.id);

create or replace function alvorecer_private.can_read_frame_asset(asset text)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.cosmetics c
    where c.kind in ('frame','medal') and c.asset_path=asset
      and public.is_member(c.campaign_id)
      and (
        public.is_master(c.campaign_id)
        or (
          c.active and (
            exists(
              select 1 from public.cosmetic_equipment e
              join public.social_identities i on i.id=e.identity_id
              where e.cosmetic_id=c.id and i.campaign_id=c.campaign_id and i.active
            )
            or exists(
              select 1 from public.cosmetic_grants g
              join public.social_identities i on i.id=g.identity_id
              where g.cosmetic_id=c.id and g.removed_at is null
                and i.user_id=(select auth.uid())
            )
            or (
              c.archived_at is null and c.visible and not c.chest_only
              and (not c.secret or exists(
                select 1 from public.cosmetic_grants g
                join public.social_identities i on i.id=g.identity_id
                where g.cosmetic_id=c.id and g.removed_at is null
                  and i.user_id=(select auth.uid())
              ))
            )
          )
        )
      )
  )
$$;

drop policy if exists cosmetics_read on public.cosmetics;
create policy cosmetics_read on public.cosmetics for select to authenticated using(
  (select public.is_member(campaign_id)) and (
    kind<>'frame'
    or (select public.is_master(campaign_id))
    or exists(
      select 1 from public.cosmetic_grants g
      join public.social_identities i on i.id=g.identity_id
      where g.cosmetic_id=cosmetics.id and g.removed_at is null
        and i.user_id=(select auth.uid())
    )
    or (
      active and archived_at is null and visible and not chest_only and not secret
    )
    or exists(
      select 1 from public.cosmetic_equipment e
      join public.social_identities i on i.id=e.identity_id
      where e.cosmetic_id=cosmetics.id and i.campaign_id=cosmetics.campaign_id and i.active
    )
  )
);

drop function if exists public.frame_catalog(uuid);
create function public.frame_catalog(c uuid)
returns table(
  id uuid,campaign_id uuid,kind text,name text,description text,color text,icon text,
  active boolean,asset_path text,rarity text,collection_id uuid,collection_name text,
  acquisition_origin text,visible boolean,secret boolean,archived_at timestamptz,
  display_order integer,scale numeric,offset_x numeric,offset_y numeric,effects jsonb,
  exclusive_identity_id uuid,created_at timestamptz,updated_at timestamptz,
  owned boolean,chest_only boolean
)
language sql stable security definer set search_path=''
as $$
  with viewer as (
    select public.is_master(c) master,i.id identity_id
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
    f.acquisition_origin,f.visible,f.secret,f.archived_at,f.display_order,f.scale,f.offset_x,f.offset_y,
    case when f.secret and not v.master and not coalesce(own.owned,false)
      and not coalesce(public_use.equipped,false) then '[]'::jsonb else f.effects end,
    f.exclusive_identity_id,f.created_at,f.updated_at,coalesce(own.owned,false),f.chest_only
  from public.cosmetics f cross join viewer v
  left join public.cosmetic_collections col on col.id=f.collection_id
  left join lateral (
    select true owned from public.cosmetic_grants g
    where g.cosmetic_id=f.id and g.identity_id=v.identity_id and g.removed_at is null limit 1
  ) own on true
  left join lateral (
    select true equipped from public.cosmetic_equipment e
    join public.social_identities i on i.id=e.identity_id
    where e.cosmetic_id=f.id and e.kind='frame' and i.campaign_id=c and i.active limit 1
  ) public_use on true
  where f.campaign_id=c and f.kind='frame' and (
    v.master or (f.active and (
      coalesce(own.owned,false) or coalesce(public_use.equipped,false)
      or (f.archived_at is null and f.visible and not f.chest_only)
    ))
  )
  order by f.display_order,f.name,f.id
$$;

create or replace function alvorecer_private.enforce_avatar_assignment()
returns trigger language plpgsql security definer set search_path=public
as $$
declare selected_avatar campaign_avatars; target_user uuid; target_role text; target_identity uuid;
begin
  if new.avatar_id is null then
    if tg_table_name='characters' then new.image:=null; end if;
    return new;
  end if;
  if tg_op='UPDATE' and new.avatar_id is not distinct from old.avatar_id then return new; end if;
  target_user:=case when tg_table_name='characters' then new.owner_id else new.user_id end;
  select * into selected_avatar from campaign_avatars
    where id=new.avatar_id and campaign_id=new.campaign_id for update;
  if selected_avatar.id is null then raise exception 'Avatar inválido'; end if;
  if tg_table_name='characters' then new.image:=selected_avatar.storage_path; end if;
  if not selected_avatar.active then raise exception 'Avatar desativado'; end if;
  if target_user is null then
    if not is_master(new.campaign_id) then raise exception 'Avatar não permitido'; end if;
    return new;
  end if;
  select role into target_role from campaign_members
    where campaign_id=new.campaign_id and user_id=target_user and access_active and archived_at is null;
  if target_role='master' then return new; end if;
  if target_role is distinct from 'player' then raise exception 'Jogador inválido'; end if;
  select id into target_identity from social_identities
    where campaign_id=new.campaign_id and user_id=target_user and active limit 1;
  if selected_avatar.blocked then raise exception 'Avatar bloqueado'; end if;
  if selected_avatar.exclusive_user_id is not null and selected_avatar.exclusive_user_id<>target_user then
    raise exception 'Avatar exclusivo de outro jogador';
  end if;
  if (selected_avatar.archived_at is not null or selected_avatar.chest_only)
     and selected_avatar.exclusive_user_id is distinct from target_user
     and not exists(select 1 from avatar_grants g where g.identity_id=target_identity and g.avatar_id=selected_avatar.id) then
    raise exception 'Avatar ainda não conquistado';
  end if;
  if not selected_avatar.shared and exists(
    select 1 from (
      select i.user_id from social_identities i join campaign_members m on m.campaign_id=i.campaign_id and m.user_id=i.user_id
      where i.campaign_id=new.campaign_id and i.avatar_id=new.avatar_id and i.user_id is not null and i.kind='player'
        and m.role='player' and m.access_active and m.archived_at is null
      union
      select ch.owner_id from characters ch join campaign_members m on m.campaign_id=ch.campaign_id and m.user_id=ch.owner_id
      where ch.campaign_id=new.campaign_id and ch.avatar_id=new.avatar_id and ch.owner_id is not null and not ch.archived
        and m.role='player' and m.access_active and m.archived_at is null
    ) current_usage where current_usage.user_id<>target_user
  ) then raise exception 'Avatar já está em uso'; end if;
  return new;
end$$;

create or replace function public.frame_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare f cosmetics; target social_identities; result_id uuid; ids jsonb; target_id uuid;
  added integer:=0; skipped integer:=0; asset text; collection_name text;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  if op not in ('equip','unequip') and not is_master(c) then raise exception 'Somente Pink'; end if;
  if op in ('equip','unequip') then
    select * into target from social_identities where id=(d->>'identity_id')::uuid and campaign_id=c for update;
    if target.id is null or (not is_master(c) and (target.user_id is distinct from auth.uid() or not target.active)) then
      raise exception 'Perfil não autorizado';
    end if;
    result_id:=target.id;
    if op='unequip' then delete from cosmetic_equipment where identity_id=target.id and kind='frame';
    else
      select * into f from cosmetics where id=(d->>'frame_id')::uuid and campaign_id=c and kind='frame' and active;
      if f.id is null then raise exception 'Moldura indisponível'; end if;
      if f.rarity='master' and target.kind<>'master' then raise exception 'Moldura exclusiva de Mestre'; end if;
      if target.kind<>'master' and f.exclusive_identity_id is not null and f.exclusive_identity_id<>target.id then
        raise exception 'Moldura exclusiva de outro jogador';
      end if;
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
      update cosmetic_collections set name=collection_name,active=coalesce((d->>'active')::boolean,active),
        display_order=coalesce((d->>'display_order')::integer,display_order) where id=result_id and campaign_id=c;
      if not found then raise exception 'Coleção inválida'; end if;
    end if;
  elsif op in ('save','duplicate') then
    if op='duplicate' then
      select * into f from cosmetics where id=(d->>'frame_id')::uuid and campaign_id=c and kind='frame';
      if f.id is null then raise exception 'Moldura inválida'; end if;
      insert into cosmetics(campaign_id,kind,name,description,color,icon,active,asset_path,rarity,collection_id,
        acquisition_origin,visible,secret,display_order,scale,offset_x,offset_y,effects,exclusive_identity_id,chest_only)
      values(c,'frame',left(f.name||' (cópia)',100),f.description,f.color,f.icon,false,f.asset_path,f.rarity,f.collection_id,
        f.acquisition_origin,f.visible,f.secret,f.display_order+1,f.scale,f.offset_x,f.offset_y,f.effects,null,false)
      returning id into result_id;
    else
      result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
      if exists(select 1 from cosmetics where id=result_id and campaign_id=c and rarity='legendary'
        and exclusive_identity_id is not null and coalesce(d->>'rarity','common')<>'legendary') then
        raise exception 'Libere o prêmio lendário antes de alterar sua raridade';
      end if;
      asset:=nullif(d->>'asset_path','');
      if asset is not null and (split_part(asset,'/',1)<>c::text or split_part(asset,'/',2)<>'frames'
        or not exists(select 1 from storage.objects o where o.bucket_id='avatar-frames' and o.name=asset)) then
        raise exception 'Arquivo de moldura inválido';
      end if;
      if nullif(d->>'collection_id','') is not null and not exists(select 1 from cosmetic_collections
        where id=(d->>'collection_id')::uuid and campaign_id=c) then raise exception 'Coleção inválida'; end if;
      if nullif(d->>'exclusive_identity_id','') is not null and not exists(select 1 from social_identities
        where id=(d->>'exclusive_identity_id')::uuid and campaign_id=c and active) then raise exception 'Jogador exclusivo inválido'; end if;
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
      update chest_rewards set rarity=(select rarity from cosmetics where id=result_id),updated_at=now() where cosmetic_id=result_id;
      if not coalesce((d->>'active')::boolean,true) then
        delete from cosmetic_equipment where cosmetic_id=result_id;
        update chest_rewards set active=false,updated_at=now() where cosmetic_id=result_id;
      end if;
    end if;
  elsif op in ('archive','reactivate','disable','enable') then
    result_id:=(d->>'frame_id')::uuid;
    if not exists(select 1 from cosmetics where id=result_id and campaign_id=c and kind='frame') then
      raise exception 'Moldura inválida';
    end if;
    if op='archive' then
      update cosmetics set archived_at=now(),active=true,updated_at=now() where id=result_id and campaign_id=c and kind='frame';
      update chest_rewards set active=false,updated_at=now() where cosmetic_id=result_id;
    elsif op='reactivate' then
      update cosmetics set archived_at=null,active=true,updated_at=now() where id=result_id and campaign_id=c and kind='frame';
    elsif op='disable' then
      update cosmetics set active=false,updated_at=now() where id=result_id and campaign_id=c and kind='frame';
      delete from cosmetic_equipment where cosmetic_id=result_id;
      update chest_rewards set active=false,updated_at=now() where cosmetic_id=result_id;
    else update cosmetics set active=true,updated_at=now() where id=result_id and campaign_id=c and kind='frame'; end if;
  elsif op='grant' then
    select * into f from cosmetics where id=(d->>'frame_id')::uuid and campaign_id=c and kind='frame' and active and archived_at is null for update;
    if f.id is null then raise exception 'Moldura inválida'; end if;
    ids:=coalesce(d->'identity_ids',jsonb_build_array(d->>'identity_id'));
    if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)=0 or jsonb_array_length(ids)>100 then raise exception 'Destinatários inválidos'; end if;
    if f.rarity='legendary' and jsonb_array_length(ids)<>1 then raise exception 'Moldura lendária só pode ter um dono'; end if;
    for target_id in select value::text::uuid from jsonb_array_elements_text(ids) loop
      select * into target from social_identities where id=target_id and campaign_id=c and active for update;
      if target.id is null or target.kind='npc' then raise exception 'Jogador inválido'; end if;
      if f.rarity='master' and target.kind<>'master' then raise exception 'Moldura exclusiva de Mestre'; end if;
      if f.rarity='legendary' then
        update cosmetics set exclusive_identity_id=target.id where id=f.id
          and (exclusive_identity_id is null or exclusive_identity_id=target.id);
        if not found then raise exception 'Moldura lendária já pertence a outro jogador'; end if;
      elsif target.kind<>'master' and f.exclusive_identity_id is not null and f.exclusive_identity_id<>target.id then
        raise exception 'Moldura exclusiva de outro jogador';
      end if;
      if exists(select 1 from cosmetic_grants where identity_id=target.id and cosmetic_id=f.id and removed_at is null) then skipped:=skipped+1;
      else
        insert into cosmetic_grants(identity_id,cosmetic_id,origin,note,created_at,granted_by,removed_at,removed_by)
        values(target.id,f.id,'gift',left(coalesce(d->>'note',''),500),now(),auth.uid(),null,null)
        on conflict(identity_id,cosmetic_id) do update set origin='gift',note=excluded.note,created_at=now(),granted_by=auth.uid(),removed_at=null,removed_by=null;
        added:=added+1;
        if f.rarity='legendary' then
          update chest_rewards set active=false,claimed_at=coalesce(claimed_at,now()),claimed_by_identity_id=target.id,updated_at=now()
            where cosmetic_id=f.id;
        end if;
        if target.user_id is not null then insert into notifications(campaign_id,user_id,kind,title,reference_id)
          values(c,target.user_id,'cosmetic','Nova moldura desbloqueada: '||f.name,f.id::text); end if;
      end if;
    end loop;
    result_id:=f.id;
    if added=0 and jsonb_array_length(ids)=1 then raise exception 'Jogador já possui esta moldura'; end if;
  elsif op='revoke' then
    result_id:=(d->>'frame_id')::uuid; target_id:=(d->>'identity_id')::uuid;
    if exists(select 1 from cosmetics where id=result_id and rarity='legendary' and exclusive_identity_id=target_id) then
      raise exception 'Use “Liberar novamente” no Baú para remover um prêmio lendário';
    end if;
    delete from cosmetic_equipment where identity_id=target_id and cosmetic_id=result_id;
    update cosmetic_grants set removed_at=now(),removed_by=auth.uid() where identity_id=target_id and cosmetic_id=result_id
      and removed_at is null and exists(select 1 from cosmetics cf where cf.id=result_id and cf.campaign_id=c and cf.kind='frame');
    if not found then raise exception 'Concessão ativa não encontrada'; end if;
  elsif op='delete' then
    result_id:=(d->>'frame_id')::uuid;
    select asset_path into asset from cosmetics where id=result_id and campaign_id=c and kind='frame';
    if not found then raise exception 'Moldura inválida'; end if;
    if exists(select 1 from cosmetic_grants where cosmetic_id=result_id and origin<>'master') then
      raise exception 'Arquive a moldura: existe histórico de concessão';
    end if;
    if exists(select 1 from cosmetics where id<>result_id and asset_path=asset) then asset:=null; end if;
    delete from cosmetic_grants where cosmetic_id=result_id and origin='master';
    delete from cosmetics where id=result_id;
  else raise exception 'Operação inválida'; end if;
  perform record_event(c,null,'frame_'||op,jsonb_build_object('id',result_id,'input',d));
  return jsonb_build_object('id',result_id,'added',added,'skipped',skipped,'asset_path',asset);
end$$;

revoke all on function public.avatar_catalog(uuid) from public,anon;
grant execute on function public.avatar_catalog(uuid) to authenticated,service_role;

revoke all on function public.frame_catalog(uuid),public.avatar_catalog(uuid),
  public.chest_open(uuid,uuid,uuid,uuid),public.chest_admin_dashboard(uuid),
  public.chest_admin_action(uuid,text,jsonb),public.frame_action(uuid,text,jsonb) from public,anon;
grant execute on function public.frame_catalog(uuid),public.avatar_catalog(uuid),
  public.chest_open(uuid,uuid,uuid,uuid),public.chest_admin_dashboard(uuid),
  public.chest_admin_action(uuid,text,jsonb),public.frame_action(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.chest_open(c uuid,selected_character uuid,gift uuid,request_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare member public.campaign_members; settings public.chest_settings; identity public.social_identities;
  chosen public.chest_rewards; opening public.chest_openings; gift_row public.chest_gifts; ch public.characters;
  chosen_rarity text; price integer; result jsonb; reward_pending boolean:=false; claimed boolean:=false;
begin
  if request_id is null then raise exception 'Abertura inválida'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  select * into member from public.campaign_members where campaign_id=c and user_id=auth.uid()
    and role='player' and access_active and archived_at is null for update;
  if member.user_id is null then raise exception 'Jogador indisponível'; end if;
  select * into opening from public.chest_openings where user_id=auth.uid() and chest_openings.request_id=chest_open.request_id;
  if opening.id is not null then
    if opening.campaign_id<>c then raise exception 'Identificador reutilizado'; end if;
    return to_jsonb(opening)||jsonb_build_object('gems',member.gems,'pending',opening.character_id is null and opening.reward_type in ('xp','dracmas'));
  end if;

  -- Serializa as aberturas da campanha: dois jogadores nunca reivindicam o mesmo lendário.
  select * into settings from public.chest_settings where campaign_id=c for update;
  if not settings.enabled then raise exception 'Baú temporariamente fechado'; end if;
  select * into identity from public.social_identities where campaign_id=c and user_id=auth.uid() and active limit 1;
  if identity.id is null then raise exception 'Perfil indisponível'; end if;
  if selected_character is not null then
    select * into ch from public.characters where id=selected_character and campaign_id=c and owner_id=auth.uid() and not archived;
    if ch.id is null then raise exception 'Personagem inválido'; end if;
  else
    select * into ch from public.characters where campaign_id=c and owner_id=auth.uid() and not archived order by id limit 1;
  end if;
  if gift is not null then
    select * into gift_row from public.chest_gifts where id=gift and campaign_id=c and recipient_user_id=auth.uid() and status='pending' for update;
    if gift_row.id is null then raise exception 'Presente indisponível'; end if;
    price:=0;
  else
    price:=settings.cost_gems;
    if member.gems<price then raise exception 'Gemas insuficientes'; end if;
  end if;

  select o.rarity into chosen_rarity from public.chest_rarity_odds o
  where o.campaign_id=c and o.weight_bp>0 and exists(
    select 1 from public.chest_rewards r
    left join public.campaign_avatars a on a.id=r.avatar_id
    left join public.cosmetics x on x.id=r.cosmetic_id
    where r.campaign_id=c and r.rarity=o.rarity and r.active and r.claimed_at is null and (
      r.reward_type in ('xp','dracmas')
      or (r.reward_type='avatar' and a.active and a.archived_at is null and not a.blocked
        and (r.rarity<>'legendary' or a.exclusive_user_id is null)
        and not exists(select 1 from public.avatar_grants ag where ag.identity_id=identity.id and ag.avatar_id=r.avatar_id))
      or (r.reward_type='frame' and x.active and x.archived_at is null
        and (r.rarity<>'legendary' or x.exclusive_identity_id is null)
        and not exists(select 1 from public.cosmetic_grants cg where cg.identity_id=identity.id and cg.cosmetic_id=r.cosmetic_id and cg.removed_at is null))
    )
  ) order by -ln(greatest(random(),0.0000001))/o.weight_bp limit 1;
  if chosen_rarity is null then raise exception 'Nenhum prêmio disponível'; end if;
  select r.* into chosen from public.chest_rewards r
  left join public.campaign_avatars a on a.id=r.avatar_id
  left join public.cosmetics x on x.id=r.cosmetic_id
  where r.campaign_id=c and r.rarity=chosen_rarity and r.active and r.claimed_at is null and (
    r.reward_type in ('xp','dracmas')
    or (r.reward_type='avatar' and a.active and a.archived_at is null and not a.blocked
      and (r.rarity<>'legendary' or a.exclusive_user_id is null)
      and not exists(select 1 from public.avatar_grants ag where ag.identity_id=identity.id and ag.avatar_id=r.avatar_id))
    or (r.reward_type='frame' and x.active and x.archived_at is null
      and (r.rarity<>'legendary' or x.exclusive_identity_id is null)
      and not exists(select 1 from public.cosmetic_grants cg where cg.identity_id=identity.id and cg.cosmetic_id=r.cosmetic_id and cg.removed_at is null))
  ) order by -ln(greatest(random(),0.0000001))/r.weight limit 1;
  if chosen.id is null then raise exception 'Nenhum prêmio disponível'; end if;

  if chosen.rarity='legendary' and chosen.reward_type='avatar' then
    update public.campaign_avatars set exclusive_user_id=auth.uid(),shared=false
      where id=chosen.avatar_id and exclusive_user_id is null returning true into claimed;
    if not coalesce(claimed,false) then raise exception 'Prêmio lendário já conquistado'; end if;
  elsif chosen.rarity='legendary' and chosen.reward_type='frame' then
    update public.cosmetics set exclusive_identity_id=identity.id
      where id=chosen.cosmetic_id and exclusive_identity_id is null returning true into claimed;
    if not coalesce(claimed,false) then raise exception 'Prêmio lendário já conquistado'; end if;
  end if;

  if price>0 then update public.campaign_members set gems=gems-price
    where campaign_id=c and user_id=auth.uid() returning * into member; end if;
  if chosen.reward_type='xp' then
    if ch.id is null then
      update public.campaign_members set chest_pending_xp=chest_pending_xp+chosen.amount where campaign_id=c and user_id=auth.uid();
      reward_pending:=true;
    else update public.characters set xp=xp+chosen.amount::integer where id=ch.id; end if;
  elsif chosen.reward_type='dracmas' then
    if ch.id is null then
      update public.campaign_members set chest_pending_dracmas_cents=chest_pending_dracmas_cents+(chosen.amount*100) where campaign_id=c and user_id=auth.uid();
      reward_pending:=true;
    else
      update public.characters set dracmas_cents=dracmas_cents+(chosen.amount*100),money=floor((dracmas_cents+(chosen.amount*100))/100.0)::integer where id=ch.id;
      insert into public.dracma_transactions(campaign_id,kind,actor_id,to_user_id,to_character_id,to_label,amount_cents,reason,to_balance_after)
      values(c,'reward',auth.uid(),auth.uid(),ch.id,ch.name,chosen.amount*100,'Prêmio do Baú Dourado',ch.dracmas_cents+(chosen.amount*100));
    end if;
  elsif chosen.reward_type='avatar' then
    insert into public.avatar_grants(identity_id,avatar_id) values(identity.id,chosen.avatar_id) on conflict do nothing;
  else
    insert into public.cosmetic_grants(identity_id,cosmetic_id,origin,note,granted_by)
    values(identity.id,chosen.cosmetic_id,'chest','Prêmio do Baú Dourado',auth.uid())
    on conflict(identity_id,cosmetic_id) do update set removed_at=null,removed_by=null,origin='chest',note='Prêmio do Baú Dourado';
  end if;
  if chosen.rarity='legendary' and chosen.reward_type in ('avatar','frame') then
    update public.chest_rewards set active=false,claimed_at=now(),claimed_by_identity_id=identity.id,updated_at=now() where id=chosen.id;
  end if;
  insert into public.chest_openings(campaign_id,user_id,character_id,gift_id,reward_id,rarity,reward_type,reward_label,reward_amount,avatar_id,cosmetic_id,cost_gems,request_id)
  values(c,auth.uid(),ch.id,gift,chosen.id,chosen.rarity,chosen.reward_type,chosen.label,chosen.amount,chosen.avatar_id,chosen.cosmetic_id,price,request_id)
  returning * into opening;
  if gift is not null then update public.chest_gifts set status='opened',opened_at=now() where id=gift; end if;
  if price>0 then insert into public.gem_transactions(campaign_id,user_id,actor_id,kind,delta,balance_after,reference_id,note)
    values(c,auth.uid(),auth.uid(),'chest_open',-price,member.gems,opening.id,'Abertura do Baú Dourado'); end if;
  result:=to_jsonb(opening)||jsonb_build_object('gems',member.gems,'pending',reward_pending);
  return result;
end$$;

create or replace function public.admin_avatar_action(
  c uuid,target_id uuid,actor uuid,operation text,exclusive_user uuid default null
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare selected_avatar campaign_avatars; new_rarity text;
begin
  if not exists(select 1 from campaign_members where campaign_id=c and user_id=actor
    and role='master' and access_active and archived_at is null) then raise exception 'Somente Pink'; end if;
  select * into selected_avatar from campaign_avatars where id=target_id and campaign_id=c for update;
  if selected_avatar.id is null then raise exception 'Avatar inválido'; end if;

  if operation='block' then update campaign_avatars set blocked=true where id=target_id;
  elsif operation='unblock' then update campaign_avatars set blocked=false where id=target_id;
  elsif operation='share' then
    if selected_avatar.rarity='legendary' and selected_avatar.exclusive_user_id is not null then
      raise exception 'Avatar lendário conquistado não pode ser compartilhado';
    end if;
    update campaign_avatars set shared=true,exclusive_user_id=null where id=target_id;
  elsif operation='unshare' then update campaign_avatars set shared=false where id=target_id;
  elsif operation='exclusive' then
    if exclusive_user is null or not exists(select 1 from campaign_members where campaign_id=c and user_id=exclusive_user
      and role='player' and access_active and archived_at is null) then raise exception 'Jogador exclusivo inválido'; end if;
    if selected_avatar.rarity='legendary' and selected_avatar.exclusive_user_id is not null
       and selected_avatar.exclusive_user_id<>exclusive_user then raise exception 'Libere o prêmio lendário antes de trocar o dono'; end if;
    update campaign_avatars set exclusive_user_id=exclusive_user,shared=false where id=target_id;
  elsif operation='clear_exclusive' then
    if selected_avatar.rarity='legendary' and exists(select 1 from avatar_grants where avatar_id=target_id) then
      raise exception 'Use “Liberar novamente” no Baú para remover o dono lendário';
    end if;
    update campaign_avatars set exclusive_user_id=null where id=target_id;
  elsif operation='archive' then
    update campaign_avatars set archived_at=now(),active=true where id=target_id;
    update chest_rewards set active=false,updated_at=now() where avatar_id=target_id;
  elsif operation='reactivate' then update campaign_avatars set archived_at=null,active=true where id=target_id;
  elsif operation='disable' then
    update campaign_avatars set active=false where id=target_id;
    update social_identities set avatar_id=null where campaign_id=c and avatar_id=target_id;
    update characters set avatar_id=null,image=null where campaign_id=c and avatar_id=target_id;
    update chest_rewards set active=false,updated_at=now() where avatar_id=target_id;
  elsif operation='enable' then update campaign_avatars set active=true where id=target_id;
  elsif operation like 'rarity:%' then
    new_rarity:=split_part(operation,':',2);
    if new_rarity not in ('common','uncommon','rare','epic','legendary','event','supporter','master') then
      raise exception 'Raridade inválida';
    end if;
    if selected_avatar.exclusive_user_id is not null and selected_avatar.rarity='legendary' and new_rarity<>'legendary' then
      raise exception 'Libere o prêmio lendário antes de alterar sua raridade';
    end if;
    update campaign_avatars set rarity=new_rarity where id=target_id;
    update chest_rewards set rarity=new_rarity,updated_at=now() where avatar_id=target_id;
  else raise exception 'Operação de avatar inválida'; end if;

  perform record_event(c,null,'avatar_'||replace(operation,':','_'),jsonb_build_object(
    'avatar_id',target_id,'name',selected_avatar.name,'exclusive_user_id',exclusive_user
  ),actor);
  return jsonb_build_object('id',target_id,'operation',operation);
end$$;

create or replace function public.chest_admin_dashboard(c uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.is_master(c) then raise exception 'Somente Pink'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  return jsonb_build_object(
    'settings',(select to_jsonb(s) from public.chest_settings s where s.campaign_id=c),
    'odds',(select jsonb_agg(to_jsonb(o) order by case o.rarity when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'epic' then 4 else 5 end) from public.chest_rarity_odds o where o.campaign_id=c),
    'rewards',(select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'claimed_username',p.username,'claimed_name',coalesce(nullif(i.name,''),nullif(p.display_name,''),p.username)
    ) order by r.display_order,r.created_at),'[]'::jsonb)
      from public.chest_rewards r
      left join public.social_identities i on i.id=r.claimed_by_identity_id
      left join public.profiles p on p.id=i.user_id where r.campaign_id=c),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(i.name,p.username),'gems',m.gems) order by coalesce(i.name,p.username)),'[]'::jsonb)
      from public.campaign_members m join public.profiles p on p.id=m.user_id left join public.social_identities i on i.campaign_id=m.campaign_id and i.user_id=m.user_id
      where m.campaign_id=c and m.role='player' and m.access_active and m.archived_at is null),
    'avatars',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'storage_path',a.storage_path,
      'chest_only',a.chest_only,'rarity',a.rarity,'claimed',a.exclusive_user_id is not null) order by a.name),'[]'::jsonb)
      from public.campaign_avatars a where a.campaign_id=c and a.active and a.archived_at is null and not a.blocked
        and a.rarity in ('common','uncommon','rare','epic','legendary')),
    'frames',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'rarity',x.rarity,'asset_path',x.asset_path,
      'chest_only',x.chest_only,'claimed',x.exclusive_identity_id is not null) order by x.name),'[]'::jsonb)
      from public.cosmetics x where x.campaign_id=c and x.kind='frame' and x.active and x.archived_at is null
        and x.rarity in ('common','uncommon','rare','epic','legendary'))
  );
end$$;

create or replace function public.chest_admin_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare target public.campaign_members; reward public.chest_rewards; rid uuid; delta integer;
  odds_total integer; item_rarity text; winner_user uuid;
begin
  if not public.is_master(c) then raise exception 'Somente Pink'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  if op='adjust_gems' then
    delta:=coalesce((d->>'delta')::integer,0);
    if delta=0 then raise exception 'Informe a quantidade de Gemas'; end if;
    select * into target from public.campaign_members where campaign_id=c and user_id=(d->>'user_id')::uuid and role='player' for update;
    if target.user_id is null or target.gems+delta<0 then raise exception 'Saldo de Gemas inválido'; end if;
    update public.campaign_members set gems=gems+delta where campaign_id=c and user_id=target.user_id returning * into target;
    insert into public.gem_transactions(campaign_id,user_id,actor_id,kind,delta,balance_after,note)
    values(c,target.user_id,auth.uid(),'admin_adjustment',delta,target.gems,left(coalesce(d->>'note','Ajuste do Mestre'),200));
    return jsonb_build_object('gems',target.gems);
  elsif op='settings' then
    update public.chest_settings set cost_gems=coalesce((d->>'cost_gems')::integer,cost_gems),
      enabled=coalesce((d->>'enabled')::boolean,enabled),updated_at=now(),updated_by=auth.uid() where campaign_id=c;
  elsif op='odds' then
    update public.chest_rarity_odds o set weight_bp=(d->>o.rarity)::integer where o.campaign_id=c and d ? o.rarity;
    select sum(weight_bp) into odds_total from public.chest_rarity_odds where campaign_id=c;
    if odds_total<>10000 then raise exception 'As probabilidades devem somar 100%%'; end if;
  elsif op='reward_save' then
    rid:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
    if exists(select 1 from public.chest_rewards r where r.id=rid and r.campaign_id<>c) then raise exception 'Prêmio inválido'; end if;
    if d->>'reward_type'='avatar' then
      select a.rarity into item_rarity from public.campaign_avatars a
      where a.id=(d->>'avatar_id')::uuid and a.campaign_id=c and a.active and a.archived_at is null and not a.blocked
        and a.rarity in ('common','uncommon','rare','epic','legendary');
      if item_rarity is null then raise exception 'Avatar inválido'; end if;
      if exists(select 1 from public.campaign_avatars a where a.id=(d->>'avatar_id')::uuid and a.exclusive_user_id is not null) then
        raise exception 'Avatar já pertence exclusivamente a um jogador'; end if;
      update public.campaign_avatars set chest_only=true where id=(d->>'avatar_id')::uuid;
    elsif d->>'reward_type'='frame' then
      select x.rarity into item_rarity from public.cosmetics x
      where x.id=(d->>'cosmetic_id')::uuid and x.campaign_id=c and x.kind='frame' and x.active and x.archived_at is null
        and x.rarity in ('common','uncommon','rare','epic','legendary');
      if item_rarity is null then raise exception 'Moldura inválida para o Baú'; end if;
      if exists(select 1 from public.cosmetics x where x.id=(d->>'cosmetic_id')::uuid and x.exclusive_identity_id is not null) then
        raise exception 'Moldura já pertence exclusivamente a um jogador'; end if;
      update public.cosmetics set chest_only=true where id=(d->>'cosmetic_id')::uuid;
    elsif d->>'reward_type' in ('xp','dracmas') and coalesce((d->>'amount')::bigint,0)>0 then
      item_rarity:=d->>'rarity';
    else raise exception 'Prêmio inválido'; end if;
    if item_rarity not in ('common','uncommon','rare','epic','legendary') then raise exception 'Raridade inválida'; end if;
    insert into public.chest_rewards(id,campaign_id,rarity,reward_type,label,amount,avatar_id,cosmetic_id,weight,active,display_order,updated_at)
    values(rid,c,item_rarity,d->>'reward_type',trim(d->>'label'),nullif(d->>'amount','')::bigint,
      nullif(d->>'avatar_id','')::uuid,nullif(d->>'cosmetic_id','')::uuid,coalesce((d->>'weight')::integer,1),
      coalesce((d->>'active')::boolean,true),coalesce((d->>'display_order')::integer,0),now())
    on conflict(id) do update set rarity=excluded.rarity,reward_type=excluded.reward_type,label=excluded.label,
      amount=excluded.amount,avatar_id=excluded.avatar_id,cosmetic_id=excluded.cosmetic_id,weight=excluded.weight,
      active=excluded.active,display_order=excluded.display_order,updated_at=now()
    returning * into reward;
    return to_jsonb(reward);
  elsif op='reward_toggle' then
    if coalesce((d->>'active')::boolean,false) and exists(select 1 from public.chest_rewards r
      where r.id=(d->>'id')::uuid and r.campaign_id=c and r.claimed_at is not null) then
      raise exception 'Prêmio lendário já conquistado. Libere-o antes de reativar';
    end if;
    update public.chest_rewards set active=coalesce((d->>'active')::boolean,false),updated_at=now()
      where id=(d->>'id')::uuid and campaign_id=c returning * into reward;
    if reward.id is null then raise exception 'Prêmio não encontrado'; end if;
    return to_jsonb(reward);
  elsif op='reward_release' then
    select * into reward from public.chest_rewards where id=(d->>'id')::uuid and campaign_id=c for update;
    if reward.id is null or reward.rarity<>'legendary' or reward.claimed_by_identity_id is null then
      raise exception 'Prêmio lendário conquistado não encontrado';
    end if;
    select user_id into winner_user from public.social_identities where id=reward.claimed_by_identity_id;
    if reward.reward_type='frame' then
      delete from public.cosmetic_equipment where identity_id=reward.claimed_by_identity_id and cosmetic_id=reward.cosmetic_id;
      update public.cosmetic_grants set removed_at=now(),removed_by=auth.uid()
        where identity_id=reward.claimed_by_identity_id and cosmetic_id=reward.cosmetic_id and removed_at is null;
      update public.cosmetics set exclusive_identity_id=null where id=reward.cosmetic_id;
    elsif reward.reward_type='avatar' then
      update public.social_identities set avatar_id=null where campaign_id=c and user_id=winner_user and avatar_id=reward.avatar_id;
      update public.characters set avatar_id=null,image=null where campaign_id=c and owner_id=winner_user and avatar_id=reward.avatar_id;
      delete from public.avatar_grants where identity_id=reward.claimed_by_identity_id and avatar_id=reward.avatar_id;
      update public.campaign_avatars set exclusive_user_id=null where id=reward.avatar_id;
    else raise exception 'Somente cosméticos lendários podem ser liberados'; end if;
    update public.chest_rewards set claimed_at=null,claimed_by_identity_id=null,
      active=case when reward.reward_type='frame' then exists(select 1 from public.cosmetics x where x.id=reward.cosmetic_id and x.active and x.archived_at is null)
                  else exists(select 1 from public.campaign_avatars a where a.id=reward.avatar_id and a.active and a.archived_at is null and not a.blocked) end,
      updated_at=now() where id=reward.id returning * into reward;
    return to_jsonb(reward);
  elsif op='reward_delete' then
    delete from public.chest_rewards where id=(d->>'id')::uuid and campaign_id=c returning * into reward;
    if reward.id is null then raise exception 'Prêmio não encontrado'; end if;
    if reward.reward_type='avatar' and not exists(select 1 from public.chest_rewards r where r.campaign_id=c and r.avatar_id=reward.avatar_id) then
      update public.campaign_avatars set chest_only=false where id=reward.avatar_id and campaign_id=c;
    elsif reward.reward_type='frame' and not exists(select 1 from public.chest_rewards r where r.campaign_id=c and r.cosmetic_id=reward.cosmetic_id) then
      update public.cosmetics set chest_only=false where id=reward.cosmetic_id and campaign_id=c;
    end if;
    return to_jsonb(reward);
  else raise exception 'Operação inválida'; end if;
  return jsonb_build_object('ok',true);
end$$;

drop function if exists public.avatar_catalog(uuid);
create function public.avatar_catalog(c uuid)
returns table(
  id uuid,campaign_id uuid,name text,storage_path text,active boolean,blocked boolean,
  shared boolean,exclusive_user_id uuid,created_by uuid,created_at timestamptz,
  archived_at timestamptz,rarity text,chest_only boolean,owned boolean,state text,
  usage jsonb,usage_count bigint,occupied_by_other boolean,exclusive_username text,exclusive_name text
)
language plpgsql stable security definer set search_path=public
as $$
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  return query
  with viewer as (
    select i.id identity_id from social_identities i
    where i.campaign_id=c and i.user_id=auth.uid() and i.active limit 1
  ), raw_usage as (
    select i.avatar_id,i.user_id from social_identities i join campaign_members m on m.campaign_id=i.campaign_id and m.user_id=i.user_id
    where i.campaign_id=c and i.avatar_id is not null and i.user_id is not null and i.kind='player' and m.role='player' and m.access_active and m.archived_at is null
    union
    select ch.avatar_id,ch.owner_id from characters ch join campaign_members m on m.campaign_id=ch.campaign_id and m.user_id=ch.owner_id
    where ch.campaign_id=c and ch.avatar_id is not null and ch.owner_id is not null and not ch.archived and m.role='player' and m.access_active and m.archived_at is null
  ), grouped_usage as (
    select u.avatar_id,jsonb_agg(jsonb_build_object('user_id',p.id,'username',p.username,'name',coalesce(nullif(p.display_name,''),p.username)) order by coalesce(nullif(p.display_name,''),p.username),p.id) users,count(*) user_count
    from raw_usage u join profiles p on p.id=u.user_id group by u.avatar_id
  ), catalog as (
    select a.*,exists(select 1 from avatar_grants g cross join viewer v where g.avatar_id=a.id and g.identity_id=v.identity_id) owned
    from campaign_avatars a where a.campaign_id=c
  )
  select a.id,a.campaign_id,a.name,a.storage_path,a.active,a.blocked,a.shared,a.exclusive_user_id,
    a.created_by,a.created_at,a.archived_at,a.rarity,a.chest_only,a.owned,
    case when not a.active then 'disabled' when a.archived_at is not null then 'archived'
      when a.blocked then 'blocked' when a.exclusive_user_id is not null then 'exclusive'
      when a.shared then 'shared' when gu.avatar_id is not null then 'in_use' else 'available' end,
    case when is_master(c) then coalesce(gu.users,'[]'::jsonb) else '[]'::jsonb end,
    coalesce(gu.user_count,0),
    exists(select 1 from raw_usage current_usage where current_usage.avatar_id=a.id and current_usage.user_id<>auth.uid()),
    exclusive_profile.username,coalesce(nullif(exclusive_profile.display_name,''),exclusive_profile.username)
  from catalog a left join grouped_usage gu on gu.avatar_id=a.id
  left join profiles exclusive_profile on exclusive_profile.id=a.exclusive_user_id
  where is_master(c) or (
    a.active and (a.owned or a.exclusive_user_id=auth.uid()
      or exists(select 1 from raw_usage own_usage where own_usage.avatar_id=a.id and own_usage.user_id=auth.uid())
      or (a.archived_at is null and not a.chest_only))
  )
  order by a.active desc,a.archived_at nulls first,a.created_at desc,a.id;
end$$;

revoke all on function public.avatar_catalog(uuid) from public,anon;
grant execute on function public.avatar_catalog(uuid) to authenticated,service_role;
