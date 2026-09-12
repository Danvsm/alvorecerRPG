-- Campaign avatar gallery, recoverable master profile, and integer-cent Dracma wallets.
alter table public.profiles
  add column display_name text not null default '';

update public.profiles
set display_name = username
where display_name = '';

do $$
declare master_id uuid;
begin
  select user_id into master_id
  from public.campaign_members
  where role = 'master'
  order by campaign_id
  limit 1;

  if master_id is not null then
    if exists(select 1 from public.profiles where username = 'pink' and id <> master_id) then
      raise exception 'O username pink já está em uso';
    end if;
    update public.profiles
    set username = 'pink', display_name = 'Pink'
    where id = master_id;
  end if;
end$$;

alter table public.campaign_members
  add column dracmas_cents bigint not null default 0
  check (dracmas_cents >= 0);

alter table public.characters
  add column dracmas_cents bigint not null default 0
  check (dracmas_cents >= 0);

update public.characters
set dracmas_cents = money::bigint * 100;

alter table public.shop_products
  add column price_cents bigint not null default 0
  check (price_cents >= 0);

update public.shop_products
set price_cents = price::bigint * 100;

create table public.campaign_avatars(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  storage_path text not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique(campaign_id, storage_path)
);

alter table public.characters
  add column avatar_id uuid references public.campaign_avatars(id) on delete set null;

insert into public.campaign_avatars(campaign_id, name, storage_path, active)
select distinct campaign_id, 'Avatar existente', image, true
from public.characters
where image is not null and image <> ''
on conflict(campaign_id, storage_path) do nothing;

update public.characters ch
set avatar_id = a.id
from public.campaign_avatars a
where a.campaign_id = ch.campaign_id
  and a.storage_path = ch.image
  and ch.image is not null;

create table public.dracma_transactions(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  kind text not null check (kind in ('transfer', 'admin_adjustment')),
  actor_id uuid not null references public.profiles(id),
  from_user_id uuid references public.profiles(id),
  from_character_id uuid references public.characters(id),
  from_label text,
  to_user_id uuid references public.profiles(id),
  to_character_id uuid references public.characters(id),
  to_label text,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null default '',
  from_balance_after bigint,
  to_balance_after bigint,
  created_at timestamptz not null default now(),
  check (from_user_id is not null or from_character_id is not null or to_user_id is not null or to_character_id is not null)
);

create index campaign_avatars_campaign_active_idx
  on public.campaign_avatars(campaign_id, active, created_at);
create index characters_avatar_id_idx on public.characters(avatar_id);
create index dracma_transactions_campaign_created_idx
  on public.dracma_transactions(campaign_id, created_at desc);
create index dracma_transactions_from_user_idx on public.dracma_transactions(from_user_id);
create index dracma_transactions_to_user_idx on public.dracma_transactions(to_user_id);
create index dracma_transactions_from_character_idx on public.dracma_transactions(from_character_id);
create index dracma_transactions_to_character_idx on public.dracma_transactions(to_character_id);

alter table public.campaign_avatars enable row level security;
alter table public.dracma_transactions enable row level security;
revoke all on public.campaign_avatars, public.dracma_transactions from anon, authenticated;
grant select on public.campaign_avatars, public.dracma_transactions to authenticated;
grant all on public.campaign_avatars, public.dracma_transactions to service_role;

create policy campaign_avatars_read on public.campaign_avatars
for select to authenticated using (
  public.is_master(campaign_id)
  or (active and public.is_member(campaign_id))
  or exists(
    select 1 from public.characters ch
    where ch.avatar_id = campaign_avatars.id and public.can_character(ch.id)
  )
);

create policy dracma_transactions_read on public.dracma_transactions
for select to authenticated using (
  public.is_master(campaign_id)
  or actor_id = (select auth.uid())
  or from_user_id = (select auth.uid())
  or to_user_id = (select auth.uid())
);

create or replace function public.transfer_recipients(c uuid)
returns table(recipient_type text, user_id uuid, character_id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select 'master'::text, cm.user_id, null::uuid,
         coalesce(nullif(p.display_name, ''), p.username)
  from campaign_members cm
  join profiles p on p.id = cm.user_id
  where cm.campaign_id = c and cm.role = 'master' and is_member(c)
  union all
  select 'player'::text, ch.owner_id, ch.id,
         ch.name || ' · ' || coalesce(nullif(p.display_name, ''), p.username)
  from characters ch
  join profiles p on p.id = ch.owner_id
  where ch.campaign_id = c and not ch.archived and is_member(c)
  order by 1, 4;
$$;
revoke execute on function public.transfer_recipients(uuid) from public, anon;
grant execute on function public.transfer_recipients(uuid) to authenticated, service_role;

-- The existing private portraits bucket now stores campaign-managed WebP thumbnails only.
update storage.buckets
set file_size_limit = 262144,
    allowed_mime_types = array['image/webp']
where id = 'portraits';

drop policy if exists portrait_read on storage.objects;
drop policy if exists portrait_insert on storage.objects;
drop policy if exists portrait_delete on storage.objects;

create policy portrait_read on storage.objects
for select to authenticated using (
  bucket_id = 'portraits'
  and exists(
    select 1 from public.campaign_avatars a
    where a.storage_path = storage.objects.name
      and (
        public.is_master(a.campaign_id)
        or (a.active and public.is_member(a.campaign_id))
        or exists(
          select 1 from public.characters ch
          where ch.avatar_id = a.id and public.can_character(ch.id)
        )
      )
  )
);

create policy portrait_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'portraits'
  and storage.extension(storage.objects.name) = 'webp'
  and (storage.foldername(storage.objects.name))[2] = 'avatars'
  and exists(
    select 1 from public.campaign_members m
    where m.user_id = (select auth.uid())
      and m.role = 'master'
      and m.campaign_id::text = (storage.foldername(storage.objects.name))[1]
  )
);

create policy portrait_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'portraits'
  and exists(
    select 1 from public.campaign_members m
    where m.user_id = (select auth.uid())
      and m.role = 'master'
      and m.campaign_id::text = (storage.foldername(storage.objects.name))[1]
  )
);

-- Keep account provisioning compatible with both the previous whole-coin UI and the new cent UI.
create or replace function public.provision_player(
  c uuid,
  u uuid,
  uname text,
  identity text,
  cipher text,
  d jsonb,
  claim uuid default null,
  actor uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ch uuid;
  k text;
  aid uuid;
  initial_cents bigint;
begin
  if claim is not null then
    perform 1 from invites
    where campaign_id = c and claim_id = claim and not cancelled
      and used_by is null and expires_at > now()
    for update;
    if not found then raise exception 'Convite inválido'; end if;
  end if;

  initial_cents := case
    when d ? 'dracmas_cents' then coalesce((d->>'dracmas_cents')::bigint, 0)
    else coalesce((d->>'money')::bigint, 0) * 100
  end;
  if initial_cents < 0 then raise exception 'Saldo inválido'; end if;

  insert into profiles(id, username, display_name) values(u, uname, uname);
  insert into credential_vault(user_id, identity, ciphertext) values(u, identity, cipher);
  insert into campaign_members(campaign_id, user_id, role) values(c, u, 'player');
  insert into characters(
    campaign_id, owner_id, name, class, race, xp, money, dracmas_cents, information
  ) values(
    c, u, coalesce(nullif(d->>'name', ''), uname), coalesce(d->>'class', ''),
    coalesce(d->>'race', ''), coalesce((d->>'xp')::integer, 0),
    floor(initial_cents / 100.0)::integer, initial_cents, coalesce(d->'information', '{}')
  ) returning id into ch;

  for aid in select id from attributes where campaign_id = c and character_id is null loop
    insert into character_attributes values(ch, aid, coalesce((d->'attributes'->>aid::text)::integer, 0));
  end loop;
  for k in select unnest(array['life', 'mana', 'stamina']) loop
    insert into character_resources(character_id, key, current, maximum)
    values(ch, k, coalesce((d->>(k||'_current'))::integer, (d->>k)::integer, 0), coalesce((d->>k)::integer, 0));
  end loop;
  if claim is not null then update invites set used_by = u where claim_id = claim; end if;
  perform record_event(c, ch, 'create_player', jsonb_build_object('username', uname), coalesce(actor, u));
  return ch;
end$$;

create or replace function public.bootstrap_campaign(u uuid, uname text, identity text, cipher text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c uuid;
  n text;
  pos integer := 0;
begin
  perform pg_advisory_xact_lock(420011);
  if exists(select 1 from campaign_members where role = 'master') then
    raise exception 'Mestre já configurado';
  end if;
  insert into profiles(id, username, display_name) values(u, uname, case when uname = 'pink' then 'Pink' else uname end);
  insert into credential_vault(user_id, identity, ciphertext) values(u, identity, cipher);
  insert into campaigns(name) values('A Promessa do Amanhecer') returning id into c;
  insert into campaign_members(campaign_id, user_id, role) values(c, u, 'master');
  foreach n in array array['Força','Habilidade','Armadura','Vigor','PDF','Poder','Consciência','Esquiva','Raciocínio','Inteligência','Aparência'] loop
    insert into attributes(campaign_id, name, position) values(c, n, pos);
    pos := pos + 1;
  end loop;
  insert into campaign_events(campaign_id) values(c);
  return c;
end$$;

revoke execute on function public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid), public.bootstrap_campaign(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid), public.bootstrap_campaign(uuid,text,text,text) to service_role;

create or replace function public.game_command(c uuid, op text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ch characters;
  a advantages;
  at attributes;
  r character_resources;
  p combat_participants;
  t creature_templates;
  target uuid;
  result uuid;
  amount integer;
  before_value integer;
  after_value integer;
  before_cents bigint;
  after_cents bigint;
  room uuid;
  k text;
  master boolean;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  master := is_master(c);
  if op in ('resource','notes','buy','character','attribute_value','grant_advantage','inventory','balance') then
    select * into ch from characters where id = (d->>'character_id')::uuid and campaign_id = c for update;
    if ch.id is null or (not master and ch.owner_id is distinct from auth.uid()) then raise exception 'Personagem não permitido'; end if;
  end if;

  if op = 'resource' then
    k := d->>'key';
    select * into r from character_resources where character_id = ch.id and key = k for update;
    if not found then raise exception 'Recurso inválido'; end if;
    amount := (d->>'delta')::integer;
    if amount is null or (not master and amount >= 0) then raise exception 'Somente o mestre pode recuperar recursos'; end if;
    before_value := r.current;
    after_value := greatest(0, least(r.maximum, r.current + amount));
    update character_resources set current = after_value where character_id = ch.id and key = k;
    perform record_event(c, ch.id, k, jsonb_build_object('before', before_value, 'after', after_value, 'delta', after_value-before_value, 'reason', coalesce(d->>'reason','Sessão')));
  elsif op = 'notes' then
    update characters set notes = left(coalesce(d->>'notes',''), 20000) where id = ch.id;
    perform record_event(c, ch.id, 'notes', '{}');
  elsif op = 'image' then
    raise exception 'Escolha um avatar da galeria';
  elsif op = 'buy' then
    select * into a from advantages where id = (d->>'advantage_id')::uuid and campaign_id = c and active;
    if a.id is null then raise exception 'Vantagem indisponível'; end if;
    if a.requirements <> '' then raise exception 'Esta vantagem exige aprovação do mestre'; end if;
    if ch.xp < a.cost then raise exception 'XP insuficiente'; end if;
    insert into character_advantages values(ch.id, a.id);
    update characters set xp = xp-a.cost where id = ch.id;
    perform record_event(c, ch.id, 'buy_advantage', jsonb_build_object('name',a.name,'delta',-a.cost,'before',ch.xp,'after',ch.xp-a.cost));
  else
    if not master then raise exception 'Somente o mestre'; end if;
    case op
      when 'new_character' then
        if not exists(select 1 from campaign_members where campaign_id = c and user_id = (d->>'owner_id')::uuid and role = 'player') then raise exception 'Jogador inválido'; end if;
        insert into characters(campaign_id,owner_id,name,class,race) values(c,(d->>'owner_id')::uuid,d->>'name',coalesce(d->>'class',''),coalesce(d->>'race','')) returning id into result;
        insert into character_resources(character_id,key,current,maximum) select result, unnest(array['life','mana','stamina']), 0, 0;
        insert into character_attributes select result,id,0 from attributes where campaign_id = c and character_id is null;
      when 'character' then
        update characters set name=coalesce(nullif(d->>'name',''),name),class=coalesce(d->>'class',class),race=coalesce(d->>'race',race),information=coalesce(d->'information',information),archived=coalesce((d->>'archived')::boolean,archived) where id=ch.id;
        for k in select unnest(array['life','mana','stamina']) loop
          if d ? (k||'_max') then
            update character_resources set maximum=(d->>(k||'_max'))::integer,current=least((d->>(k||'_max'))::integer,current) where character_id=ch.id and key=k;
          end if;
        end loop;
      when 'balance' then
        amount := (d->>'delta')::integer;
        if d->>'key' = 'xp' then
          before_value := ch.xp;
          update characters set xp = xp + amount where id = ch.id returning xp into after_value;
          d := d || jsonb_build_object('before', before_value, 'after', after_value);
        elsif d->>'key' = 'money' then
          before_cents := ch.dracmas_cents;
          after_cents := before_cents + amount::bigint * 100;
          if after_cents < 0 then raise exception 'Saldo insuficiente'; end if;
          update characters set dracmas_cents = after_cents, money = floor(after_cents / 100.0)::integer where id = ch.id;
          d := d || jsonb_build_object('delta_cents', amount::bigint*100, 'before_cents', before_cents, 'after_cents', after_cents);
        else raise exception 'Saldo inválido'; end if;
      when 'attribute' then
        target := nullif(d->>'id','')::uuid;
        if nullif(d->>'character_id','') is not null and not exists(select 1 from characters where id=(d->>'character_id')::uuid and campaign_id=c) then raise exception 'Personagem inválido'; end if;
        if target is null then insert into attributes(campaign_id,character_id,name,position) values(c,nullif(d->>'character_id','')::uuid,d->>'name',coalesce((d->>'position')::integer,0)) returning id into result;
        else update attributes set name=coalesce(d->>'name',name),position=coalesce((d->>'position')::integer,position),active=coalesce((d->>'active')::boolean,active),cost=coalesce((d->>'cost')::integer,cost) where id=target and campaign_id=c returning id into result; end if;
      when 'attribute_value' then
        select * into at from attributes where id=(d->>'attribute_id')::uuid and campaign_id=c;
        if at.id is null or (at.character_id is not null and at.character_id<>ch.id) then raise exception 'Atributo inválido'; end if;
        insert into character_attributes values(ch.id,at.id,(d->>'value')::integer) on conflict(character_id,attribute_id) do update set value=excluded.value;
      when 'advantage' then
        target := nullif(d->>'id','')::uuid;
        if target is null then insert into advantages(campaign_id,name,description,cost,requirements) values(c,d->>'name',coalesce(d->>'description',''),coalesce((d->>'cost')::integer,0),coalesce(d->>'requirements','')) returning id into result;
        else update advantages set name=coalesce(d->>'name',name),description=coalesce(d->>'description',description),cost=coalesce((d->>'cost')::integer,cost),requirements=coalesce(d->>'requirements',requirements),active=coalesce((d->>'active')::boolean,active) where id=target and campaign_id=c; end if;
      when 'grant_advantage' then
        if not exists(select 1 from advantages where id=(d->>'advantage_id')::uuid and campaign_id=c) then raise exception 'Vantagem inválida'; end if;
        if coalesce((d->>'remove')::boolean,false) then delete from character_advantages where character_id=ch.id and advantage_id=(d->>'advantage_id')::uuid;
        else insert into character_advantages values(ch.id,(d->>'advantage_id')::uuid); end if;
      when 'item' then
        target := nullif(d->>'id','')::uuid;
        if target is null then insert into items(campaign_id,name,description) values(c,d->>'name',coalesce(d->>'description','')) returning id into result;
        else update items set name=coalesce(d->>'name',name),description=coalesce(d->>'description',description),active=coalesce((d->>'active')::boolean,active) where id=target and campaign_id=c; end if;
      when 'inventory' then
        if not exists(select 1 from items where id=(d->>'item_id')::uuid and campaign_id=c) then raise exception 'Item inválido'; end if;
        target := nullif(d->>'id','')::uuid;
        if target is null then insert into character_items(character_id,item_id,quantity,notes) values(ch.id,(d->>'item_id')::uuid,(d->>'quantity')::integer,coalesce(d->>'notes','')) on conflict(character_id,item_id) do update set quantity=excluded.quantity,notes=excluded.notes;
        elsif (d->>'quantity')::integer=0 then delete from character_items where id=target and character_id=ch.id;
        else update character_items set quantity=(d->>'quantity')::integer,notes=coalesce(d->>'notes',notes) where id=target and character_id=ch.id; end if;
      when 'creature' then
        target := nullif(d->>'id','')::uuid;
        if target is null then insert into creature_templates(campaign_id,name,kind,life,mana,stamina,notes,attributes) values(c,d->>'name',coalesce(d->>'kind','creature'),coalesce((d->>'life')::integer,20),coalesce((d->>'mana')::integer,0),coalesce((d->>'stamina')::integer,10),coalesce(d->>'notes',''),coalesce(d->'attributes','{}')) returning id into result;
        else update creature_templates set name=coalesce(d->>'name',name),life=coalesce((d->>'life')::integer,life),mana=coalesce((d->>'mana')::integer,mana),stamina=coalesce((d->>'stamina')::integer,stamina),notes=coalesce(d->>'notes',notes),attributes=coalesce(d->'attributes',attributes),active=coalesce((d->>'active')::boolean,active) where id=target and campaign_id=c; end if;
      when 'room' then
        target := nullif(d->>'id','')::uuid;
        if target is null then insert into combat_rooms(campaign_id,name) values(c,d->>'name') returning id into result;
        else update combat_rooms set active=coalesce((d->>'active')::boolean,active),name=coalesce(d->>'name',name) where id=target and campaign_id=c; end if;
      when 'participant' then
        room := (d->>'room_id')::uuid;
        if not exists(select 1 from combat_rooms where id=room and campaign_id=c and active) then raise exception 'Sala inválida'; end if;
        if nullif(d->>'character_id','') is not null then
          select * into ch from characters where id=(d->>'character_id')::uuid and campaign_id=c;
          if ch.id is null then raise exception 'Personagem inválido'; end if;
          insert into combat_participants(room_id,character_id,name,side) values(room,ch.id,ch.name,coalesce(d->>'side','ally'));
        else
          select * into t from creature_templates where id=(d->>'template_id')::uuid and campaign_id=c;
          if t.id is null then raise exception 'Criatura inválida'; end if;
          insert into combat_participants(room_id,template_id,name,side,life,life_max,mana,mana_max,stamina,stamina_max) values(room,t.id,coalesce(nullif(d->>'name',''),t.name),coalesce(d->>'side','enemy'),t.life,t.life,t.mana,t.mana,t.stamina,t.stamina);
        end if;
      when 'combat_update' then
        select cp.* into p from combat_participants cp join combat_rooms rr on rr.id=cp.room_id where cp.id=(d->>'id')::uuid and rr.campaign_id=c for update of cp;
        if p.id is null then raise exception 'Participante inválido'; end if;
        if coalesce((d->>'remove')::boolean,false) then delete from combat_participants where id=p.id;
        elsif d ? 'reveal' then update combat_participants set reveal=(d->>'reveal')::boolean where id=p.id;
        elsif p.character_id is not null then return game_command(c,'resource',d||jsonb_build_object('character_id',p.character_id));
        else
          k:=d->>'key'; amount:=(d->>'delta')::integer;
          if k not in ('life','mana','stamina') or amount is null then raise exception 'Recurso inválido'; end if;
          execute format('update combat_participants set %I=greatest(0,least(%I,%I+$1)) where id=$2',k,k||'_max',k) using amount,p.id;
        end if;
      when 'campaign' then update campaigns set name=coalesce(d->>'name',name),theme=coalesce(d->'theme',theme) where id=c;
      else raise exception 'Operação desconhecida';
    end case;
    perform record_event(c, ch.id, op, d);
  end if;
  return jsonb_build_object('id', result);
end$$;

create or replace function public.game_action(c uuid, op text, d jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ch characters;
  target_ch characters;
  inv character_items;
  item items;
  effect item_effects;
  r character_resources;
  product shop_products;
  store shops;
  rule resource_rules;
  avatar campaign_avatars;
  actor_member campaign_members;
  target_member campaign_members;
  v_id uuid;
  out jsonb := '{}';
  receipt alvorecer_private.receipts;
  recovered jsonb := '{}';
  delta integer;
  delta_cents bigint;
  amount_cents bigint;
  source_before bigint;
  source_after bigint;
  target_before bigint;
  target_after bigint;
  source_label text;
  target_label text;
  k text;
  old_resource character_resources;
begin
  if auth.uid() is null or not is_member(c) then raise exception 'Sem permissão'; end if;
  select * into actor_member from campaign_members where campaign_id = c and user_id = auth.uid();

  if op in ('consume','purchase','transfer_dracmas','adjust_dracmas') then
    if nullif(d->>'request_id','') is null then raise exception 'Identificador da operação obrigatório'; end if;
    insert into alvorecer_private.receipts values(auth.uid(),(d->>'request_id')::uuid,op,d,null) on conflict do nothing;
    if not found then
      select * into receipt from alvorecer_private.receipts where actor_id=auth.uid() and request_id=(d->>'request_id')::uuid;
      if receipt.operation<>op or receipt.payload<>d then raise exception 'Identificador reutilizado para outra operação'; end if;
      return receipt.result;
    end if;
  end if;

  if op in ('resource_config','consume','purchase') then
    select * into ch from characters where id=(d->>'character_id')::uuid and campaign_id=c for update;
    if ch.id is null or not can_character(ch.id) then raise exception 'Personagem não permitido'; end if;
  end if;

  if op = 'consume' then
    select * into inv from character_items where id=(d->>'inventory_id')::uuid and character_id=ch.id for update;
    if inv.id is null then raise exception 'Você não possui esse item'; end if;
    select * into item from items where items.id=inv.item_id and campaign_id=c for share;
    if item.kind<>'consumable' or not item.active or inv.quantity<1 or not exists(select 1 from item_effects where item_id=item.id) then raise exception 'Item não utilizável'; end if;
    for effect in select * from item_effects where item_id=item.id order by resource_key loop
      select * into r from character_resources where character_id=ch.id and key=effect.resource_key for update;
      if r.key is null then raise exception 'Recurso indisponível'; end if;
      delta:=least(effect.amount,r.maximum-r.current);
      update character_resources set current=current+delta where character_id=ch.id and key=effect.resource_key;
      recovered:=recovered||jsonb_build_object(effect.resource_key,delta);
    end loop;
    if inv.quantity=1 then delete from character_items where character_items.id=inv.id;
    else update character_items set quantity=quantity-1 where character_items.id=inv.id; end if;
    out:=jsonb_build_object('name',item.name,'recovered',recovered,'quantity_before',inv.quantity,'quantity_after',inv.quantity-1);
    perform record_event(c,ch.id,'consume',out);

  elsif op = 'purchase' then
    select p.* into product from shop_products p join shops s on s.id=p.shop_id where p.id=(d->>'product_id')::uuid and s.campaign_id=c for update of p;
    if product.id is null then raise exception 'Produto indisponível'; end if;
    select * into store from shops where shops.id=product.shop_id for share;
    select * into item from items where items.id=product.item_id and campaign_id=c for share;
    if not store.active or not product.active or not item.active or product.stock=0 then raise exception 'Produto indisponível'; end if;
    if ch.dracmas_cents < product.price_cents then raise exception 'Dracmas insuficientes'; end if;
    update characters set dracmas_cents=dracmas_cents-product.price_cents, money=floor((dracmas_cents-product.price_cents)/100.0)::integer where characters.id=ch.id;
    insert into character_items(character_id,item_id,quantity) values(ch.id,item.id,1) on conflict(character_id,item_id) do update set quantity=character_items.quantity+1;
    if product.stock is not null then update shop_products set stock=stock-1 where shop_products.id=product.id; end if;
    out:=jsonb_build_object('name',product.name,'delta_cents',-product.price_cents,'before_cents',ch.dracmas_cents,'after_cents',ch.dracmas_cents-product.price_cents,'stock_after',case when product.stock is null then null else product.stock-1 end);
    perform record_event(c,ch.id,'purchase',out);

  elsif op = 'avatar_select' then
    select * into ch from characters where id=(d->>'character_id')::uuid and campaign_id=c for update;
    if ch.id is null or (actor_member.role <> 'master' and ch.owner_id is distinct from auth.uid()) then raise exception 'Personagem não permitido'; end if;
    select * into avatar from campaign_avatars where id=(d->>'avatar_id')::uuid and campaign_id=c and active;
    if avatar.id is null then raise exception 'Avatar indisponível'; end if;
    update characters set avatar_id=avatar.id, image=avatar.storage_path where id=ch.id;
    out:=jsonb_build_object('avatar_id',avatar.id,'name',avatar.name);
    perform record_event(c,ch.id,'avatar_select',out);

  elsif op = 'transfer_dracmas' then
    perform 1 from campaign_events where campaign_id=c for update;
    amount_cents := (d->>'amount_cents')::bigint;
    if amount_cents is null or amount_cents <= 0 then raise exception 'Informe um valor maior que zero'; end if;

    if actor_member.role = 'master' then
      select * into actor_member from campaign_members where campaign_id=c and user_id=auth.uid() for update;
      source_before := actor_member.dracmas_cents;
      source_label := coalesce((select nullif(display_name,'') from profiles where id=auth.uid()), 'Pink');
      if source_before < amount_cents then raise exception 'Saldo insuficiente'; end if;
    else
      select * into ch from characters where id=(d->>'source_character_id')::uuid and campaign_id=c and owner_id=auth.uid() and not archived for update;
      if ch.id is null then raise exception 'Conta de origem inválida'; end if;
      source_before := ch.dracmas_cents;
      source_label := ch.name;
      if source_before < amount_cents then raise exception 'Saldo insuficiente'; end if;
    end if;

    if d->>'recipient_type' = 'master' then
      if actor_member.role = 'master' then raise exception 'Escolha outro destinatário'; end if;
      select * into target_member from campaign_members where campaign_id=c and role='master' for update;
      if target_member.user_id is null then raise exception 'Destinatário indisponível'; end if;
      target_before := target_member.dracmas_cents;
      target_after := target_before + amount_cents;
      target_label := coalesce((select nullif(display_name,'') from profiles where id=target_member.user_id), 'Pink');
      update campaign_members set dracmas_cents=target_after where campaign_id=c and user_id=target_member.user_id;
      v_id := gen_random_uuid();
      insert into dracma_transactions(id,campaign_id,kind,actor_id,from_user_id,from_character_id,from_label,to_user_id,to_label,amount_cents,reason,from_balance_after,to_balance_after)
      values(v_id,c,'transfer',auth.uid(),auth.uid(),ch.id,source_label,target_member.user_id,target_label,amount_cents,left(coalesce(d->>'reason',''),240),source_before-amount_cents,target_after);
    else
      select * into target_ch from characters where id=(d->>'recipient_character_id')::uuid and campaign_id=c and not archived for update;
      if target_ch.id is null or target_ch.owner_id is null or target_ch.owner_id=auth.uid() then raise exception 'Destinatário inválido'; end if;
      target_before := target_ch.dracmas_cents;
      target_after := target_before + amount_cents;
      target_label := target_ch.name;
      update characters set dracmas_cents=target_after,money=floor(target_after/100.0)::integer where id=target_ch.id;
      v_id := gen_random_uuid();
      insert into dracma_transactions(id,campaign_id,kind,actor_id,from_user_id,from_character_id,from_label,to_user_id,to_character_id,to_label,amount_cents,reason,from_balance_after,to_balance_after)
      values(v_id,c,'transfer',auth.uid(),auth.uid(),ch.id,source_label,target_ch.owner_id,target_ch.id,target_label,amount_cents,left(coalesce(d->>'reason',''),240),source_before-amount_cents,target_after);
    end if;

    source_after := source_before - amount_cents;
    if actor_member.role = 'master' then
      update campaign_members set dracmas_cents=source_after where campaign_id=c and user_id=auth.uid();
    else
      update characters set dracmas_cents=source_after,money=floor(source_after/100.0)::integer where id=ch.id;
    end if;
    out:=jsonb_build_object('id',v_id,'amount_cents',amount_cents,'from',source_label,'to',target_label,'from_balance_after',source_after,'to_balance_after',target_after);
    perform record_event(c,ch.id,'dracma_transfer',out||jsonb_build_object('reason',left(coalesce(d->>'reason',''),240)));

  elsif op = 'adjust_dracmas' then
    if actor_member.role <> 'master' then raise exception 'Somente o mestre'; end if;
    perform 1 from campaign_events where campaign_id=c for update;
    delta_cents := (d->>'delta_cents')::bigint;
    if delta_cents is null or delta_cents = 0 then raise exception 'Informe um valor diferente de zero'; end if;

    if d->>'target_type' = 'master' then
      select * into target_member from campaign_members where campaign_id=c and user_id=auth.uid() for update;
      target_before := target_member.dracmas_cents;
      target_after := target_before + delta_cents;
      target_label := coalesce((select nullif(display_name,'') from profiles where id=auth.uid()), 'Pink');
      if target_after < 0 then raise exception 'Saldo insuficiente'; end if;
      update campaign_members set dracmas_cents=target_after where campaign_id=c and user_id=auth.uid();
      v_id:=gen_random_uuid();
      insert into dracma_transactions(id,campaign_id,kind,actor_id,from_user_id,from_label,to_user_id,to_label,amount_cents,reason,from_balance_after,to_balance_after)
      values(v_id,c,'admin_adjustment',auth.uid(),case when delta_cents<0 then auth.uid() end,case when delta_cents<0 then target_label end,case when delta_cents>0 then auth.uid() end,case when delta_cents>0 then target_label end,abs(delta_cents),left(coalesce(d->>'reason','Ajuste do Mestre'),240),case when delta_cents<0 then target_after end,case when delta_cents>0 then target_after end);
    else
      select * into target_ch from characters where id=(d->>'target_character_id')::uuid and campaign_id=c for update;
      if target_ch.id is null then raise exception 'Jogador inválido'; end if;
      target_before:=target_ch.dracmas_cents;
      target_after:=target_before+delta_cents;
      target_label:=target_ch.name;
      if target_after<0 then raise exception 'Saldo insuficiente'; end if;
      update characters set dracmas_cents=target_after,money=floor(target_after/100.0)::integer where id=target_ch.id;
      v_id:=gen_random_uuid();
      insert into dracma_transactions(id,campaign_id,kind,actor_id,from_user_id,from_character_id,from_label,to_user_id,to_character_id,to_label,amount_cents,reason,from_balance_after,to_balance_after)
      values(v_id,c,'admin_adjustment',auth.uid(),case when delta_cents<0 then target_ch.owner_id end,case when delta_cents<0 then target_ch.id end,case when delta_cents<0 then target_label end,case when delta_cents>0 then target_ch.owner_id end,case when delta_cents>0 then target_ch.id end,case when delta_cents>0 then target_label end,abs(delta_cents),left(coalesce(d->>'reason','Ajuste do Mestre'),240),case when delta_cents<0 then target_after end,case when delta_cents>0 then target_after end);
    end if;
    out:=jsonb_build_object('id',v_id,'delta_cents',delta_cents,'target',target_label,'before_cents',target_before,'after_cents',target_after);
    perform record_event(c,target_ch.id,'dracma_adjustment',out||jsonb_build_object('reason',left(coalesce(d->>'reason','Ajuste do Mestre'),240)));

  else
    if actor_member.role <> 'master' then raise exception 'Somente o mestre'; end if;
    case op
      when 'resource_config' then
        k:=d->>'key';
        if not exists(select 1 from character_resources where character_id=ch.id and key=k) then raise exception 'Recurso inválido'; end if;
        if nullif(d->>'attribute_id','') is not null and not exists(select 1 from attributes where attributes.id=(d->>'attribute_id')::uuid and campaign_id=c and (character_id is null or character_id=ch.id)) then raise exception 'Atributo inválido'; end if;
        select * into old_resource from character_resources where character_id=ch.id and key=k;
        update character_resources set inherit_rule=(d->>'inherit_rule')::boolean,automatic=(d->>'automatic')::boolean,attribute_id=nullif(d->>'attribute_id','')::uuid,multiplier=(d->>'multiplier')::numeric,manual_maximum=(d->>'manual_maximum')::integer where character_id=ch.id and key=k;
        out:=jsonb_build_object('before',to_jsonb(old_resource),'configuration',d);
      when 'campaign_rule' then
        k:=d->>'key'; if k not in ('life','mana','stamina') then raise exception 'Recurso inválido'; end if;
        if nullif(d->>'attribute_id','') is not null and not exists(select 1 from attributes where attributes.id=(d->>'attribute_id')::uuid and campaign_id=c and character_id is null) then raise exception 'Atributo inválido'; end if;
        insert into resource_rules values(c,k,(d->>'automatic')::boolean,nullif(d->>'attribute_id','')::uuid,(d->>'multiplier')::numeric)
        on conflict(campaign_id,key) do update set automatic=excluded.automatic,attribute_id=excluded.attribute_id,multiplier=excluded.multiplier;
      when 'item_config' then
        select * into item from items where items.id=(d->>'item_id')::uuid and campaign_id=c for update;
        if item.id is null then raise exception 'Item inválido'; end if;
        if nullif(d->>'image','') is not null and d->>'image' not like c::text||'/%' then raise exception 'Imagem inválida'; end if;
        update items set kind=d->>'kind',image=nullif(d->>'image','') where items.id=item.id;
        delete from item_effects where item_id=item.id;
        for k in select unnest(array['life','mana','stamina']) loop
          if coalesce((d->'effects'->>k)::integer,0)>0 then insert into item_effects(item_id,resource_key,amount) values(item.id,k,(d->'effects'->>k)::integer); end if;
        end loop;
      when 'shop' then
        v_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
        if exists(select 1 from shops where shops.id=v_id and campaign_id<>c) then raise exception 'Loja inválida'; end if;
        insert into shops values(v_id,c,d->>'name',coalesce(d->>'description',''),coalesce((d->>'active')::boolean,true)) on conflict on constraint shops_pkey do update set name=excluded.name,description=excluded.description,active=excluded.active;
        out:=jsonb_build_object('id',v_id);
      when 'product' then
        select * into store from shops where shops.id=(d->>'shop_id')::uuid and campaign_id=c;
        select * into item from items where items.id=(d->>'item_id')::uuid and campaign_id=c;
        if store.id is null or item.id is null then raise exception 'Loja ou item inválido'; end if;
        v_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
        if exists(select 1 from shop_products p join shops s on s.id=p.shop_id where p.id=v_id and s.campaign_id<>c) then raise exception 'Produto inválido'; end if;
        if nullif(d->>'image','') is not null and d->>'image' not like c::text||'/%' then raise exception 'Imagem inválida'; end if;
        amount_cents:=case when d ? 'price_cents' then (d->>'price_cents')::bigint else (d->>'price')::bigint*100 end;
        if amount_cents<0 then raise exception 'Preço inválido'; end if;
        insert into shop_products(id,shop_id,item_id,name,description,image,price,stock,active,price_cents)
        values(v_id,store.id,item.id,coalesce(nullif(d->>'name',''),item.name),coalesce(d->>'description',''),nullif(d->>'image',''),floor(amount_cents/100.0)::integer,nullif(d->>'stock','')::integer,coalesce((d->>'active')::boolean,true),amount_cents)
        on conflict on constraint shop_products_pkey do update set name=excluded.name,description=excluded.description,image=excluded.image,price=excluded.price,price_cents=excluded.price_cents,stock=excluded.stock,active=excluded.active,item_id=excluded.item_id;
        out:=jsonb_build_object('id',v_id);
      when 'avatar' then
        v_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
        if nullif(d->>'storage_path','') is not null and (d->>'storage_path' not like c::text||'/avatars/%.webp') then raise exception 'Arquivo de avatar inválido'; end if;
        if nullif(d->>'id','') is null then
          if nullif(d->>'storage_path','') is null then raise exception 'Envie a imagem do avatar'; end if;
          insert into campaign_avatars(id,campaign_id,name,storage_path,created_by) values(v_id,c,left(coalesce(nullif(d->>'name',''),'Avatar'),80),d->>'storage_path',auth.uid());
        else
          update campaign_avatars set name=left(coalesce(nullif(d->>'name',''),name),80),active=coalesce((d->>'active')::boolean,active),archived_at=case when coalesce((d->>'active')::boolean,active) then null else now() end where id=v_id and campaign_id=c;
          if not found then raise exception 'Avatar inválido'; end if;
        end if;
        out:=jsonb_build_object('id',v_id);
      else raise exception 'Operação desconhecida';
    end case;
    perform record_event(c,ch.id,op,jsonb_build_object('input',d,'result',out));
  end if;

  if op in ('consume','purchase','transfer_dracmas','adjust_dracmas') then
    update alvorecer_private.receipts set result=out where actor_id=auth.uid() and request_id=(d->>'request_id')::uuid;
  end if;
  return out;
end$$;

revoke execute on function public.game_command(uuid,text,jsonb), public.game_action(uuid,text,jsonb) from public, anon;
grant execute on function public.game_command(uuid,text,jsonb), public.game_action(uuid,text,jsonb) to authenticated, service_role;
