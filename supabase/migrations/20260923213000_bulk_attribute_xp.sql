create function public.buy_attribute_xp(
  c uuid,
  target uuid,
  attribute uuid,
  xp_amount integer,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  ch characters;
  rule jsonb;
  current_value integer;
  cap_value integer;
  cost integer;
  points integer;
  receipt alvorecer_private.receipts;
  payload jsonb:=jsonb_build_object(
    'character_id',target,
    'attribute_id',attribute,
    'campaign_id',c,
    'xp_amount',xp_amount
  );
  v_result jsonb;
begin
  if not is_member(c) or request_id is null then
    raise exception 'Operação não autorizada';
  end if;

  if xp_amount is null or xp_amount <= 0 then
    raise exception 'Informe uma quantidade válida de XP';
  end if;

  select * into ch
  from characters
  where id=target and campaign_id=c and not archived
  for update;

  if ch.id is null or (ch.owner_id is distinct from auth.uid() and not is_master(c)) then
    raise exception 'Personagem não autorizado';
  end if;

  insert into alvorecer_private.receipts(actor_id,request_id,operation,payload,result)
    values(auth.uid(),request_id,'buy_attribute_xp',payload,null)
    on conflict do nothing;

  if not found then
    select * into receipt
    from alvorecer_private.receipts r
    where r.actor_id=auth.uid()
      and r.request_id=buy_attribute_xp.request_id;

    if receipt.operation<>'buy_attribute_xp' or receipt.payload<>payload then
      raise exception 'Identificador reutilizado';
    end if;

    return receipt.result;
  end if;

  if not exists(
    select 1
    from attributes
    where id=attribute
      and campaign_id=c
      and active
      and character_id is null
  ) then
    raise exception 'Atributo indisponível para evolução';
  end if;

  rule:=character_progression(target);
  cost:=(rule->>'cost')::integer;
  cap_value:=(rule->>'cap')::integer;

  if xp_amount % cost <> 0 then
    raise exception 'O valor de XP deve ser múltiplo de %', cost;
  end if;

  points:=xp_amount / cost;
  if points <= 0 then
    raise exception 'Informe uma quantidade válida de XP';
  end if;

  select coalesce(value,0)
    into current_value
  from character_attributes
  where character_id=target
    and attribute_id=attribute;

  current_value:=coalesce(current_value,0);

  if current_value >= cap_value then
    raise exception 'Conclua a meta dos demais atributos antes de avançar';
  end if;

  if current_value + points > cap_value then
    raise exception 'O limite atual deste atributo é %. Você pode adicionar no máximo % ponto(s) agora',
      cap_value, cap_value-current_value;
  end if;

  if ch.xp < xp_amount then
    raise exception 'XP insuficiente';
  end if;

  update characters
  set xp=xp-xp_amount
  where id=target;

  insert into character_attributes(character_id,attribute_id,value)
    values(target,attribute,current_value+points)
    on conflict(character_id,attribute_id)
    do update set value=excluded.value;

  v_result:=character_progression(target);

  update characters
  set level=(v_result->>'level')::integer
  where id=target;

  v_result:=v_result||jsonb_build_object(
    'attribute_id',attribute,
    'before',current_value,
    'after',current_value+points,
    'points',points,
    'xp_spent',xp_amount
  );

  perform record_event(
    c,
    target,
    'attribute_purchase',
    jsonb_build_object(
      'attribute_id',attribute,
      'before',current_value,
      'after',current_value+points,
      'points',points,
      'xp_before',ch.xp,
      'xp_after',ch.xp-xp_amount,
      'xp_spent',xp_amount,
      'cost_per_point',cost,
      'level',(v_result->>'level')::integer
    )
  );

  update alvorecer_private.receipts r
  set result=v_result
  where r.actor_id=auth.uid()
    and r.request_id=buy_attribute_xp.request_id;

  return v_result;
end
$$;

revoke all on function public.buy_attribute_xp(uuid,uuid,uuid,integer,uuid)
  from public,anon;
grant execute on function public.buy_attribute_xp(uuid,uuid,uuid,integer,uuid)
  to authenticated,service_role;
