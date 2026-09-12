create schema if not exists alvorecer_private;
revoke all on schema alvorecer_private from public,anon,authenticated;
create table public.resource_rules(campaign_id uuid references public.campaigns, key text, automatic boolean not null default false, attribute_id uuid references public.attributes, multiplier numeric not null default 1 check(multiplier>=0), primary key(campaign_id,key));
alter table public.character_resources add column inherit_rule boolean not null default true, add column automatic boolean not null default false, add column attribute_id uuid references public.attributes, add column multiplier numeric not null default 1 check(multiplier>=0), add column manual_maximum integer not null default 0 check(manual_maximum>=0);
update public.character_resources set manual_maximum=maximum;
alter table public.items add column kind text not null default 'common', add column image text;
create table public.item_effects(id uuid primary key default gen_random_uuid(),item_id uuid not null references public.items,resource_key text not null check(resource_key in ('life','mana','stamina')),amount integer not null check(amount>0),unique(item_id,resource_key));
create table public.shops(id uuid primary key default gen_random_uuid(),campaign_id uuid not null references public.campaigns,name text not null,description text not null default '',active boolean not null default true);
create table public.shop_products(id uuid primary key default gen_random_uuid(),shop_id uuid not null references public.shops,item_id uuid not null references public.items,name text not null,description text not null default '',image text,price integer not null check(price>=0),stock integer check(stock>=0),active boolean not null default true);
create table alvorecer_private.receipts(actor_id uuid not null,request_id uuid not null,operation text not null,payload jsonb not null,result jsonb,primary key(actor_id,request_id));
alter table alvorecer_private.receipts enable row level security;
alter table public.resource_rules enable row level security;
alter table public.item_effects enable row level security;
alter table public.shops enable row level security;
alter table public.shop_products enable row level security;
revoke all on public.resource_rules,public.item_effects,public.shops,public.shop_products from anon,authenticated;
grant select on public.resource_rules,public.item_effects,public.shops,public.shop_products to authenticated;
grant all on public.resource_rules,public.item_effects,public.shops,public.shop_products to service_role;
create policy read_rules on public.resource_rules for select to authenticated using(public.is_member(campaign_id));
create policy read_effects on public.item_effects for select to authenticated using(exists(select 1 from public.items i where i.id=item_id and public.is_member(i.campaign_id)));
create policy read_shops on public.shops for select to authenticated using(public.is_member(campaign_id));
create policy read_products on public.shop_products for select to authenticated using(exists(select 1 from public.shops s where s.id=shop_id and public.is_member(s.campaign_id)));
create index on public.item_effects(item_id);
create index on public.shops(campaign_id);
create index on public.shop_products(shop_id);
create index on public.character_items(character_id,item_id);
create index on public.character_attributes(attribute_id);
create function alvorecer_private.calculate_resource() returns trigger language plpgsql security definer set search_path=public as $$declare rule resource_rules; c uuid; attr uuid; mul numeric; auto boolean; v integer; begin
 select campaign_id into c from characters where id=new.character_id;
 select * into rule from resource_rules where campaign_id=c and key=new.key;
 auto:=case when new.inherit_rule then coalesce(rule.automatic,false) else new.automatic end;
 attr:=case when new.inherit_rule then rule.attribute_id else new.attribute_id end;
 mul:=case when new.inherit_rule then coalesce(rule.multiplier,1) else new.multiplier end;
 if auto then
  if attr is null then raise exception 'Selecione um atributo para o cálculo'; end if;
  select value into v from character_attributes where character_id=new.character_id and attribute_id=attr;
  new.maximum:=floor(greatest(coalesce(v,0),0)::numeric*mul)::integer;
 else
  if tg_op='INSERT' then new.manual_maximum:=new.maximum;
  elsif new.maximum is distinct from old.maximum and new.manual_maximum=old.manual_maximum then new.manual_maximum:=new.maximum; end if;
  new.maximum:=new.manual_maximum;
 end if;
 new.current:=least(new.current,new.maximum);
 return new;
end$$;
create trigger calculate_resource before insert or update on public.character_resources for each row execute function alvorecer_private.calculate_resource();
create function alvorecer_private.audit_maximum() returns trigger language plpgsql security definer set search_path=public as $$declare c uuid; begin
 if new.maximum is distinct from old.maximum then
 select campaign_id into c from characters where id=new.character_id;
 perform record_event(c,new.character_id,'resource_maximum',jsonb_build_object('key',new.key,'before',old.maximum,'after',new.maximum,'current_before',old.current,'current_after',new.current));
 end if; return new;
end$$;
create trigger audit_maximum after update on public.character_resources for each row execute function alvorecer_private.audit_maximum();
create function alvorecer_private.attribute_recalculate() returns trigger language plpgsql security definer set search_path=public as $$begin
 update character_resources set maximum=maximum where character_id=new.character_id;
 return new;
end$$;
create trigger attribute_recalculate after insert or update on public.character_attributes for each row execute function alvorecer_private.attribute_recalculate();
create function alvorecer_private.rule_recalculate() returns trigger language plpgsql security definer set search_path=public as $$begin
 update character_resources r set maximum=r.maximum from characters ch where r.character_id=ch.id and ch.campaign_id=new.campaign_id and r.key=new.key and r.inherit_rule;
 return new;
end$$;
create trigger rule_recalculate after insert or update on public.resource_rules for each row execute function alvorecer_private.rule_recalculate();
-- Initial defaults only; subsequent references use attribute UUIDs, never names.
insert into public.resource_rules(campaign_id,key,automatic,attribute_id,multiplier) select campaign_id,case name when 'Vigor' then 'life' else 'mana' end,true,id,case name when 'Vigor' then 5 else 10 end from public.attributes where character_id is null and name in ('Vigor','Poder') on conflict do nothing;
create function alvorecer_private.initial_rule() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.character_id is null and new.name in ('Vigor','Poder') then
 insert into resource_rules values(new.campaign_id,case new.name when 'Vigor' then 'life' else 'mana' end,true,new.id,case new.name when 'Vigor' then 5 else 10 end) on conflict do nothing;
 end if;return new;
end$$;
create trigger initial_rule after insert on public.attributes for each row execute function alvorecer_private.initial_rule();
create function public.game_action(c uuid,op text,d jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare ch characters; inv character_items; item items; effect item_effects; r character_resources; product shop_products; store shops; rule resource_rules; v_id uuid; out jsonb:='{}'; receipt alvorecer_private.receipts; recovered jsonb:='{}'; delta integer; k text; old_resource character_resources;
begin
 if auth.uid() is null or not is_member(c) then raise exception 'Sem permissão'; end if;
 if op in ('consume','purchase') then
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
 if op='consume' then
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
 elsif op='purchase' then
  select p.* into product from shop_products p join shops s on s.id=p.shop_id where p.id=(d->>'product_id')::uuid and s.campaign_id=c for update of p;
  if product.id is null then raise exception 'Produto indisponível'; end if;
  select * into store from shops where shops.id=product.shop_id for share;
  select * into item from items where items.id=product.item_id and campaign_id=c for share;
  if not store.active or not product.active or not item.active or product.stock=0 then raise exception 'Produto indisponível'; end if;
  if ch.money<product.price then raise exception 'Moedas insuficientes'; end if;
  update characters set money=money-product.price where characters.id=ch.id;
  insert into character_items(character_id,item_id,quantity) values(ch.id,item.id,1);
  if product.stock is not null then update shop_products set stock=stock-1 where shop_products.id=product.id; end if;
  out:=jsonb_build_object('name',product.name,'delta',-product.price,'before',ch.money,'after',ch.money-product.price,'stock_after',product.stock-1);
  perform record_event(c,ch.id,'purchase',out);
 else
  if not is_master(c) then raise exception 'Somente o mestre'; end if;
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
   insert into shop_products values(v_id,store.id,item.id,coalesce(nullif(d->>'name',''),item.name),coalesce(d->>'description',''),nullif(d->>'image',''),(d->>'price')::integer,nullif(d->>'stock','')::integer,coalesce((d->>'active')::boolean,true))
   on conflict on constraint shop_products_pkey do update set name=excluded.name,description=excluded.description,image=excluded.image,price=excluded.price,stock=excluded.stock,active=excluded.active,item_id=excluded.item_id;
   out:=jsonb_build_object('id',v_id);
  else raise exception 'Operação desconhecida';
  end case;
  perform record_event(c,ch.id,op,jsonb_build_object('input',d,'result',out));
 end if;
 if op in ('consume','purchase') then update alvorecer_private.receipts set result=out where actor_id=auth.uid() and request_id=(d->>'request_id')::uuid; end if;
 return out;
end$$;
revoke execute on function public.game_action(uuid,text,jsonb) from public,anon;
grant execute on function public.game_action(uuid,text,jsonb) to authenticated;
revoke all on all functions in schema alvorecer_private from public,anon,authenticated;
