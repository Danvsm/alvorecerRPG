-- Correct portrait path authorization, stack inventory quantities, and cover frequent relations.
drop policy if exists portrait_read on storage.objects;
drop policy if exists portrait_insert on storage.objects;
drop policy if exists portrait_delete on storage.objects;
create policy portrait_read on storage.objects for select to authenticated using(bucket_id='portraits' and exists(select 1 from public.characters ch where ch.id::text=(storage.foldername(storage.objects.name))[1] and public.is_member(ch.campaign_id)));
create policy portrait_insert on storage.objects for insert to authenticated with check(bucket_id='portraits' and exists(select 1 from public.characters ch where ch.id::text=(storage.foldername(storage.objects.name))[1] and public.can_character(ch.id)));
create policy portrait_delete on storage.objects for delete to authenticated using(bucket_id='portraits' and exists(select 1 from public.characters ch where ch.id::text=(storage.foldername(storage.objects.name))[1] and public.can_character(ch.id)));

with grouped as (select character_id,item_id,(array_agg(id order by id))[1] keep_id,sum(quantity)::integer total from public.character_items group by character_id,item_id having count(*)>1)
update public.character_items ci set quantity=g.total from grouped g where ci.id=g.keep_id;
with grouped as (select character_id,item_id,(array_agg(id order by id))[1] keep_id from public.character_items group by character_id,item_id having count(*)>1)
delete from public.character_items ci using grouped g where ci.character_id=g.character_id and ci.item_id=g.item_id and ci.id<>g.keep_id;
create unique index if not exists character_items_character_item_uidx on public.character_items(character_id,item_id);

drop policy if exists read_policy on public.profiles;
create policy read_policy on public.profiles for select to authenticated using (id=(select auth.uid()) or exists(select 1 from campaign_members m where m.user_id=profiles.id and is_master(m.campaign_id)));
drop policy if exists read_policy on public.campaign_members;
create policy read_policy on public.campaign_members for select to authenticated using (user_id=(select auth.uid()) or is_master(campaign_id));

create index if not exists advantages_campaign_id_idx on public.advantages(campaign_id);
create index if not exists attributes_campaign_id_idx on public.attributes(campaign_id);
create index if not exists attributes_character_id_idx on public.attributes(character_id);
create index if not exists audit_logs_actor_id_idx on public.audit_logs(actor_id);
create index if not exists audit_logs_character_id_idx on public.audit_logs(character_id);
create index if not exists character_advantages_advantage_id_idx on public.character_advantages(advantage_id);
create index if not exists character_items_item_id_idx on public.character_items(item_id);
create index if not exists character_resources_attribute_id_idx on public.character_resources(attribute_id);
create index if not exists characters_owner_id_idx on public.characters(owner_id);
create index if not exists combat_participants_character_id_idx on public.combat_participants(character_id);
create index if not exists combat_participants_template_id_idx on public.combat_participants(template_id);
create index if not exists combat_rooms_campaign_id_idx on public.combat_rooms(campaign_id);
create index if not exists creature_templates_campaign_id_idx on public.creature_templates(campaign_id);
create index if not exists invites_campaign_id_idx on public.invites(campaign_id);
create index if not exists invites_used_by_idx on public.invites(used_by);
create index if not exists items_campaign_id_idx on public.items(campaign_id);
create index if not exists resource_rules_attribute_id_idx on public.resource_rules(attribute_id);
create index if not exists shop_products_item_id_idx on public.shop_products(item_id);

create or replace function public.game_command(c uuid, op text, d jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
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
   if target is null then insert into character_items(character_id,item_id,quantity,notes) values(ch.id,(d->>'item_id')::uuid,(d->>'quantity')::integer,coalesce(d->>'notes','')) on conflict(character_id,item_id) do update set quantity=excluded.quantity,notes=excluded.notes;
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

create or replace function public.game_action(c uuid,op text,d jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
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
  insert into character_items(character_id,item_id,quantity) values(ch.id,item.id,1) on conflict(character_id,item_id) do update set quantity=character_items.quantity+1;
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
