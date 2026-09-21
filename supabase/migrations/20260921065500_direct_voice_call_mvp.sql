
create table if not exists public.direct_calls(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  caller_id uuid not null references public.social_identities(id),
  callee_id uuid not null references public.social_identities(id),
  status text not null default 'ringing'
    check(status in ('ringing','active','ended','declined','cancelled','missed','failed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references public.social_identities(id),
  failure_reason text,
  check(caller_id<>callee_id)
);

create index if not exists direct_calls_campaign_status_idx
  on public.direct_calls(campaign_id,status,created_at desc);
create index if not exists direct_calls_conversation_date_idx
  on public.direct_calls(conversation_id,created_at desc);
create index if not exists direct_calls_caller_open_idx
  on public.direct_calls(caller_id,created_at desc)
  where status in ('ringing','active');
create index if not exists direct_calls_callee_open_idx
  on public.direct_calls(callee_id,created_at desc)
  where status in ('ringing','active');

create table if not exists public.direct_call_signals(
  id bigint generated always as identity primary key,
  call_id uuid not null references public.direct_calls(id) on delete cascade,
  sender_id uuid not null references public.social_identities(id),
  kind text not null check(kind in ('offer','answer','ice')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists direct_call_signals_call_idx
  on public.direct_call_signals(call_id,id);

create or replace function public.can_access_direct_call(target uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.direct_calls call
    join public.social_identities caller on caller.id=call.caller_id
    join public.social_identities callee on callee.id=call.callee_id
    where call.id=target
      and public.is_member(call.campaign_id)
      and (
        caller.user_id=(select auth.uid())
        or callee.user_id=(select auth.uid())
        or (
          public.is_master(call.campaign_id)
          and (caller.kind='npc' or callee.kind='npc')
        )
      )
  )
$$;

revoke all on function public.can_access_direct_call(uuid)
  from public,anon;
grant execute on function public.can_access_direct_call(uuid)
  to authenticated,service_role;

alter table public.direct_calls enable row level security;
alter table public.direct_call_signals enable row level security;

revoke all on public.direct_calls from anon,authenticated;
revoke all on public.direct_call_signals from anon,authenticated;
grant select on public.direct_calls to authenticated;
grant select on public.direct_call_signals to authenticated;
grant all on public.direct_calls to service_role;
grant all on public.direct_call_signals to service_role;

drop policy if exists direct_calls_read on public.direct_calls;
create policy direct_calls_read
on public.direct_calls
for select
to authenticated
using(public.can_access_direct_call(id));

drop policy if exists direct_call_signals_read on public.direct_call_signals;
create policy direct_call_signals_read
on public.direct_call_signals
for select
to authenticated
using(public.can_access_direct_call(call_id));

create or replace function alvorecer_private.require_call_actor(
  c uuid,
  requested_actor uuid
)
returns public.social_identities
language plpgsql
stable
security definer
set search_path=public
as $$
declare actor public.social_identities;
begin
  if not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select identity.* into actor
  from public.social_identities identity
  where identity.id=requested_actor
    and identity.campaign_id=c
    and identity.active;

  if actor.id is null
     or (
       actor.user_id is distinct from (select auth.uid())
       and not (actor.kind='npc' and public.is_master(c))
     ) then
    raise exception 'Identidade não autorizada';
  end if;

  return actor;
end
$$;

revoke all on function alvorecer_private.require_call_actor(uuid,uuid)
  from public,anon,authenticated;

create or replace function public.direct_call_start(
  c uuid,
  actor_id uuid,
  conversation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  conversation public.direct_conversations;
  recipient public.social_identities;
  call_row public.direct_calls;
begin
  actor:=alvorecer_private.require_call_actor(c,actor_id);

  select direct_conversation.* into conversation
  from public.direct_conversations direct_conversation
  where direct_conversation.id=conversation_id
    and direct_conversation.campaign_id=c;

  if conversation.id is null
     or actor.id not in(conversation.first_id,conversation.second_id) then
    raise exception 'Conversa não autorizada';
  end if;

  select identity.* into recipient
  from public.social_identities identity
  where identity.id=case
    when conversation.first_id=actor.id then conversation.second_id
    else conversation.first_id
  end
    and identity.campaign_id=c
    and identity.active;

  if recipient.id is null then
    raise exception 'Destinatário indisponível';
  end if;
  if recipient.user_id is null then
    raise exception 'Este perfil não pode receber chamadas';
  end if;

  perform pg_advisory_xact_lock(hashtext(c::text));

  update public.direct_calls
  set status='missed',
      ended_at=coalesce(ended_at,now())
  where campaign_id=c
    and status='ringing'
    and created_at<now()-interval '60 seconds';

  if exists(
    select 1
    from public.direct_calls existing
    where existing.campaign_id=c
      and existing.status in ('ringing','active')
      and (
        actor.id in(existing.caller_id,existing.callee_id)
        or recipient.id in(existing.caller_id,existing.callee_id)
      )
  ) then
    raise exception 'Já existe uma chamada em andamento';
  end if;

  insert into public.direct_calls(
    campaign_id,conversation_id,caller_id,callee_id
  )
  values(c,conversation.id,actor.id,recipient.id)
  returning * into call_row;

  return to_jsonb(call_row);
end
$$;

revoke all on function public.direct_call_start(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.direct_call_start(uuid,uuid,uuid)
  to authenticated;

create or replace function public.direct_call_action(
  c uuid,
  actor_id uuid,
  call_id uuid,
  op text,
  detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  call_row public.direct_calls;
  terminal boolean:=false;
begin
  actor:=alvorecer_private.require_call_actor(c,actor_id);

  select call.* into call_row
  from public.direct_calls call
  where call.id=call_id
    and call.campaign_id=c
  for update;

  if call_row.id is null
     or actor.id not in(call_row.caller_id,call_row.callee_id) then
    raise exception 'Chamada indisponível';
  end if;

  if op='accept' then
    if actor.id<>call_row.callee_id or call_row.status<>'ringing' then
      raise exception 'Chamada não pode ser atendida';
    end if;
    update public.direct_calls
    set status='active',
        answered_at=coalesce(answered_at,now())
    where id=call_row.id
    returning * into call_row;

  elsif op='decline' then
    if actor.id<>call_row.callee_id or call_row.status<>'ringing' then
      raise exception 'Chamada não pode ser recusada';
    end if;
    update public.direct_calls
    set status='declined',
        ended_at=now(),
        ended_by=actor.id
    where id=call_row.id
    returning * into call_row;
    terminal:=true;

  elsif op='cancel' then
    if actor.id<>call_row.caller_id or call_row.status<>'ringing' then
      raise exception 'Chamada não pode ser cancelada';
    end if;
    update public.direct_calls
    set status='cancelled',
        ended_at=now(),
        ended_by=actor.id
    where id=call_row.id
    returning * into call_row;
    terminal:=true;

  elsif op='timeout' then
    if actor.id<>call_row.caller_id
       or call_row.status<>'ringing'
       or call_row.created_at>now()-interval '40 seconds' then
      raise exception 'Chamada ainda não expirou';
    end if;
    update public.direct_calls
    set status='missed',
        ended_at=now(),
        ended_by=actor.id
    where id=call_row.id
    returning * into call_row;
    terminal:=true;

  elsif op='end' then
    if call_row.status='active' then
      update public.direct_calls
      set status='ended',
          ended_at=now(),
          ended_by=actor.id
      where id=call_row.id
      returning * into call_row;
      terminal:=true;
    elsif call_row.status='ringing' and actor.id=call_row.caller_id then
      update public.direct_calls
      set status='cancelled',
          ended_at=now(),
          ended_by=actor.id
      where id=call_row.id
      returning * into call_row;
      terminal:=true;
    elsif call_row.status='ringing' and actor.id=call_row.callee_id then
      update public.direct_calls
      set status='declined',
          ended_at=now(),
          ended_by=actor.id
      where id=call_row.id
      returning * into call_row;
      terminal:=true;
    else
      return to_jsonb(call_row);
    end if;

  elsif op='fail' then
    if call_row.status not in ('ringing','active') then
      return to_jsonb(call_row);
    end if;
    update public.direct_calls
    set status='failed',
        ended_at=now(),
        ended_by=actor.id,
        failure_reason=left(coalesce(nullif(trim(detail),''),'Falha na conexão'),200)
    where id=call_row.id
    returning * into call_row;
    terminal:=true;

  else
    raise exception 'Ação de chamada inválida';
  end if;

  if terminal then
    delete from public.direct_call_signals
    where direct_call_signals.call_id=call_row.id;
  end if;

  return to_jsonb(call_row);
end
$$;

revoke all on function public.direct_call_action(uuid,uuid,uuid,text,text)
  from public,anon;
grant execute on function public.direct_call_action(uuid,uuid,uuid,text,text)
  to authenticated;

create or replace function public.direct_call_signal(
  c uuid,
  actor_id uuid,
  call_id uuid,
  signal_kind text,
  signal_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  call_row public.direct_calls;
  signal_id bigint;
begin
  actor:=alvorecer_private.require_call_actor(c,actor_id);

  select call.* into call_row
  from public.direct_calls call
  where call.id=call_id
    and call.campaign_id=c;

  if call_row.id is null
     or actor.id not in(call_row.caller_id,call_row.callee_id)
     or call_row.status<>'active' then
    raise exception 'Chamada indisponível';
  end if;

  if signal_kind not in ('offer','answer','ice')
     or jsonb_typeof(signal_payload)<>'object'
     or octet_length(signal_payload::text)>20000 then
    raise exception 'Sinal de chamada inválido';
  end if;

  if signal_kind='offer' and actor.id<>call_row.caller_id then
    raise exception 'Oferta de chamada inválida';
  end if;
  if signal_kind='answer' and actor.id<>call_row.callee_id then
    raise exception 'Resposta de chamada inválida';
  end if;

  insert into public.direct_call_signals(call_id,sender_id,kind,payload)
  values(call_row.id,actor.id,signal_kind,signal_payload)
  returning id into signal_id;

  return signal_id;
end
$$;

revoke all on function public.direct_call_signal(uuid,uuid,uuid,text,jsonb)
  from public,anon;
grant execute on function public.direct_call_signal(uuid,uuid,uuid,text,jsonb)
  to authenticated;

alter table public.direct_calls replica identity full;
alter table public.direct_call_signals replica identity full;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='direct_calls'
  ) then
    alter publication supabase_realtime add table public.direct_calls;
  end if;

  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='direct_call_signals'
  ) then
    alter publication supabase_realtime add table public.direct_call_signals;
  end if;
end
$$;
