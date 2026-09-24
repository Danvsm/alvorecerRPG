create or replace function public.adjust_character_option_slot(
  c uuid,
  p_kind text,
  p_value text,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public, alvorecer_private
as $$
declare
  current_limit integer;
  current_used integer;
  next_limit integer;
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode alterar vagas';
  end if;

  if p_delta not in (-1, 1) then
    raise exception 'Ajuste de vaga inválido';
  end if;

  if not exists (
    select 1
    from alvorecer_private.character_option_catalog() catalog
    where catalog.option_kind = p_kind
      and catalog.option_value = p_value
  ) then
    raise exception 'Classe ou raça inválida';
  end if;

  perform 1 from public.campaigns where id = c for update;
  if not found then raise exception 'Campanha inválida'; end if;

  select coalesce((
    select limits.max_slots
    from public.character_option_limits limits
    where limits.campaign_id = c
      and limits.option_kind = p_kind
      and limits.option_value = p_value
  ), 1)
  into current_limit;

  if p_kind = 'class' then
    select count(*)::integer
    into current_used
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and ch.class = p_value;
  else
    select count(*)::integer
    into current_used
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and ch.race = p_value;
  end if;

  next_limit := current_limit + p_delta;

  if next_limit < 1 then
    raise exception 'Cada classe ou raça precisa ter pelo menos 1 vaga';
  end if;

  if next_limit < current_used then
    raise exception 'Não é possível diminuir abaixo das vagas já ocupadas';
  end if;

  if next_limit > 100 then
    raise exception 'O limite máximo é de 100 vagas';
  end if;

  if next_limit = 1 then
    delete from public.character_option_limits
    where campaign_id = c
      and option_kind = p_kind
      and option_value = p_value;
  else
    insert into public.character_option_limits(
      campaign_id,
      option_kind,
      option_value,
      max_slots,
      updated_by,
      updated_at
    )
    values(c, p_kind, p_value, next_limit, auth.uid(), now())
    on conflict (campaign_id, option_kind, option_value)
    do update set
      max_slots = excluded.max_slots,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;
  end if;

  return next_limit;
end
$$;

revoke all on function public.adjust_character_option_slot(uuid,text,text,integer) from public, anon;
grant execute on function public.adjust_character_option_slot(uuid,text,text,integer) to authenticated, service_role;
