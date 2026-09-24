create table if not exists public.character_option_limits (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  option_kind text not null check (option_kind in ('class','race')),
  option_value text not null,
  max_slots integer not null check (max_slots between 1 and 100),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, option_kind, option_value)
);

alter table public.character_option_limits enable row level security;

revoke all on table public.character_option_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.character_option_limits to service_role;

create or replace function alvorecer_private.character_option_catalog()
returns table(option_kind text, option_value text, sort_order integer)
language sql
immutable
security invoker
set search_path = ''
as $$
  select 'class'::text, value, ord::integer
  from unnest(array[
    'Lutador',
    'Assassino',
    'Arqueiro-Guerreiro',
    'Suporte',
    'Cavaleiro Tank Celestial',
    'Arcano',
    'Necromante',
    'Druida',
    'Monge',
    'Cavaleiro/Guerreiro',
    'Bárbaro',
    'Bardo',
    'Bruxo/Pactuário'
  ]::text[]) with ordinality as options(value, ord)
  union all
  select 'race'::text, value, ord::integer
  from unnest(array[
    'Humanos',
    'Anões',
    'Elfos Cinzentos',
    'Elfos da Floresta',
    'Elfos Negros',
    'Selvagens',
    'Meio-Diabólicos',
    'Meio-Celestiais',
    'Titãs Elementais',
    'Nebulosos',
    'Meio-Gigantes',
    'Tieflings',
    'Halflings'
  ]::text[]) with ordinality as options(value, ord);
$$;

revoke all on function alvorecer_private.character_option_catalog() from public, anon, authenticated;
grant execute on function alvorecer_private.character_option_catalog() to service_role;

create or replace function public.master_character_option_slots(c uuid)
returns table(
  option_kind text,
  option_value text,
  max_slots integer,
  used_slots integer,
  remaining_slots integer
)
language plpgsql
stable
security definer
set search_path = public, alvorecer_private
as $$
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode alterar vagas';
  end if;

  return query
  with usage as (
    select 'class'::text as kind, ch.class as value, count(*)::integer as used
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and coalesce(ch.class, '') <> ''
    group by ch.class
    union all
    select 'race'::text, ch.race, count(*)::integer
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and coalesce(ch.race, '') <> ''
    group by ch.race
  )
  select
    catalog.option_kind,
    catalog.option_value,
    coalesce(limits.max_slots, 1)::integer,
    coalesce(usage.used, 0)::integer,
    greatest(coalesce(limits.max_slots, 1) - coalesce(usage.used, 0), 0)::integer
  from alvorecer_private.character_option_catalog() catalog
  left join public.character_option_limits limits
    on limits.campaign_id = c
   and limits.option_kind = catalog.option_kind
   and limits.option_value = catalog.option_value
  left join usage
    on usage.kind = catalog.option_kind
   and usage.value = catalog.option_value
  order by
    case catalog.option_kind when 'class' then 0 else 1 end,
    catalog.sort_order;
end
$$;

revoke all on function public.master_character_option_slots(uuid) from public, anon;
grant execute on function public.master_character_option_slots(uuid) to authenticated, service_role;

create or replace function public.increase_character_option_slot(
  c uuid,
  p_kind text,
  p_value text
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
    select count(*)::integer into current_used
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and ch.class = p_value;
  else
    select count(*)::integer into current_used
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and ch.race = p_value;
  end if;

  next_limit := greatest(current_limit, current_used) + 1;

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

  return next_limit;
end
$$;

revoke all on function public.increase_character_option_slot(uuid,text,text) from public, anon;
grant execute on function public.increase_character_option_slot(uuid,text,text) to authenticated, service_role;

create or replace function public.invite_character_options(h text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, alvorecer_private
as $$
declare
  c uuid;
  result jsonb;
begin
  select invite.campaign_id
  into c
  from public.invites invite
  where invite.token_hash = h
    and not invite.cancelled
    and invite.used_by is null
    and invite.expires_at > now()
    and invite.claim_id is null
  limit 1;

  if c is null then
    raise exception 'Convite inválido, expirado ou em uso';
  end if;

  with usage as (
    select 'class'::text as kind, ch.class as value, count(*)::integer as used
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and coalesce(ch.class, '') <> ''
    group by ch.class
    union all
    select 'race'::text, ch.race, count(*)::integer
    from public.characters ch
    where ch.campaign_id = c
      and ch.owner_id is not null
      and coalesce(ch.race, '') <> ''
    group by ch.race
  ),
  slots as (
    select
      catalog.option_kind,
      catalog.option_value,
      catalog.sort_order,
      coalesce(limits.max_slots, 1)::integer as max_slots,
      coalesce(usage.used, 0)::integer as used_slots,
      greatest(coalesce(limits.max_slots, 1) - coalesce(usage.used, 0), 0)::integer as remaining_slots
    from alvorecer_private.character_option_catalog() catalog
    left join public.character_option_limits limits
      on limits.campaign_id = c
     and limits.option_kind = catalog.option_kind
     and limits.option_value = catalog.option_value
    left join usage
      on usage.kind = catalog.option_kind
     and usage.value = catalog.option_value
  )
  select jsonb_build_object(
    'classes',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'value', option_value,
            'max_slots', max_slots,
            'used_slots', used_slots,
            'remaining_slots', remaining_slots,
            'available', remaining_slots > 0
          )
          order by sort_order
        )
        from slots
        where option_kind = 'class'
      ), '[]'::jsonb),
    'races',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'value', option_value,
            'max_slots', max_slots,
            'used_slots', used_slots,
            'remaining_slots', remaining_slots,
            'available', remaining_slots > 0
          )
          order by sort_order
        )
        from slots
        where option_kind = 'race'
      ), '[]'::jsonb)
  )
  into result;

  return result;
end
$$;

revoke all on function public.invite_character_options(text) from public, anon, authenticated;
grant execute on function public.invite_character_options(text) to service_role;

create or replace function public.provision_player(
  c uuid,
  u uuid,
  uname text,
  identity text,
  cipher text,
  d jsonb,
  claim uuid default null::uuid,
  actor uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'alvorecer_private'
as $$
declare
  ch uuid;
  k text;
  aid uuid;
  initial_cents bigint;
  birthday date;
  class_name text;
  race_name text;
  class_limit integer;
  race_limit integer;
  class_used integer;
  race_used integer;
begin
  if claim is not null then
    perform 1
    from public.invites
    where campaign_id = c
      and claim_id = claim
      and not cancelled
      and used_by is null
      and expires_at > now()
    for update;
    if not found then raise exception 'Convite inválido'; end if;
  end if;

  class_name := coalesce(d->>'class', '');
  race_name := coalesce(d->>'race', '');

  if not exists (
    select 1
    from alvorecer_private.character_option_catalog() catalog
    where catalog.option_kind = 'class'
      and catalog.option_value = class_name
  ) then
    raise exception 'Classe inválida';
  end if;

  if not exists (
    select 1
    from alvorecer_private.character_option_catalog() catalog
    where catalog.option_kind = 'race'
      and catalog.option_value = race_name
  ) then
    raise exception 'Raça inválida';
  end if;

  perform 1 from public.campaigns where id = c for update;
  if not found then raise exception 'Campanha inválida'; end if;

  select coalesce((
    select limits.max_slots
    from public.character_option_limits limits
    where limits.campaign_id = c
      and limits.option_kind = 'class'
      and limits.option_value = class_name
  ), 1)
  into class_limit;

  select count(*)::integer
  into class_used
  from public.characters existing
  where existing.campaign_id = c
    and existing.owner_id is not null
    and existing.class = class_name;

  if class_used >= class_limit then
    raise exception 'Não há mais vagas para a classe %', class_name;
  end if;

  select coalesce((
    select limits.max_slots
    from public.character_option_limits limits
    where limits.campaign_id = c
      and limits.option_kind = 'race'
      and limits.option_value = race_name
  ), 1)
  into race_limit;

  select count(*)::integer
  into race_used
  from public.characters existing
  where existing.campaign_id = c
    and existing.owner_id is not null
    and existing.race = race_name;

  if race_used >= race_limit then
    raise exception 'Não há mais vagas para a raça %', race_name;
  end if;

  initial_cents := case
    when d ? 'dracmas_cents' then coalesce((d->>'dracmas_cents')::bigint, 0)
    else coalesce((d->>'money')::bigint, 0) * 100
  end;
  if initial_cents < 0 then raise exception 'Saldo inválido'; end if;

  birthday := nullif(d->'person'->>'birth_date', '')::date;

  insert into public.profiles(
    id, username, display_name, full_name, personal_email, birth_date
  )
  values(
    u,
    uname,
    uname,
    left(coalesce(d->'person'->>'full_name', ''), 160),
    lower(left(coalesce(d->'person'->>'email', ''), 254)),
    birthday
  );

  insert into public.credential_vault(user_id, identity, ciphertext)
  values(u, identity, cipher);

  insert into public.campaign_members(campaign_id, user_id, role)
  values(c, u, 'player');

  insert into public.characters(
    campaign_id,
    owner_id,
    name,
    class,
    race,
    xp,
    xp_total,
    level,
    money,
    dracmas_cents,
    information
  )
  values(
    c,
    u,
    coalesce(nullif(d->>'name', ''), uname),
    class_name,
    race_name,
    coalesce((d->>'xp')::integer, 0),
    coalesce((d->>'xp')::integer, 0),
    greatest(coalesce((d->>'level')::integer, 1), 1),
    floor(initial_cents / 100.0)::integer,
    initial_cents,
    coalesce(d->'information', '{}')
  )
  returning id into ch;

  for aid in
    select id from public.attributes where campaign_id = c and character_id is null
  loop
    insert into public.character_attributes(character_id, attribute_id, value)
    values(ch, aid, coalesce((d->'attributes'->>aid::text)::integer, 0));
  end loop;

  for k in select unnest(array['life','mana','stamina'])
  loop
    insert into public.character_resources(character_id, key, current, maximum)
    values(
      ch,
      k,
      coalesce((d->>(k||'_current'))::integer, (d->>k)::integer, 0),
      coalesce((d->>k)::integer, 0)
    );
  end loop;

  if claim is not null then
    update public.invites set used_by = u where claim_id = claim;
  end if;

  perform public.record_event(
    c,
    ch,
    'create_player',
    jsonb_build_object('username', uname),
    coalesce(actor, u)
  );

  return ch;
end
$$;

revoke all on function public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid) from public, anon;
grant execute on function public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid) to authenticated, service_role;
