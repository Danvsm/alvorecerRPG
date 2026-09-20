-- Treasure chest economy, rewards and gifts.
alter table public.campaign_members
  add column if not exists gems integer not null default 0
  check (gems >= 0);

alter table public.campaign_avatars
  add column if not exists chest_only boolean not null default false;

alter table public.cosmetics
  drop constraint if exists cosmetics_acquisition_origin_check;
alter table public.cosmetics
  add constraint cosmetics_acquisition_origin_check
  check (acquisition_origin in ('free','achievement','session','event','supporter','gift','exclusive','manual','chest'));

alter table public.cosmetic_grants
  drop constraint if exists cosmetic_grants_origin_check;
alter table public.cosmetic_grants
  add constraint cosmetic_grants_origin_check
  check (origin in ('session','achievement','event','gift','supporter','master','default','chest'));

create table public.chest_settings (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  cost_gems integer not null default 30 check (cost_gems between 1 and 100000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create table public.chest_rarity_odds (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  rarity text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  weight_bp integer not null check (weight_bp between 0 and 10000),
  primary key (campaign_id, rarity)
);

create table public.chest_rewards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  rarity text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  reward_type text not null check (reward_type in ('xp','dracmas','avatar','frame')),
  label text not null check (char_length(trim(label)) between 1 and 100),
  amount bigint,
  avatar_id uuid references public.campaign_avatars(id) on delete restrict,
  cosmetic_id uuid references public.cosmetics(id) on delete restrict,
  weight integer not null default 1 check (weight between 1 and 100000),
  active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (reward_type in ('xp','dracmas') and amount > 0 and avatar_id is null and cosmetic_id is null)
    or (reward_type = 'avatar' and amount is null and avatar_id is not null and cosmetic_id is null)
    or (reward_type = 'frame' and amount is null and avatar_id is null and cosmetic_id is not null)
  )
);

create table public.avatar_grants (
  identity_id uuid not null references public.social_identities(id) on delete cascade,
  avatar_id uuid not null references public.campaign_avatars(id) on delete cascade,
  origin text not null default 'chest' check (origin = 'chest'),
  created_at timestamptz not null default now(),
  primary key (identity_id, avatar_id)
);

create table public.chest_gifts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending','opened')),
  cost_gems integer not null check (cost_gems > 0),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  check (sender_user_id <> recipient_user_id),
  unique (sender_user_id, request_id)
);

create table public.chest_openings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  character_id uuid references public.characters(id) on delete set null,
  gift_id uuid unique references public.chest_gifts(id) on delete set null,
  reward_id uuid references public.chest_rewards(id) on delete set null,
  rarity text not null check (rarity in ('common','uncommon','rare','epic','legendary')),
  reward_type text not null check (reward_type in ('xp','dracmas','avatar','frame')),
  reward_label text not null,
  reward_amount bigint,
  avatar_id uuid references public.campaign_avatars(id) on delete set null,
  cosmetic_id uuid references public.cosmetics(id) on delete set null,
  cost_gems integer not null default 0 check (cost_gems >= 0),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

create table public.gem_transactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('admin_adjustment','chest_open','chest_gift')),
  delta integer not null check (delta <> 0),
  balance_after integer not null check (balance_after >= 0),
  reference_id uuid,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index chest_rewards_campaign_active_idx on public.chest_rewards(campaign_id, active, rarity);
create index chest_gifts_recipient_idx on public.chest_gifts(campaign_id, recipient_user_id, status, created_at desc);
create index chest_gifts_sender_idx on public.chest_gifts(campaign_id, sender_user_id, created_at desc);
create index chest_openings_user_idx on public.chest_openings(campaign_id, user_id, created_at desc);
create index gem_transactions_user_idx on public.gem_transactions(campaign_id, user_id, created_at desc);
create index avatar_grants_avatar_idx on public.avatar_grants(avatar_id, identity_id);

do $$ declare t text; begin
  foreach t in array array['chest_settings','chest_rarity_odds','chest_rewards','avatar_grants','chest_gifts','chest_openings','gem_transactions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create policy chest_settings_read on public.chest_settings for select to authenticated
  using ((select public.is_member(campaign_id)));
create policy chest_rarity_odds_read on public.chest_rarity_odds for select to authenticated
  using ((select public.is_member(campaign_id)));
create policy chest_rewards_read on public.chest_rewards for select to authenticated
  using ((select public.is_member(campaign_id)));
create policy avatar_grants_read on public.avatar_grants for select to authenticated using (
  exists (select 1 from public.social_identities i where i.id=identity_id
    and ((i.user_id=(select auth.uid())) or (select public.is_master(i.campaign_id))))
);
create policy chest_gifts_read on public.chest_gifts for select to authenticated using (
  sender_user_id=(select auth.uid()) or recipient_user_id=(select auth.uid())
  or (select public.is_master(campaign_id))
);
create policy chest_openings_read on public.chest_openings for select to authenticated using (
  user_id=(select auth.uid()) or (select public.is_master(campaign_id))
);
create policy gem_transactions_read on public.gem_transactions for select to authenticated using (
  user_id=(select auth.uid()) or (select public.is_master(campaign_id))
);

insert into public.chest_settings(campaign_id)
select id from public.campaigns on conflict do nothing;

insert into public.chest_rarity_odds(campaign_id,rarity,weight_bp)
select c.id, v.rarity, v.weight_bp
from public.campaigns c cross join (values
  ('common',5200),('uncommon',2700),('rare',1400),('epic',500),('legendary',200)
) v(rarity,weight_bp) on conflict do nothing;

insert into public.chest_rewards(campaign_id,rarity,reward_type,label,amount,weight,display_order)
select c.id,v.rarity,v.reward_type,v.label,v.amount,v.weight,v.display_order
from public.campaigns c cross join (values
  ('common','xp','10 XP',10::bigint,18,10),
  ('common','dracmas','5 Dracmas',5::bigint,18,20),
  ('common','xp','25 XP',25::bigint,8,30),
  ('common','dracmas','15 Dracmas',15::bigint,8,40),
  ('uncommon','xp','100 XP',100::bigint,7,50),
  ('uncommon','dracmas','50 Dracmas',50::bigint,7,60),
  ('rare','xp','500 XP',500::bigint,7,70),
  ('rare','dracmas','250 Dracmas',250::bigint,7,80),
  ('epic','xp','1.500 XP',1500::bigint,1,90),
  ('epic','dracmas','1.000 Dracmas',1000::bigint,1,100),
  ('legendary','xp','5.000 XP',5000::bigint,5,110),
  ('legendary','dracmas','5.000 Dracmas',5000::bigint,5,120),
  ('legendary','xp','25.000 XP — Grande Prêmio',25000::bigint,1,130),
  ('legendary','dracmas','25.000 Dracmas — Grande Prêmio',25000::bigint,1,140)
) v(rarity,reward_type,label,amount,weight,display_order);

create or replace function alvorecer_private.ensure_chest_config(c uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.chest_settings(campaign_id) values(c) on conflict do nothing;
  insert into public.chest_rarity_odds(campaign_id,rarity,weight_bp)
  values(c,'common',5200),(c,'uncommon',2700),(c,'rare',1400),(c,'epic',500),(c,'legendary',200)
  on conflict do nothing;
  if not exists(select 1 from public.chest_rewards r where r.campaign_id=c) then
    insert into public.chest_rewards(campaign_id,rarity,reward_type,label,amount,weight,display_order)
    values
      (c,'common','xp','10 XP',10,18,10),(c,'common','dracmas','5 Dracmas',5,18,20),
      (c,'common','xp','25 XP',25,8,30),(c,'common','dracmas','15 Dracmas',15,8,40),
      (c,'uncommon','xp','100 XP',100,7,50),(c,'uncommon','dracmas','50 Dracmas',50,7,60),
      (c,'rare','xp','500 XP',500,7,70),(c,'rare','dracmas','250 Dracmas',250,7,80),
      (c,'epic','xp','1.500 XP',1500,1,90),(c,'epic','dracmas','1.000 Dracmas',1000,1,100),
      (c,'legendary','xp','5.000 XP',5000,5,110),(c,'legendary','dracmas','5.000 Dracmas',5000,5,120),
      (c,'legendary','xp','25.000 XP — Grande Prêmio',25000,1,130),
      (c,'legendary','dracmas','25.000 Dracmas — Grande Prêmio',25000,1,140);
  end if;
end $$;

create or replace function public.chest_dashboard(c uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare answer jsonb;
begin
  if not public.is_member(c) then raise exception 'Sem permissão'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  select jsonb_build_object(
    'gems',m.gems,
    'cost_gems',s.cost_gems,
    'enabled',s.enabled,
    'odds',(select jsonb_agg(jsonb_build_object('rarity',o.rarity,'weight_bp',o.weight_bp) order by
      case o.rarity when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'epic' then 4 else 5 end)
      from public.chest_rarity_odds o where o.campaign_id=c),
    'characters',(select coalesce(jsonb_agg(jsonb_build_object('id',ch.id,'name',ch.name) order by ch.name),'[]'::jsonb)
      from public.characters ch where ch.campaign_id=c and ch.owner_id=auth.uid() and not ch.archived),
    'recipients',(select coalesce(jsonb_agg(jsonb_build_object('user_id',i.user_id,'name',i.name,'avatar_id',i.avatar_id) order by i.name),'[]'::jsonb)
      from public.social_identities i join public.campaign_members cm on cm.campaign_id=i.campaign_id and cm.user_id=i.user_id
      where i.campaign_id=c and i.active and i.kind='player' and i.user_id<>auth.uid()
        and cm.access_active and cm.archived_at is null),
    'gifts',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'message',g.message,'sender_name',coalesce(si.name,sp.username),'created_at',g.created_at) order by g.created_at desc),'[]'::jsonb)
      from public.chest_gifts g left join public.social_identities si on si.campaign_id=g.campaign_id and si.user_id=g.sender_user_id
      join public.profiles sp on sp.id=g.sender_user_id
      where g.campaign_id=c and g.recipient_user_id=auth.uid() and g.status='pending'),
    'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]'::jsonb) from
      (select o.id,o.rarity,o.reward_type,o.reward_label,o.reward_amount,o.avatar_id,o.cosmetic_id,o.cost_gems,o.created_at,
        (o.gift_id is not null) gifted from public.chest_openings o where o.campaign_id=c and o.user_id=auth.uid()
       order by o.created_at desc limit 12) h)
  ) into answer
  from public.campaign_members m join public.chest_settings s on s.campaign_id=m.campaign_id
  where m.campaign_id=c and m.user_id=auth.uid() and m.access_active and m.archived_at is null;
  if answer is null then raise exception 'Membro indisponível'; end if;
  return answer;
end $$;

create or replace function public.chest_gift(c uuid, recipient uuid, gift_message text, request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sender public.campaign_members; settings public.chest_settings; gift public.chest_gifts;
begin
  if request_id is null or recipient=auth.uid() then raise exception 'Presente inválido'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  select * into sender from public.campaign_members where campaign_id=c and user_id=auth.uid()
    and role='player' and access_active and archived_at is null for update;
  if sender.user_id is null then raise exception 'Jogador indisponível'; end if;
  select * into settings from public.chest_settings where campaign_id=c;
  if not settings.enabled then raise exception 'Baú temporariamente fechado'; end if;
  if not exists(select 1 from public.campaign_members where campaign_id=c and user_id=recipient and role='player' and access_active and archived_at is null)
    then raise exception 'Destinatário indisponível'; end if;
  select * into gift from public.chest_gifts where sender_user_id=auth.uid() and chest_gifts.request_id=chest_gift.request_id;
  if gift.id is not null then
    if gift.campaign_id<>c or gift.recipient_user_id<>recipient then raise exception 'Identificador reutilizado'; end if;
    return jsonb_build_object('gift_id',gift.id,'gems',sender.gems);
  end if;
  if sender.gems<settings.cost_gems then raise exception 'Gemas insuficientes'; end if;
  update public.campaign_members set gems=gems-settings.cost_gems where campaign_id=c and user_id=auth.uid()
    returning * into sender;
  insert into public.chest_gifts(campaign_id,sender_user_id,recipient_user_id,message,cost_gems,request_id)
  values(c,auth.uid(),recipient,left(trim(coalesce(gift_message,'')),300),settings.cost_gems,request_id) returning * into gift;
  insert into public.gem_transactions(campaign_id,user_id,actor_id,kind,delta,balance_after,reference_id,note)
  values(c,auth.uid(),auth.uid(),'chest_gift',-settings.cost_gems,sender.gems,gift.id,'Baú presenteado');
  insert into public.notifications(campaign_id,user_id,kind,title,body,reference_id)
  values(c,recipient,'chest','Você recebeu um Baú Dourado',nullif(gift.message,''),gift.id::text);
  return jsonb_build_object('gift_id',gift.id,'gems',sender.gems);
end $$;

create or replace function public.chest_open(c uuid, selected_character uuid, gift uuid, request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.campaign_members; settings public.chest_settings; identity public.social_identities;
  chosen public.chest_rewards; opening public.chest_openings; gift_row public.chest_gifts; ch public.characters;
  chosen_rarity text; price integer; result jsonb;
begin
  if request_id is null then raise exception 'Abertura inválida'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  select * into member from public.campaign_members where campaign_id=c and user_id=auth.uid()
    and role='player' and access_active and archived_at is null for update;
  if member.user_id is null then raise exception 'Jogador indisponível'; end if;
  select * into opening from public.chest_openings where user_id=auth.uid() and chest_openings.request_id=chest_open.request_id;
  if opening.id is not null then
    if opening.campaign_id<>c then raise exception 'Identificador reutilizado'; end if;
    return to_jsonb(opening)||jsonb_build_object('gems',member.gems);
  end if;
  select * into settings from public.chest_settings where campaign_id=c;
  if not settings.enabled then raise exception 'Baú temporariamente fechado'; end if;
  select * into identity from public.social_identities where campaign_id=c and user_id=auth.uid() and active;
  if identity.id is null then raise exception 'Perfil indisponível'; end if;
  select * into ch from public.characters where id=selected_character and campaign_id=c and owner_id=auth.uid() and not archived;
  if ch.id is null then raise exception 'Selecione seu personagem'; end if;
  if gift is not null then
    select * into gift_row from public.chest_gifts where id=gift and campaign_id=c and recipient_user_id=auth.uid() and status='pending' for update;
    if gift_row.id is null then raise exception 'Presente indisponível'; end if;
    price:=0;
  else
    price:=settings.cost_gems;
    if member.gems<price then raise exception 'Gemas insuficientes'; end if;
  end if;

  select o.rarity into chosen_rarity
  from public.chest_rarity_odds o
  where o.campaign_id=c and o.weight_bp>0 and exists(
    select 1 from public.chest_rewards r where r.campaign_id=c and r.rarity=o.rarity and r.active and (
      r.reward_type in ('xp','dracmas')
      or (r.reward_type='avatar' and not exists(select 1 from public.avatar_grants ag where ag.identity_id=identity.id and ag.avatar_id=r.avatar_id))
      or (r.reward_type='frame' and not exists(select 1 from public.cosmetic_grants cg where cg.identity_id=identity.id and cg.cosmetic_id=r.cosmetic_id and cg.removed_at is null))
    )
  ) order by -ln(greatest(random(),0.0000001))/o.weight_bp limit 1;
  if chosen_rarity is null then raise exception 'Nenhum prêmio disponível'; end if;
  select r.* into chosen from public.chest_rewards r
  where r.campaign_id=c and r.rarity=chosen_rarity and r.active and (
    r.reward_type in ('xp','dracmas')
    or (r.reward_type='avatar' and not exists(select 1 from public.avatar_grants ag where ag.identity_id=identity.id and ag.avatar_id=r.avatar_id))
    or (r.reward_type='frame' and not exists(select 1 from public.cosmetic_grants cg where cg.identity_id=identity.id and cg.cosmetic_id=r.cosmetic_id and cg.removed_at is null))
  ) order by -ln(greatest(random(),0.0000001))/r.weight limit 1;

  if price>0 then
    update public.campaign_members set gems=gems-price where campaign_id=c and user_id=auth.uid() returning * into member;
  end if;
  if chosen.reward_type='xp' then
    update public.characters set xp=xp+chosen.amount::integer where id=ch.id;
  elsif chosen.reward_type='dracmas' then
    update public.characters set dracmas_cents=dracmas_cents+(chosen.amount*100),money=floor((dracmas_cents+(chosen.amount*100))/100.0)::integer where id=ch.id;
    insert into public.dracma_transactions(campaign_id,kind,actor_id,to_user_id,to_character_id,to_label,amount_cents,reason,to_balance_after)
    values(c,'reward',auth.uid(),auth.uid(),ch.id,ch.name,chosen.amount*100,'Prêmio do Baú Dourado',ch.dracmas_cents+(chosen.amount*100));
  elsif chosen.reward_type='avatar' then
    insert into public.avatar_grants(identity_id,avatar_id) values(identity.id,chosen.avatar_id) on conflict do nothing;
  else
    insert into public.cosmetic_grants(identity_id,cosmetic_id,origin,note,granted_by)
    values(identity.id,chosen.cosmetic_id,'chest','Prêmio do Baú Dourado',auth.uid())
    on conflict(identity_id,cosmetic_id) do update set removed_at=null,removed_by=null,origin='chest',note='Prêmio do Baú Dourado';
  end if;
  insert into public.chest_openings(campaign_id,user_id,character_id,gift_id,reward_id,rarity,reward_type,reward_label,reward_amount,avatar_id,cosmetic_id,cost_gems,request_id)
  values(c,auth.uid(),ch.id,gift,chosen.id,chosen.rarity,chosen.reward_type,chosen.label,chosen.amount,chosen.avatar_id,chosen.cosmetic_id,price,request_id)
  returning * into opening;
  if gift is not null then update public.chest_gifts set status='opened',opened_at=now() where id=gift; end if;
  if price>0 then insert into public.gem_transactions(campaign_id,user_id,actor_id,kind,delta,balance_after,reference_id,note)
    values(c,auth.uid(),auth.uid(),'chest_open',-price,member.gems,opening.id,'Abertura do Baú Dourado'); end if;
  result:=to_jsonb(opening)||jsonb_build_object('gems',member.gems);
  return result;
end $$;

create or replace function public.chest_admin_dashboard(c uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  if not public.is_master(c) then raise exception 'Somente Pink'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  return jsonb_build_object(
    'settings',(select to_jsonb(s) from public.chest_settings s where s.campaign_id=c),
    'odds',(select jsonb_agg(to_jsonb(o) order by case o.rarity when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'epic' then 4 else 5 end) from public.chest_rarity_odds o where o.campaign_id=c),
    'rewards',(select coalesce(jsonb_agg(to_jsonb(r) order by r.display_order,r.created_at),'[]'::jsonb) from public.chest_rewards r where r.campaign_id=c),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'name',coalesce(i.name,p.username),'gems',m.gems) order by coalesce(i.name,p.username)),'[]'::jsonb)
      from public.campaign_members m join public.profiles p on p.id=m.user_id left join public.social_identities i on i.campaign_id=m.campaign_id and i.user_id=m.user_id
      where m.campaign_id=c and m.role='player' and m.access_active and m.archived_at is null),
    'avatars',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'storage_path',a.storage_path,'chest_only',a.chest_only) order by a.name),'[]'::jsonb)
      from public.campaign_avatars a where a.campaign_id=c and a.active and not a.blocked),
    'frames',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'rarity',x.rarity,'asset_path',x.asset_path) order by x.name),'[]'::jsonb)
      from public.cosmetics x where x.campaign_id=c and x.kind='frame' and x.active and x.archived_at is null and x.rarity in ('common','uncommon','rare','epic','legendary'))
  );
end $$;

create or replace function public.chest_admin_action(c uuid, op text, d jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.campaign_members; reward public.chest_rewards; rid uuid; delta integer; odds_total integer;
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
    update public.chest_settings set cost_gems=coalesce((d->>'cost_gems')::integer,cost_gems),enabled=coalesce((d->>'enabled')::boolean,enabled),updated_at=now(),updated_by=auth.uid() where campaign_id=c;
  elsif op='odds' then
    update public.chest_rarity_odds o set weight_bp=(d->>o.rarity)::integer where o.campaign_id=c and d ? o.rarity;
    select sum(weight_bp) into odds_total from public.chest_rarity_odds where campaign_id=c;
    if odds_total<>10000 then raise exception 'As probabilidades devem somar 100%%'; end if;
  elsif op='reward_save' then
    rid:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
    if exists(select 1 from public.chest_rewards r where r.id=rid and r.campaign_id<>c) then raise exception 'Prêmio inválido'; end if;
    if d->>'reward_type'='avatar' then
      if not exists(select 1 from public.campaign_avatars a where a.id=(d->>'avatar_id')::uuid and a.campaign_id=c and a.active and not a.blocked) then raise exception 'Avatar inválido'; end if;
      update public.campaign_avatars set chest_only=true where id=(d->>'avatar_id')::uuid;
    elsif d->>'reward_type'='frame' then
      if not exists(select 1 from public.cosmetics x where x.id=(d->>'cosmetic_id')::uuid and x.campaign_id=c and x.kind='frame' and x.active and x.archived_at is null and x.rarity in ('common','uncommon','rare','epic','legendary')) then raise exception 'Moldura inválida para o Baú'; end if;
    elsif d->>'reward_type' not in ('xp','dracmas') or coalesce((d->>'amount')::bigint,0)<=0 then raise exception 'Prêmio inválido'; end if;
    insert into public.chest_rewards(id,campaign_id,rarity,reward_type,label,amount,avatar_id,cosmetic_id,weight,active,display_order,updated_at)
    values(rid,c,d->>'rarity',d->>'reward_type',trim(d->>'label'),nullif(d->>'amount','')::bigint,nullif(d->>'avatar_id','')::uuid,nullif(d->>'cosmetic_id','')::uuid,coalesce((d->>'weight')::integer,1),coalesce((d->>'active')::boolean,true),coalesce((d->>'display_order')::integer,0),now())
    on conflict(id) do update set rarity=excluded.rarity,reward_type=excluded.reward_type,label=excluded.label,amount=excluded.amount,avatar_id=excluded.avatar_id,cosmetic_id=excluded.cosmetic_id,weight=excluded.weight,active=excluded.active,display_order=excluded.display_order,updated_at=now()
    returning * into reward;
    return to_jsonb(reward);
  elsif op='reward_toggle' then
    update public.chest_rewards set active=coalesce((d->>'active')::boolean,false),updated_at=now() where id=(d->>'id')::uuid and campaign_id=c returning * into reward;
    if reward.id is null then raise exception 'Prêmio não encontrado'; end if;
    return to_jsonb(reward);
  else raise exception 'Operação inválida'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- Chest-only avatars remain protected even if a client tries to assign one directly.
create or replace function alvorecer_private.enforce_chest_avatar_ownership()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_user uuid; target_identity uuid; locked boolean;
begin
  if new.avatar_id is null or (tg_op='UPDATE' and new.avatar_id is not distinct from old.avatar_id) then return new; end if;
  select a.chest_only into locked from public.campaign_avatars a where a.id=new.avatar_id and a.campaign_id=new.campaign_id;
  if not coalesce(locked,false) or public.is_master(new.campaign_id) then return new; end if;
  target_user:=case when tg_table_name='characters' then new.owner_id else new.user_id end;
  select i.id into target_identity from public.social_identities i where i.campaign_id=new.campaign_id and i.user_id=target_user;
  if not exists(select 1 from public.avatar_grants g where g.identity_id=target_identity and g.avatar_id=new.avatar_id) then
    raise exception 'Avatar exclusivo do Baú ainda não conquistado';
  end if;
  return new;
end $$;
create trigger enforce_chest_character_avatar before insert or update of avatar_id on public.characters
  for each row execute function alvorecer_private.enforce_chest_avatar_ownership();
create trigger enforce_chest_identity_avatar before insert or update of avatar_id on public.social_identities
  for each row execute function alvorecer_private.enforce_chest_avatar_ownership();

-- Hide unopened chest avatars from the regular picker while keeping them
-- visible to Pink and to the player who unlocked them.
create or replace function public.avatar_catalog(c uuid)
returns table(
  id uuid,campaign_id uuid,name text,storage_path text,active boolean,blocked boolean,shared boolean,
  exclusive_user_id uuid,created_by uuid,created_at timestamptz,archived_at timestamptz,state text,
  usage jsonb,usage_count bigint,occupied_by_other boolean,exclusive_username text,exclusive_name text
)
language plpgsql stable security definer set search_path=public as $$
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  return query
  with raw_usage as (
    select i.avatar_id,i.user_id from social_identities i join campaign_members m on m.campaign_id=i.campaign_id and m.user_id=i.user_id
    where i.campaign_id=c and i.avatar_id is not null and i.user_id is not null and i.kind='player' and m.role='player' and m.access_active and m.archived_at is null
    union
    select ch.avatar_id,ch.owner_id from characters ch join campaign_members m on m.campaign_id=ch.campaign_id and m.user_id=ch.owner_id
    where ch.campaign_id=c and ch.avatar_id is not null and ch.owner_id is not null and not ch.archived and m.role='player' and m.access_active and m.archived_at is null
  ), grouped_usage as (
    select u.avatar_id,jsonb_agg(jsonb_build_object('user_id',p.id,'username',p.username,'name',coalesce(nullif(p.display_name,''),p.username)) order by coalesce(nullif(p.display_name,''),p.username),p.id) users,count(*) user_count
    from raw_usage u join profiles p on p.id=u.user_id group by u.avatar_id
  )
  select a.id,a.campaign_id,a.name,a.storage_path,a.active,a.blocked,a.shared,a.exclusive_user_id,a.created_by,a.created_at,a.archived_at,
    case when not a.active then 'archived' when a.blocked then 'blocked' when a.exclusive_user_id is not null then 'exclusive' when a.shared then 'shared' when gu.avatar_id is not null then 'in_use' else 'available' end,
    case when is_master(c) then coalesce(gu.users,'[]'::jsonb) else '[]'::jsonb end,coalesce(gu.user_count,0),
    exists(select 1 from raw_usage current_usage where current_usage.avatar_id=a.id and current_usage.user_id<>auth.uid()),
    exclusive_profile.username,coalesce(nullif(exclusive_profile.display_name,''),exclusive_profile.username)
  from campaign_avatars a left join grouped_usage gu on gu.avatar_id=a.id left join profiles exclusive_profile on exclusive_profile.id=a.exclusive_user_id
  where a.campaign_id=c
    and (is_master(c) or not a.chest_only or exists(
      select 1 from avatar_grants g join social_identities own_identity on own_identity.id=g.identity_id
      where g.avatar_id=a.id and own_identity.campaign_id=c and own_identity.user_id=auth.uid()
    ))
    and (is_master(c) or a.active or exists(select 1 from raw_usage own_usage where own_usage.avatar_id=a.id and own_usage.user_id=auth.uid()))
  order by a.active desc,a.created_at desc,a.id;
end $$;

revoke all on function public.chest_dashboard(uuid) from public,anon;
revoke all on function public.chest_gift(uuid,uuid,text,uuid) from public,anon;
revoke all on function public.chest_open(uuid,uuid,uuid,uuid) from public,anon;
revoke all on function public.chest_admin_dashboard(uuid) from public,anon;
revoke all on function public.chest_admin_action(uuid,text,jsonb) from public,anon;
grant execute on function public.chest_dashboard(uuid) to authenticated,service_role;
grant execute on function public.chest_gift(uuid,uuid,text,uuid) to authenticated,service_role;
grant execute on function public.chest_open(uuid,uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.chest_admin_dashboard(uuid) to authenticated,service_role;
grant execute on function public.chest_admin_action(uuid,text,jsonb) to authenticated,service_role;
