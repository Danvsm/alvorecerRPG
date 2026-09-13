-- Campaign attributes alone determine level. Personal resources/attributes do
-- not unexpectedly change the requirements for the rest of the campaign.
alter table public.campaigns add column attribute_xp_cost integer not null default 100 check(attribute_xp_cost>0);

create function public.character_progression(target uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare ch characters; minimum_value integer; n integer; completed integer;
  base integer; calculated_level integer; over_base integer; cost integer;
begin
  select * into ch from characters where id=target;
  if ch.id is null or not can_character(target) then raise exception 'Personagem não autorizado'; end if;
  select count(*)::integer,coalesce(min(coalesce(ca.value,0)),0)
    into n,minimum_value from attributes a
    left join character_attributes ca on ca.attribute_id=a.id and ca.character_id=target
    where a.campaign_id=ch.campaign_id and a.active and a.character_id is null;
  calculated_level:=least(10,greatest(1,ceil(minimum_value/5.0)::integer));
  base:=calculated_level*5;
  select count(*) filter(where coalesce(ca.value,0)>=base)::integer,
         count(*) filter(where coalesce(ca.value,0)>base)::integer
    into completed,over_base from attributes a
    left join character_attributes ca on ca.attribute_id=a.id and ca.character_id=target
    where a.campaign_id=ch.campaign_id and a.active and a.character_id is null;
  if n>0 and completed=n and over_base>=2 and calculated_level<10 then
    calculated_level:=calculated_level+1;
    base:=calculated_level*5;
    select count(*)::integer into completed from attributes a
      join character_attributes ca on ca.attribute_id=a.id and ca.character_id=target
      where a.campaign_id=ch.campaign_id and a.active and a.character_id is null and ca.value>=base;
    over_base:=0;
  end if;
  select attribute_xp_cost into cost from campaigns where id=ch.campaign_id;
  return jsonb_build_object('level',calculated_level,'target',base,'completed',completed,
    'total',n,'next_unlocked',n>0 and completed=n and over_base>0 and base<50,
    'can_unlock',n>0 and completed=n and base<50,
    'cap',least(50,case when n>0 and minimum_value>=base then base+5 else base end),
    'cost',cost,'xp',ch.xp,'xp_total',ch.xp_total);
end$$;
revoke all on function public.character_progression(uuid) from public,anon;
grant execute on function public.character_progression(uuid) to authenticated,service_role;

create function public.buy_attribute(c uuid,target uuid,attribute uuid,request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare ch characters; rule jsonb; current_value integer; cost integer; receipt alvorecer_private.receipts;
  payload jsonb:=jsonb_build_object('character_id',target,'attribute_id',attribute,'campaign_id',c);
  v_result jsonb;
begin
  if not is_member(c) or request_id is null then raise exception 'Operação não autorizada'; end if;
  select * into ch from characters where id=target and campaign_id=c and not archived for update;
  if ch.id is null or (ch.owner_id is distinct from auth.uid() and not is_master(c)) then
    raise exception 'Personagem não autorizado';
  end if;
  insert into alvorecer_private.receipts(actor_id,request_id,operation,payload,result)
    values(auth.uid(),request_id,'buy_attribute',payload,null) on conflict do nothing;
  if not found then
    select * into receipt from alvorecer_private.receipts r where r.actor_id=auth.uid() and r.request_id=buy_attribute.request_id;
    if receipt.operation<>'buy_attribute' or receipt.payload<>payload then raise exception 'Identificador reutilizado'; end if;
    return receipt.result;
  end if;
  if not exists(select 1 from attributes where id=attribute and campaign_id=c and active and character_id is null) then
    raise exception 'Atributo indisponível para evolução';
  end if;
  rule:=character_progression(target); cost:=(rule->>'cost')::integer;
  select coalesce(value,0) into current_value from character_attributes where character_id=target and attribute_id=attribute;
  current_value:=coalesce(current_value,0);
  if ch.xp<cost then raise exception 'XP insuficiente'; end if;
  if current_value >= (rule->>'cap')::integer then raise exception 'Conclua a meta dos demais atributos antes de avançar'; end if;
  update characters set xp=xp-cost where id=target;
  insert into character_attributes(character_id,attribute_id,value) values(target,attribute,current_value+1)
    on conflict(character_id,attribute_id) do update set value=excluded.value;
  v_result:=character_progression(target);
  update characters set level=(v_result->>'level')::integer where id=target;
  v_result:=v_result||jsonb_build_object('attribute_id',attribute,'before',current_value,'after',current_value+1);
  perform record_event(c,target,'attribute_purchase',jsonb_build_object('attribute_id',attribute,
    'before',current_value,'after',current_value+1,'xp_before',ch.xp,'xp_after',ch.xp-cost,
    'cost',cost,'level',(v_result->>'level')::integer));
  update alvorecer_private.receipts r set result=v_result where r.actor_id=auth.uid() and r.request_id=buy_attribute.request_id;
  return v_result;
end$$;
revoke all on function public.buy_attribute(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.buy_attribute(uuid,uuid,uuid,uuid) to authenticated,service_role;

-- Lifetime XP cannot be reduced through any SQL path, including corrections.
create or replace function public.maintain_xp_total()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='INSERT' then new.xp_total:=greatest(coalesce(new.xp_total,0),new.xp);
  else new.xp_total:=greatest(coalesce(new.xp_total,0),old.xp_total+greatest(new.xp-old.xp,0));
  end if;
  return new;
end$$;
drop trigger maintain_xp_total_trigger on public.characters;
create trigger maintain_xp_total_trigger before insert or update of xp,xp_total on public.characters
for each row execute function public.maintain_xp_total();
