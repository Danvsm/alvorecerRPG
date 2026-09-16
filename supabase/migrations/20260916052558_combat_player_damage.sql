create function public.combat_damage(c uuid, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := (select auth.uid());
  actor_role text;
  target_id uuid;
  target combat_participants;
  life_resource character_resources;
  amount_value numeric;
  amount integer;
  before_value integer;
  after_value integer;
begin
  if actor is null or not is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select role into actor_role
  from campaign_members
  where campaign_id = c and user_id = actor;

  if actor_role is distinct from 'player' then
    raise exception 'Ação disponível apenas para jogadores';
  end if;

  begin
    target_id := nullif(d->>'participant_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'Inimigo inválido';
  end;

  if target_id is null then
    raise exception 'Inimigo inválido';
  end if;

  if not (d ? 'amount') or jsonb_typeof(d->'amount') <> 'number' then
    raise exception 'Informe uma quantidade inteira maior que zero';
  end if;

  amount_value := (d->>'amount')::numeric;
  if amount_value <> trunc(amount_value)
     or amount_value < 1
     or amount_value > 100000 then
    raise exception 'Informe uma quantidade inteira entre 1 e 100000';
  end if;
  amount := amount_value::integer;

  select cp.* into target
  from combat_participants cp
  join combat_rooms room on room.id = cp.room_id
  where cp.id = target_id
    and room.campaign_id = c
    and room.active
  for update of cp;

  if target.id is null or target.side <> 'enemy' then
    raise exception 'Inimigo indisponível';
  end if;

  if not exists(
    select 1
    from combat_participants ally
    join characters ch on ch.id = ally.character_id
    where ally.room_id = target.room_id
      and ally.side = 'ally'
      and ch.campaign_id = c
      and ch.owner_id = actor
      and not ch.archived
  ) then
    raise exception 'Seu personagem não participa deste combate';
  end if;

  if target.character_id is not null then
    select resource.* into life_resource
    from character_resources resource
    join characters ch on ch.id = resource.character_id
    where resource.character_id = target.character_id
      and resource.key = 'life'
      and ch.campaign_id = c
      and not ch.archived
    for update of resource;

    if life_resource.character_id is null then
      raise exception 'Vida do inimigo indisponível';
    end if;

    before_value := life_resource.current;
    if before_value = 0 then
      raise exception 'Este inimigo já está sem vida';
    end if;
    after_value := greatest(0, before_value - amount);
    update character_resources
    set current = after_value
    where character_id = target.character_id and key = 'life';
  else
    before_value := target.life;
    if before_value = 0 then
      raise exception 'Este inimigo já está sem vida';
    end if;
    after_value := greatest(0, before_value - amount);
    update combat_participants
    set life = after_value
    where id = target.id;
  end if;

  perform record_event(
    c,
    target.character_id,
    'combat_damage',
    jsonb_build_object(
      'participant_id', target.id,
      'requested_damage', amount,
      'before', before_value,
      'after', after_value,
      'delta', after_value - before_value
    )
  );

  return jsonb_build_object(
    'participant_id', target.id,
    'accepted', true
  );
end
$$;

revoke all on function public.combat_damage(uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.combat_damage(uuid, jsonb)
to authenticated, service_role;
