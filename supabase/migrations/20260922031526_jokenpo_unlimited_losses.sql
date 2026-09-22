-- Jokenpo keeps the 100 Dracma rolling 24h winnings cap, but losses are unlimited.
create or replace function public.play_jokenpo(
  p_campaign_id uuid,
  p_character_id uuid,
  p_bet_cents bigint,
  p_player_choice text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_member public.campaign_members;
  wallet_character public.characters;
  existing_round public.jokenpo_rounds;
  wallet_label text;
  source_before bigint;
  source_after bigint;
  max_bet_cents bigint;
  daily_profit_cents bigint;
  tavern_choice text;
  round_outcome text;
  net_delta_cents bigint;
begin
  if actor_id is null then
    raise exception 'Faça login para apostar';
  end if;

  if p_request_id is null then
    raise exception 'Identificador da rodada obrigatório';
  end if;

  select * into actor_member
  from public.campaign_members member
  where member.campaign_id = p_campaign_id
    and member.user_id = actor_id
    and member.access_active
    and member.archived_at is null
  for update;

  if actor_member.user_id is null then
    raise exception 'Você não participa desta campanha';
  end if;

  select * into existing_round
  from public.jokenpo_rounds round
  where round.user_id = actor_id
    and round.request_id = p_request_id;

  if existing_round.id is not null then
    return jsonb_build_object(
      'round_id', existing_round.id,
      'tavern_choice', existing_round.tavern_choice,
      'outcome', existing_round.outcome,
      'bet_cents', existing_round.bet_cents,
      'net_delta_cents', existing_round.net_delta_cents,
      'balance_after', existing_round.balance_after,
      'max_bet_cents', least(
        5000,
        greatest(100, (existing_round.balance_after / 1000) * 100)
      )
    );
  end if;

  if p_player_choice not in ('pedra', 'papel', 'tesoura') then
    raise exception 'Jogada inválida';
  end if;

  if p_bet_cents is null or p_bet_cents < 100 or p_bet_cents % 100 <> 0 then
    raise exception 'A aposta mínima é 1 Dracma e deve ser um valor inteiro';
  end if;

  if actor_member.role = 'master' then
    if p_character_id is not null then
      raise exception 'A carteira do mestre não usa personagem';
    end if;
    source_before := actor_member.dracmas_cents;
    select coalesce(nullif(profile.display_name, ''), profile.username, 'Mestre')
      into wallet_label
    from public.profiles profile
    where profile.id = actor_id;
  else
    select * into wallet_character
    from public.characters character
    where character.id = p_character_id
      and character.campaign_id = p_campaign_id
      and character.owner_id = actor_id
      and not character.archived
    for update;

    if wallet_character.id is null then
      raise exception 'Escolha um personagem ativo para apostar';
    end if;
    source_before := wallet_character.dracmas_cents;
    wallet_label := wallet_character.name;
  end if;

  if source_before < 100 then
    raise exception 'Você precisa de pelo menos 1 Dracma para apostar';
  end if;

  max_bet_cents := least(5000, greatest(100, (source_before / 1000) * 100));
  if p_bet_cents > max_bet_cents then
    raise exception 'A aposta ultrapassa o limite desta carteira';
  end if;
  if p_bet_cents > source_before then
    raise exception 'Saldo insuficiente';
  end if;

  if exists (
    select 1
    from public.jokenpo_rounds round
    where round.user_id = actor_id
      and round.created_at > now() - interval '5 seconds'
  ) then
    raise exception 'Aguarde alguns segundos antes da próxima rodada';
  end if;

  select coalesce(sum(greatest(round.net_delta_cents, 0)), 0)
  into daily_profit_cents
  from public.jokenpo_rounds round
  where round.user_id = actor_id
    and round.campaign_id = p_campaign_id
    and round.created_at >= now() - interval '24 hours';

  if daily_profit_cents + floor(p_bet_cents * 0.8)::bigint > 10000 then
    raise exception 'Seu limite de ganhos das últimas 24 horas foi alcançado';
  end if;

  tavern_choice := (array['pedra', 'papel', 'tesoura'])[1 + floor(random() * 3)::integer];
  round_outcome := case
    when p_player_choice = tavern_choice then 'empate'
    when (p_player_choice = 'pedra' and tavern_choice = 'tesoura')
      or (p_player_choice = 'papel' and tavern_choice = 'pedra')
      or (p_player_choice = 'tesoura' and tavern_choice = 'papel') then 'vitoria'
    else 'derrota'
  end;

  net_delta_cents := case round_outcome
    when 'vitoria' then floor(p_bet_cents * 0.8)::bigint
    when 'derrota' then -p_bet_cents
    else 0
  end;
  source_after := source_before + net_delta_cents;

  if wallet_character.id is not null then
    update public.characters
    set dracmas_cents = source_after,
        money = floor(source_after / 100.0)::integer
    where id = wallet_character.id;
  else
    update public.campaign_members
    set dracmas_cents = source_after
    where campaign_id = p_campaign_id and user_id = actor_id;
  end if;

  if net_delta_cents < 0 then
    insert into public.dracma_transactions(
      campaign_id, kind, actor_id, from_user_id, from_character_id,
      from_label, amount_cents, reason, from_balance_after
    ) values (
      p_campaign_id, 'jokenpo_bet', actor_id, actor_id, wallet_character.id,
      wallet_label, -net_delta_cents, 'Aposta no Jokenpô', source_after
    );
  elsif net_delta_cents > 0 then
    insert into public.dracma_transactions(
      campaign_id, kind, actor_id, to_user_id, to_character_id,
      to_label, amount_cents, reason, to_balance_after
    ) values (
      p_campaign_id, 'jokenpo_prize', actor_id, actor_id, wallet_character.id,
      wallet_label, net_delta_cents, 'Prêmio do Jokenpô', source_after
    );
  end if;

  insert into public.jokenpo_rounds(
    campaign_id, user_id, character_id, request_id, bet_cents,
    player_choice, tavern_choice, outcome, net_delta_cents, balance_after
  ) values (
    p_campaign_id, actor_id, wallet_character.id, p_request_id, p_bet_cents,
    p_player_choice, tavern_choice, round_outcome, net_delta_cents, source_after
  ) returning * into existing_round;

  perform public.record_event(
    p_campaign_id,
    wallet_character.id,
    'jokenpo_round',
    jsonb_build_object(
      'bet_cents', p_bet_cents,
      'outcome', round_outcome,
      'net_delta_cents', net_delta_cents,
      'balance_after', source_after
    )
  );

  return jsonb_build_object(
    'round_id', existing_round.id,
    'tavern_choice', tavern_choice,
    'outcome', round_outcome,
    'bet_cents', p_bet_cents,
    'net_delta_cents', net_delta_cents,
    'balance_after', source_after,
    'max_bet_cents', least(5000, greatest(100, (source_after / 1000) * 100))
  );
end
$$;
