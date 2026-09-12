create extension if not exists pgcrypto;
create table public.campaigns(id uuid primary key default gen_random_uuid(), name text not null, theme jsonb not null default '{}');
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, username text not null unique check(username ~ '^[a-z0-9_]{3,32}$'));
create table public.campaign_members(campaign_id uuid references public.campaigns on delete cascade, user_id uuid references public.profiles on delete cascade, role text not null check(role in ('master','player')), primary key(campaign_id,user_id));
create table public.characters(id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, owner_id uuid references public.profiles, name text not null, class text not null default '', race text not null default '', image text, xp integer not null default 0 check(xp>=0), money integer not null default 0 check(money>=0), information jsonb not null default '{}', notes text not null default '', archived boolean not null default false);
create table public.character_resources(character_id uuid references public.characters on delete cascade, key text check(key in ('life','mana','stamina')), current integer not null check(current>=0), maximum integer not null check(maximum>=0), check(current<=maximum), primary key(character_id,key));
create table public.attributes(id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, character_id uuid references public.characters, name text not null, position integer not null default 0, active boolean not null default true, cost integer check(cost>=0));
create table public.character_attributes(character_id uuid references public.characters on delete cascade, attribute_id uuid references public.attributes, value integer not null default 0, primary key(character_id,attribute_id));
create table public.advantages(id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, name text not null, description text not null default '', cost integer not null default 0 check(cost>=0), requirements text not null default '', active boolean not null default true);
create table public.character_advantages(character_id uuid references public.characters on delete cascade, advantage_id uuid references public.advantages, primary key(character_id,advantage_id));
create table public.items(id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, name text not null, description text not null default '', active boolean not null default true);
create table public.character_items(id uuid primary key default gen_random_uuid(), character_id uuid not null references public.characters, item_id uuid not null references public.items, quantity integer not null check(quantity>0), notes text not null default '');
create table public.creature_templates(id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, name text not null, kind text not null default 'creature' check(kind in ('creature','npc','minion')), life integer not null default 20 check(life>=0), mana integer not null default 0 check(mana>=0), stamina integer not null default 10 check(stamina>=0), attributes jsonb not null default '{}', notes text not null default '', active boolean not null default true);
create table public.combat_rooms(id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, name text not null, active boolean not null default true);
create table public.combat_participants(id uuid primary key default gen_random_uuid(), room_id uuid not null references public.combat_rooms, character_id uuid references public.characters, template_id uuid references public.creature_templates, name text not null, side text not null check(side in ('ally','enemy','neutral')), life integer not null default 0 check(life>=0), life_max integer not null default 0 check(life_max>=life), mana integer not null default 0 check(mana>=0), mana_max integer not null default 0 check(mana_max>=mana), stamina integer not null default 0 check(stamina>=0), stamina_max integer not null default 0 check(stamina_max>=stamina), reveal boolean not null default false, unique(room_id,character_id));
create table public.audit_logs(id bigint generated always as identity primary key, campaign_id uuid not null references public.campaigns, character_id uuid references public.characters, actor_id uuid references public.profiles, action text not null, detail jsonb not null, created_at timestamptz not null default now());
create table public.campaign_events(campaign_id uuid primary key references public.campaigns, revision bigint not null default 0);
create table public.invites(id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns, token_hash text not null unique, expires_at timestamptz not null, used_by uuid references public.profiles, cancelled boolean not null default false, claim_id uuid, claimed_at timestamptz);
create table public.credential_vault(user_id uuid primary key references public.profiles on delete cascade, identity text not null unique, ciphertext text not null, pending_ciphertext text, locked_at timestamptz);
create table public.login_limits(key text primary key, count integer not null, started timestamptz not null);
create index on public.characters(campaign_id,owner_id);
create index on public.audit_logs(campaign_id,created_at desc);
create index on public.combat_participants(room_id);
create index on public.campaign_members(user_id);
create function public.is_master(c uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid() and role='master')$$;
create function public.is_member(c uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from campaign_members where campaign_id=c and user_id=auth.uid())$$;
create function public.can_character(c uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from characters where id=c and (is_master(campaign_id) or (owner_id=auth.uid() and is_member(campaign_id))))$$;
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
grant all on public.campaigns to service_role;
grant select on public.campaigns to authenticated;
create policy read_policy on public.campaigns for select to authenticated using (is_member(id));
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant all on public.profiles to service_role;
grant select on public.profiles to authenticated;
create policy read_policy on public.profiles for select to authenticated using (id=auth.uid() or exists(select 1 from campaign_members m where m.user_id=profiles.id and is_master(m.campaign_id)));
alter table public.campaign_members enable row level security;
revoke all on public.campaign_members from anon, authenticated;
grant all on public.campaign_members to service_role;
grant select on public.campaign_members to authenticated;
create policy read_policy on public.campaign_members for select to authenticated using (user_id=auth.uid() or is_master(campaign_id));
alter table public.characters enable row level security;
revoke all on public.characters from anon, authenticated;
grant all on public.characters to service_role;
grant select on public.characters to authenticated;
create policy read_policy on public.characters for select to authenticated using (can_character(id));
alter table public.character_resources enable row level security;
revoke all on public.character_resources from anon, authenticated;
grant all on public.character_resources to service_role;
grant select on public.character_resources to authenticated;
create policy read_policy on public.character_resources for select to authenticated using (can_character(character_id));
alter table public.attributes enable row level security;
revoke all on public.attributes from anon, authenticated;
grant all on public.attributes to service_role;
grant select on public.attributes to authenticated;
create policy read_policy on public.attributes for select to authenticated using (is_member(campaign_id) and (character_id is null or can_character(character_id)));
alter table public.character_attributes enable row level security;
revoke all on public.character_attributes from anon, authenticated;
grant all on public.character_attributes to service_role;
grant select on public.character_attributes to authenticated;
create policy read_policy on public.character_attributes for select to authenticated using (can_character(character_id));
alter table public.advantages enable row level security;
revoke all on public.advantages from anon, authenticated;
grant all on public.advantages to service_role;
grant select on public.advantages to authenticated;
create policy read_policy on public.advantages for select to authenticated using (is_member(campaign_id));
alter table public.character_advantages enable row level security;
revoke all on public.character_advantages from anon, authenticated;
grant all on public.character_advantages to service_role;
grant select on public.character_advantages to authenticated;
create policy read_policy on public.character_advantages for select to authenticated using (can_character(character_id));
alter table public.items enable row level security;
revoke all on public.items from anon, authenticated;
grant all on public.items to service_role;
grant select on public.items to authenticated;
create policy read_policy on public.items for select to authenticated using (is_member(campaign_id));
alter table public.character_items enable row level security;
revoke all on public.character_items from anon, authenticated;
grant all on public.character_items to service_role;
grant select on public.character_items to authenticated;
create policy read_policy on public.character_items for select to authenticated using (can_character(character_id));
alter table public.creature_templates enable row level security;
revoke all on public.creature_templates from anon, authenticated;
grant all on public.creature_templates to service_role;
grant select on public.creature_templates to authenticated;
create policy read_policy on public.creature_templates for select to authenticated using (is_master(campaign_id));
alter table public.combat_rooms enable row level security;
revoke all on public.combat_rooms from anon, authenticated;
grant all on public.combat_rooms to service_role;
grant select on public.combat_rooms to authenticated;
create policy read_policy on public.combat_rooms for select to authenticated using (is_member(campaign_id));
alter table public.combat_participants enable row level security;
revoke all on public.combat_participants from anon, authenticated;
grant all on public.combat_participants to service_role;
grant select on public.combat_participants to authenticated;
create policy read_policy on public.combat_participants for select to authenticated using (exists(select 1 from combat_rooms r where r.id=room_id and is_master(r.campaign_id)));
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
grant all on public.audit_logs to service_role;
grant select on public.audit_logs to authenticated;
create policy read_policy on public.audit_logs for select to authenticated using (is_master(campaign_id) or (character_id is not null and can_character(character_id)));
alter table public.campaign_events enable row level security;
revoke all on public.campaign_events from anon, authenticated;
grant all on public.campaign_events to service_role;
grant select on public.campaign_events to authenticated;
create policy read_policy on public.campaign_events for select to authenticated using (is_member(campaign_id));
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;
grant all on public.invites to service_role;
grant select on public.invites to authenticated;
create policy read_policy on public.invites for select to authenticated using (is_master(campaign_id));
alter table public.credential_vault enable row level security;
revoke all on public.credential_vault from anon, authenticated;
grant all on public.credential_vault to service_role;
alter table public.login_limits enable row level security;
revoke all on public.login_limits from anon, authenticated;
grant all on public.login_limits to service_role;
grant usage,select on sequence public.audit_logs_id_seq to service_role;
create function public.record_event(c uuid, ch uuid, action text, detail jsonb, actor uuid default null) returns void language plpgsql security definer set search_path=public as $$begin
 insert into audit_logs(campaign_id,character_id,actor_id,action,detail) values(c,ch,coalesce(actor,auth.uid()),action,detail);
 insert into campaign_events(campaign_id,revision) values(c,1) on conflict(campaign_id) do update set revision=campaign_events.revision+1;
end$$;
create function public.combat_snapshot(c uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$declare result jsonb; begin
 if not is_member(c) then raise exception 'Sem permissão'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'room_id',p.room_id,'character_id',p.character_id,'name',coalesce(ch.name,p.name),'side',p.side,'reveal',p.reveal,
 'state',case when coalesce(cr.current,p.life)=0 then 'zero' when coalesce(cr.current,p.life)::numeric/greatest(coalesce(cr.maximum,p.life_max),1)>.6 then 'green' when coalesce(cr.current,p.life)::numeric/greatest(coalesce(cr.maximum,p.life_max),1)>=.3 then 'yellow' else 'red' end,
 'life',case when is_master(c) or p.side='ally' or p.reveal then coalesce(cr.current,p.life) end,
 'life_max',case when is_master(c) or p.side='ally' or p.reveal then coalesce(cr.maximum,p.life_max) end,
 'mana',case when is_master(c) or p.side='ally' or p.reveal then coalesce(mr.current,p.mana) end,
 'mana_max',case when is_master(c) or p.side='ally' or p.reveal then coalesce(mr.maximum,p.mana_max) end,
 'stamina',case when is_master(c) or p.side='ally' or p.reveal then coalesce(sr.current,p.stamina) end,
 'stamina_max',case when is_master(c) or p.side='ally' or p.reveal then coalesce(sr.maximum,p.stamina_max) end)),'[]') into result
 from combat_participants p join combat_rooms r on r.id=p.room_id left join characters ch on ch.id=p.character_id
 left join character_resources cr on cr.character_id=ch.id and cr.key='life'
 left join character_resources mr on mr.character_id=ch.id and mr.key='mana'
 left join character_resources sr on sr.character_id=ch.id and sr.key='stamina'
 where r.campaign_id=c and r.active;
 return result;
end$$;
create function public.game_command(c uuid, op text, d jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare ch characters; a advantages; at attributes; r character_resources; p combat_participants; t creature_templates; target uuid; result uuid; amount integer; before_value integer; after_value integer; room uuid; k text; master boolean;
begin
 if not is_member(c) then raise exception 'Sem permissão'; end if;
 master:=is_master(c);
 if op in ('resource','notes','image','buy','character','attribute_value','grant_advantage','inventory','balance') then
  select * into ch from characters where id=(d->>'character_id')::uuid and campaign_id=c for update;
  if ch.id is null or (not master and ch.owner_id is distinct from auth.uid()) then raise exception 'Personagem não permitido'; end if;
 end if;
 if op='resource' then
  k:=d->>'key'; select * into r from character_resources where character_id=ch.id and key=k for update;
  if not found then raise exception 'Recurso inválido'; end if;
  amount:=(d->>'delta')::integer;
  if amount is null or (not master and amount>=0) then raise exception 'Somente o mestre pode recuperar recursos'; end if;
  before_value:=r.current; after_value:=greatest(0,least(r.maximum,r.current+amount));
  update character_resources set current=after_value where character_id=ch.id and key=k;
  perform record_event(c,ch.id,k,jsonb_build_object('before',before_value,'after',after_value,'delta',after_value-before_value,'reason',coalesce(d->>'reason','Sessão')));
 elsif op='notes' then update characters set notes=left(coalesce(d->>'notes',''),20000) where id=ch.id; perform record_event(c,ch.id,'notes','{}');
 elsif op='image' then
  if (d->>'image') not like ch.id::text||'/%' then raise exception 'Imagem inválida'; end if;
  update characters set image=d->>'image' where id=ch.id; perform record_event(c,ch.id,'image','{}');
 elsif op='buy' then
  select * into a from advantages where id=(d->>'advantage_id')::uuid and campaign_id=c and active;
  if a.id is null then raise exception 'Vantagem indisponível'; end if;
  if a.requirements<>'' then raise exception 'Esta vantagem exige aprovação do mestre'; end if;
  if ch.xp<a.cost then raise exception 'XP insuficiente'; end if;
  insert into character_advantages values(ch.id,a.id);
  update characters set xp=xp-a.cost where id=ch.id;
  perform record_event(c,ch.id,'buy_advantage',jsonb_build_object('name',a.name,'delta',-a.cost,'before',ch.xp,'after',ch.xp-a.cost));
 else
  if not master then raise exception 'Somente o mestre'; end if;
  case op
  when 'new_character' then
   if not exists(select 1 from campaign_members where campaign_id=c and user_id=(d->>'owner_id')::uuid and role='player') then raise exception 'Jogador inválido'; end if;
   insert into characters(campaign_id,owner_id,name,class,race) values(c,(d->>'owner_id')::uuid,d->>'name',coalesce(d->>'class',''),coalesce(d->>'race','')) returning id into result;
   insert into character_resources select result,unnest(array['life','mana','stamina']),0,0;
   insert into character_attributes select result,id,0 from attributes where campaign_id=c and character_id is null;
  when 'character' then
   update characters set name=coalesce(nullif(d->>'name',''),name),class=coalesce(d->>'class',class),race=coalesce(d->>'race',race),information=coalesce(d->'information',information),archived=coalesce((d->>'archived')::boolean,archived) where id=ch.id;
   for k in select unnest(array['life','mana','stamina']) loop
    if d ? (k||'_max') then
     update character_resources set maximum=(d->>(k||'_max'))::integer,current=least((d->>(k||'_max'))::integer,current) where character_id=ch.id and key=k;
    end if;
   end loop;
  when 'balance' then
   amount:=(d->>'delta')::integer;
   if d->>'key'='xp' then before_value:=ch.xp; update characters set xp=xp+amount where id=ch.id returning xp into after_value;
   elsif d->>'key'='money' then before_value:=ch.money; update characters set money=money+amount where id=ch.id returning money into after_value;
   else raise exception 'Saldo inválido'; end if;
   d:=d||jsonb_build_object('before',before_value,'after',after_value);
  when 'attribute' then
   target:=nullif(d->>'id','')::uuid;
   if nullif(d->>'character_id','') is not null and not exists(select 1 from characters where id=(d->>'character_id')::uuid and campaign_id=c) then raise exception 'Personagem inválido'; end if;
   if target is null then insert into attributes(campaign_id,character_id,name,position) values(c,nullif(d->>'character_id','')::uuid,d->>'name',coalesce((d->>'position')::integer,0)) returning id into result;
   else update attributes set name=coalesce(d->>'name',name),position=coalesce((d->>'position')::integer,position),active=coalesce((d->>'active')::boolean,active),cost=coalesce((d->>'cost')::integer,cost) where id=target and campaign_id=c returning id into result; end if;
  when 'attribute_value' then
   select * into at from attributes where id=(d->>'attribute_id')::uuid and campaign_id=c;
   if at.id is null or (at.character_id is not null and at.character_id<>ch.id) then raise exception 'Atributo inválido'; end if;
   insert into character_attributes values(ch.id,at.id,(d->>'value')::integer) on conflict(character_id,attribute_id) do update set value=excluded.value;
  when 'advantage' then
   target:=nullif(d->>'id','')::uuid;
   if target is null then insert into advantages(campaign_id,name,description,cost,requirements) values(c,d->>'name',coalesce(d->>'description',''),coalesce((d->>'cost')::integer,0),coalesce(d->>'requirements','')) returning id into result;
   else update advantages set name=coalesce(d->>'name',name),description=coalesce(d->>'description',description),cost=coalesce((d->>'cost')::integer,cost),requirements=coalesce(d->>'requirements',requirements),active=coalesce((d->>'active')::boolean,active) where id=target and campaign_id=c; end if;
  when 'grant_advantage' then
   if not exists(select 1 from advantages where id=(d->>'advantage_id')::uuid and campaign_id=c) then raise exception 'Vantagem inválida'; end if;
   if coalesce((d->>'remove')::boolean,false) then delete from character_advantages where character_id=ch.id and advantage_id=(d->>'advantage_id')::uuid;
   else insert into character_advantages values(ch.id,(d->>'advantage_id')::uuid); end if;
  when 'item' then
   target:=nullif(d->>'id','')::uuid;
   if target is null then insert into items(campaign_id,name,description) values(c,d->>'name',coalesce(d->>'description','')) returning id into result;
   else update items set name=coalesce(d->>'name',name),description=coalesce(d->>'description',description),active=coalesce((d->>'active')::boolean,active) where id=target and campaign_id=c; end if;
  when 'inventory' then
   if not exists(select 1 from items where id=(d->>'item_id')::uuid and campaign_id=c) then raise exception 'Item inválido'; end if;
   target:=nullif(d->>'id','')::uuid;
   if target is null then insert into character_items(character_id,item_id,quantity,notes) values(ch.id,(d->>'item_id')::uuid,(d->>'quantity')::integer,coalesce(d->>'notes',''));
   elsif (d->>'quantity')::integer=0 then delete from character_items where id=target and character_id=ch.id;
   else update character_items set quantity=(d->>'quantity')::integer,notes=coalesce(d->>'notes',notes) where id=target and character_id=ch.id; end if;
  when 'creature' then
   target:=nullif(d->>'id','')::uuid;
   if target is null then insert into creature_templates(campaign_id,name,kind,life,mana,stamina,notes,attributes) values(c,d->>'name',coalesce(d->>'kind','creature'),coalesce((d->>'life')::integer,20),coalesce((d->>'mana')::integer,0),coalesce((d->>'stamina')::integer,10),coalesce(d->>'notes',''),coalesce(d->'attributes','{}')) returning id into result;
   else update creature_templates set name=coalesce(d->>'name',name),life=coalesce((d->>'life')::integer,life),mana=coalesce((d->>'mana')::integer,mana),stamina=coalesce((d->>'stamina')::integer,stamina),notes=coalesce(d->>'notes',notes),attributes=coalesce(d->'attributes',attributes),active=coalesce((d->>'active')::boolean,active) where id=target and campaign_id=c; end if;
  when 'room' then
   target:=nullif(d->>'id','')::uuid;
   if target is null then insert into combat_rooms(campaign_id,name) values(c,d->>'name') returning id into result;
   else update combat_rooms set active=coalesce((d->>'active')::boolean,active),name=coalesce(d->>'name',name) where id=target and campaign_id=c; end if;
  when 'participant' then
   room:=(d->>'room_id')::uuid;
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
  perform record_event(c,ch.id,op,d);
 end if;
 return jsonb_build_object('id',result);
end$$;
-- Only explicitly listed entrypoints may be called by a browser.
revoke execute on function public.is_master(uuid),public.is_member(uuid),public.can_character(uuid),public.record_event(uuid,uuid,text,jsonb,uuid),public.combat_snapshot(uuid),public.game_command(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.is_master(uuid),public.is_member(uuid),public.can_character(uuid),public.combat_snapshot(uuid),public.game_command(uuid,text,jsonb) to authenticated;
alter publication supabase_realtime add table public.campaign_events;
