-- Prévia privada para avisar quais fichas usam uma opção antes da exclusão.
create function public.character_option_usage(
  c uuid, p_kind text, p_value text
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare usage jsonb;
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode consultar classes e raças';
  end if;
  if p_kind is null or p_kind not in ('class', 'race') or p_value is null then
    raise exception 'Classe ou raça inválida';
  end if;
  if not exists (select 1 from public.character_options o
    where o.campaign_id = c and o.option_kind = p_kind and o.option_value = p_value) then
    raise exception 'Classe ou raça não encontrada';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ch.id, 'name', ch.name, 'username', p.username,
    'archived', ch.archived
  ) order by ch.name, ch.id), '[]'::jsonb) into usage
  from public.characters ch
  left join public.profiles p on p.id = ch.owner_id
  where ch.campaign_id = c and
    ((p_kind = 'class' and ch.class = p_value)
      or (p_kind = 'race' and ch.race = p_value));
  return usage;
end
$$;

revoke all on function public.character_option_usage(uuid,text,text)
  from public, anon;
grant execute on function public.character_option_usage(uuid,text,text)
  to authenticated, service_role;

-- Remove apenas do catálogo. As fichas existentes mantêm seu texto atual.
create function public.delete_character_option(
  c uuid, p_kind text, p_value text, p_expected_character_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare current_ids uuid[];
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode remover classes e raças';
  end if;
  if p_kind is null or p_kind not in ('class', 'race') or p_value is null then
    raise exception 'Classe ou raça inválida';
  end if;

  -- O cadastro por convite usa o mesmo bloqueio da campanha.
  perform 1 from public.campaigns where id = c for update;
  if not found then raise exception 'Campanha inválida'; end if;

  if not exists (
    select 1 from public.character_options o
    where o.campaign_id = c and o.option_kind = p_kind and o.option_value = p_value
  ) then raise exception 'Classe ou raça não encontrada'; end if;

  if (select count(*) from public.character_options o
      where o.campaign_id = c and o.option_kind = p_kind) <= 1 then
    raise exception 'Mantenha pelo menos uma opção de classe e uma de raça';
  end if;

  -- Se alguém passou a usar a opção após a prévia, peça nova confirmação.
  select coalesce(array_agg(ch.id order by ch.id), '{}'::uuid[]) into current_ids
  from public.characters ch
  where ch.campaign_id = c and
    ((p_kind = 'class' and ch.class = p_value)
      or (p_kind = 'race' and ch.race = p_value));
  if p_expected_character_ids is null
    or current_ids <> (select coalesce(array_agg(id order by id), '{}'::uuid[])
      from unnest(p_expected_character_ids) id) then
    raise exception 'Os personagens que usam esta opção mudaram. Confira e confirme novamente';
  end if;

  delete from public.character_option_limits limits
  where limits.campaign_id = c and limits.option_kind = p_kind
    and limits.option_value = p_value;
  delete from public.character_options o
  where o.campaign_id = c and o.option_kind = p_kind and o.option_value = p_value;

  perform public.record_event(c, null, 'delete_character_option',
    jsonb_build_object('kind', p_kind, 'value', p_value));
end
$$;

revoke all on function public.delete_character_option(uuid,text,text,uuid[])
  from public, anon;
grant execute on function public.delete_character_option(uuid,text,text,uuid[])
  to authenticated, service_role;
