-- Expand character deletion preview so the UI can show what will be removed.
create or replace function public.lifecycle_preview(c uuid, entity text, target uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare result jsonb;
begin
  if not is_master(c) then raise exception 'Somente o mestre'; end if;
  case entity
    when 'character' then
      select jsonb_build_object(
        'name', ch.name,
        'active_combats', (select count(*) from combat_participants cp join combat_rooms cr on cr.id=cp.room_id where cp.character_id=ch.id and cr.active),
        'combat_entries', (select count(*) from combat_participants cp where cp.character_id=ch.id),
        'transactions', (select count(*) from dracma_transactions dt where dt.from_character_id=ch.id or dt.to_character_id=ch.id),
        'inventory', (select count(*) from character_items ci where ci.character_id=ch.id),
        'resources', (select count(*) from character_resources cr where cr.character_id=ch.id),
        'attribute_values', (select count(*) from character_attributes ca where ca.character_id=ch.id),
        'advantages', (select count(*) from character_advantages ca where ca.character_id=ch.id),
        'custom_attributes', (select count(*) from attributes a where a.character_id=ch.id)
      ) into result
      from characters ch where ch.id=target and ch.campaign_id=c;
    when 'creature' then
      select jsonb_build_object(
        'name',ct.name,
        'active_combats',(select count(*) from combat_participants cp join combat_rooms cr on cr.id=cp.room_id where cp.template_id=ct.id and cr.active),
        'historic_combats',(select count(*) from combat_participants cp join combat_rooms cr on cr.id=cp.room_id where cp.template_id=ct.id and not cr.active)
      ) into result from creature_templates ct where ct.id=target and ct.campaign_id=c;
    when 'item' then
      select jsonb_build_object('name',i.name,
        'inventories',(select count(*) from character_items ci where ci.item_id=i.id),
        'products',(select count(*) from shop_products sp where sp.item_id=i.id))
      into result from items i where i.id=target and i.campaign_id=c;
    when 'advantage' then
      select jsonb_build_object('name',a.name,
        'characters',(select count(*) from character_advantages ca where ca.advantage_id=a.id))
      into result from advantages a where a.id=target and a.campaign_id=c;
    when 'shop' then
      select jsonb_build_object('name',s.name,
        'products',(select count(*) from shop_products sp where sp.shop_id=s.id))
      into result from shops s where s.id=target and s.campaign_id=c;
    when 'product' then
      select jsonb_build_object('name',sp.name) into result
      from shop_products sp join shops s on s.id=sp.shop_id
      where sp.id=target and s.campaign_id=c;
    when 'attribute' then
      select jsonb_build_object('name',a.name,
        'values',(select count(*) from character_attributes ca where ca.attribute_id=a.id),
        'resources',(select count(*) from character_resources cr where cr.attribute_id=a.id),
        'campaign_rules',(select count(*) from resource_rules rr where rr.attribute_id=a.id))
      into result from attributes a where a.id=target and a.campaign_id=c;
    else raise exception 'Tipo inválido';
  end case;
  if result is null then raise exception 'Registro não encontrado'; end if;
  return result;
end
$function$;
