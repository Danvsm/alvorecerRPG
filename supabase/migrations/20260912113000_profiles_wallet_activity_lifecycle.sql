-- Compact UX support: private profile data, progression, wallet operations,
-- player activity, session feedback, and dependency-aware lifecycle actions.

alter table public.profiles
  add column if not exists full_name text not null default '',
  add column if not exists personal_email text not null default '',
  add column if not exists birth_date date;

alter table public.campaign_members
  add column if not exists access_active boolean not null default true,
  add column if not exists disabled_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.characters
  add column if not exists xp_total integer not null default 0 check (xp_total >= 0),
  add column if not exists level integer not null default 1 check (level > 0),
  add column if not exists archived_at timestamptz;

update public.characters set xp_total = greatest(xp_total, xp);
update public.characters set archived_at = now() where archived and archived_at is null;

alter table public.advantages add column if not exists archived_at timestamptz;
alter table public.items add column if not exists archived_at timestamptz;
alter table public.attributes add column if not exists archived_at timestamptz;
alter table public.creature_templates add column if not exists archived_at timestamptz;
alter table public.shops add column if not exists archived_at timestamptz;
alter table public.shop_products add column if not exists archived_at timestamptz;
alter table public.combat_rooms
  add column if not exists ended_at timestamptz,
  add column if not exists archived_at timestamptz;
alter table public.invites add column if not exists archived_at timestamptz;

alter table public.audit_logs
  add column if not exists actor_label text,
  add column if not exists character_label text;

update public.audit_logs l
set actor_label = coalesce(nullif(p.display_name, ''), p.username)
from public.profiles p
where p.id = l.actor_id and l.actor_label is null;

update public.audit_logs l
set character_label = ch.name
from public.characters ch
where ch.id = l.character_id and l.character_label is null;

-- Preserve historical rows when accounts, characters, or templates are removed.
alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;
alter table public.audit_logs
  add constraint audit_logs_actor_id_fkey foreign key (actor_id)
  references public.profiles(id) on delete set null;
alter table public.audit_logs drop constraint if exists audit_logs_character_id_fkey;
alter table public.audit_logs
  add constraint audit_logs_character_id_fkey foreign key (character_id)
  references public.characters(id) on delete set null;

alter table public.characters drop constraint if exists characters_owner_id_fkey;
alter table public.characters
  add constraint characters_owner_id_fkey foreign key (owner_id)
  references public.profiles(id) on delete set null;

alter table public.combat_participants drop constraint if exists combat_participants_character_id_fkey;
alter table public.combat_participants
  add constraint combat_participants_character_id_fkey foreign key (character_id)
  references public.characters(id) on delete set null;
alter table public.combat_participants drop constraint if exists combat_participants_template_id_fkey;
alter table public.combat_participants
  add constraint combat_participants_template_id_fkey foreign key (template_id)
  references public.creature_templates(id) on delete set null;

alter table public.character_items drop constraint if exists character_items_character_id_fkey;
alter table public.character_items
  add constraint character_items_character_id_fkey foreign key (character_id)
  references public.characters(id) on delete cascade;
alter table public.item_effects drop constraint if exists item_effects_item_id_fkey;
alter table public.item_effects
  add constraint item_effects_item_id_fkey foreign key (item_id)
  references public.items(id) on delete cascade;
alter table public.attributes drop constraint if exists attributes_character_id_fkey;
alter table public.attributes
  add constraint attributes_character_id_fkey foreign key (character_id)
  references public.characters(id) on delete cascade;

alter table public.campaign_avatars drop constraint if exists campaign_avatars_created_by_fkey;
alter table public.campaign_avatars
  add constraint campaign_avatars_created_by_fkey foreign key (created_by)
  references public.profiles(id) on delete set null;
alter table public.invites drop constraint if exists invites_used_by_fkey;
alter table public.invites
  add constraint invites_used_by_fkey foreign key (used_by)
  references public.profiles(id) on delete set null;

alter table public.dracma_transactions
  add column if not exists from_username text,
  add column if not exists to_username text,
  add column if not exists audit_log_id bigint references public.audit_logs(id) on delete set null,
  add column if not exists original_transaction_id uuid references public.dracma_transactions(id),
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reversal_transaction_id uuid references public.dracma_transactions(id);

alter table public.dracma_transactions alter column actor_id drop not null;
alter table public.dracma_transactions drop constraint if exists dracma_transactions_kind_check;
alter table public.dracma_transactions
  add constraint dracma_transactions_kind_check
  check (kind in ('transfer','admin_adjustment','purchase','charge_payment','reward','reversal'));

alter table public.dracma_transactions drop constraint if exists dracma_transactions_actor_id_fkey;
alter table public.dracma_transactions
  add constraint dracma_transactions_actor_id_fkey foreign key (actor_id)
  references public.profiles(id) on delete set null;
alter table public.dracma_transactions drop constraint if exists dracma_transactions_from_user_id_fkey;
alter table public.dracma_transactions
  add constraint dracma_transactions_from_user_id_fkey foreign key (from_user_id)
  references public.profiles(id) on delete set null;
alter table public.dracma_transactions drop constraint if exists dracma_transactions_to_user_id_fkey;
alter table public.dracma_transactions
  add constraint dracma_transactions_to_user_id_fkey foreign key (to_user_id)
  references public.profiles(id) on delete set null;
alter table public.dracma_transactions drop constraint if exists dracma_transactions_from_character_id_fkey;
alter table public.dracma_transactions
  add constraint dracma_transactions_from_character_id_fkey foreign key (from_character_id)
  references public.characters(id) on delete set null;
alter table public.dracma_transactions drop constraint if exists dracma_transactions_to_character_id_fkey;
alter table public.dracma_transactions
  add constraint dracma_transactions_to_character_id_fkey foreign key (to_character_id)
  references public.characters(id) on delete set null;

create unique index if not exists dracma_transactions_audit_log_uidx
  on public.dracma_transactions(audit_log_id) where audit_log_id is not null;
create index if not exists dracma_transactions_original_idx
  on public.dracma_transactions(original_transaction_id);

create table if not exists public.dracma_charges(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  requester_user_id uuid references public.profiles(id) on delete set null,
  requester_character_id uuid references public.characters(id) on delete set null,
  requester_label text not null,
  requester_username text,
  target_user_id uuid references public.profiles(id) on delete set null,
  target_character_id uuid references public.characters(id) on delete set null,
  target_label text not null,
  target_username text,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null default '',
  status text not null default 'pending'
    check (status in ('pending','paid','refused','cancelled')),
  transaction_id uuid references public.dracma_transactions(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  archived_at timestamptz
);

create index if not exists dracma_charges_campaign_created_idx
  on public.dracma_charges(campaign_id, created_at desc);
create index if not exists dracma_charges_requester_user_idx
  on public.dracma_charges(requester_user_id);
create index if not exists dracma_charges_target_user_idx
  on public.dracma_charges(target_user_id);
create index if not exists dracma_charges_requester_character_idx
  on public.dracma_charges(requester_character_id);
create index if not exists dracma_charges_target_character_idx
  on public.dracma_charges(target_character_id);
create index if not exists dracma_charges_transaction_idx
  on public.dracma_charges(transaction_id);

create table if not exists public.activity_sessions(
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  user_id uuid references public.profiles(id) on delete set null,
  username_snapshot text not null,
  started_at timestamptz not null default now(),
  last_interaction_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  ended_at timestamptz,
  active_seconds bigint not null default 0 check (active_seconds >= 0)
);

create index if not exists activity_sessions_campaign_started_idx
  on public.activity_sessions(campaign_id, started_at desc);
create index if not exists activity_sessions_user_started_idx
  on public.activity_sessions(user_id, started_at desc);

create table if not exists public.session_feedback(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  user_id uuid references public.profiles(id) on delete set null,
  username_snapshot text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1200),
  feedback_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, user_id, feedback_date)
);

create index if not exists session_feedback_campaign_date_idx
  on public.session_feedback(campaign_id, feedback_date desc);
create index if not exists session_feedback_user_idx
  on public.session_feedback(user_id);

alter table public.dracma_charges enable row level security;
alter table public.activity_sessions enable row level security;
alter table public.session_feedback enable row level security;

revoke all on public.dracma_charges, public.activity_sessions, public.session_feedback
  from anon, authenticated;
grant select on public.dracma_charges, public.activity_sessions, public.session_feedback
  to authenticated;
grant all on public.dracma_charges, public.activity_sessions, public.session_feedback
  to service_role;

drop policy if exists dracma_charges_read on public.dracma_charges;
create policy dracma_charges_read on public.dracma_charges
for select to authenticated using (
  public.is_master(campaign_id)
  or requester_user_id = (select auth.uid())
  or target_user_id = (select auth.uid())
);

drop policy if exists activity_sessions_read on public.activity_sessions;
create policy activity_sessions_read on public.activity_sessions
for select to authenticated using (
  public.is_master(campaign_id) or user_id = (select auth.uid())
);

drop policy if exists session_feedback_read on public.session_feedback;
create policy session_feedback_read on public.session_feedback
for select to authenticated using (
  public.is_master(campaign_id) or user_id = (select auth.uid())
);

create or replace function public.is_master(c uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from campaign_members
    where campaign_id=c and user_id=(select auth.uid()) and role='master'
      and access_active and archived_at is null
  )
$$;

create or replace function public.is_member(c uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from campaign_members
    where campaign_id=c and user_id=(select auth.uid())
      and access_active and archived_at is null
  )
$$;

create or replace function public.can_character(c uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from characters
    where id=c and (
      is_master(campaign_id)
      or (owner_id=(select auth.uid()) and is_member(campaign_id) and not archived)
    )
  )
$$;

create or replace function public.maintain_xp_total()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op = 'INSERT' then
    new.xp_total := greatest(coalesce(new.xp_total, 0), new.xp);
  elsif new.xp > old.xp then
    new.xp_total := greatest(coalesce(new.xp_total, 0), old.xp_total + (new.xp - old.xp));
  else
    new.xp_total := greatest(coalesce(new.xp_total, 0), old.xp_total);
  end if;
  return new;
end$$;

drop trigger if exists maintain_xp_total_trigger on public.characters;
create trigger maintain_xp_total_trigger
before insert or update of xp on public.characters
for each row execute function public.maintain_xp_total();

-- Account provisioning keeps the technical Auth identity separate from the
-- person's private contact data. The e-mail below is never used as login.
create or replace function public.provision_player(
  c uuid,
  u uuid,
  uname text,
  identity text,
  cipher text,
  d jsonb,
  claim uuid default null,
  actor uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare ch uuid; k text; aid uuid; initial_cents bigint; birthday date;
begin
  if claim is not null then
    perform 1 from invites
    where campaign_id=c and claim_id=claim and not cancelled
      and used_by is null and expires_at>now() for update;
    if not found then raise exception 'Convite inválido'; end if;
  end if;
  initial_cents:=case when d?'dracmas_cents'
    then coalesce((d->>'dracmas_cents')::bigint,0)
    else coalesce((d->>'money')::bigint,0)*100 end;
  if initial_cents<0 then raise exception 'Saldo inválido'; end if;
  birthday:=nullif(d->'person'->>'birth_date','')::date;
  insert into profiles(
    id,username,display_name,full_name,personal_email,birth_date
  ) values(
    u,uname,uname,left(coalesce(d->'person'->>'full_name',''),160),
    lower(left(coalesce(d->'person'->>'email',''),254)),birthday
  );
  insert into credential_vault(user_id,identity,ciphertext) values(u,identity,cipher);
  insert into campaign_members(campaign_id,user_id,role) values(c,u,'player');
  insert into characters(
    campaign_id,owner_id,name,class,race,xp,xp_total,level,money,dracmas_cents,information
  ) values(
    c,u,coalesce(nullif(d->>'name',''),uname),coalesce(d->>'class',''),
    coalesce(d->>'race',''),coalesce((d->>'xp')::integer,0),
    coalesce((d->>'xp')::integer,0),greatest(coalesce((d->>'level')::integer,1),1),
    floor(initial_cents/100.0)::integer,initial_cents,coalesce(d->'information','{}')
  ) returning id into ch;
  for aid in select id from attributes where campaign_id=c and character_id is null loop
    insert into character_attributes(character_id,attribute_id,value)
    values(ch,aid,coalesce((d->'attributes'->>aid::text)::integer,0));
  end loop;
  for k in select unnest(array['life','mana','stamina']) loop
    insert into character_resources(character_id,key,current,maximum)
    values(ch,k,coalesce((d->>(k||'_current'))::integer,(d->>k)::integer,0),
      coalesce((d->>k)::integer,0));
  end loop;
  if claim is not null then update invites set used_by=u where claim_id=claim; end if;
  perform record_event(c,ch,'create_player',jsonb_build_object('username',uname),coalesce(actor,u));
  return ch;
end$$;
revoke execute on function public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid)
  to service_role;

create or replace function public.record_event(
  c uuid, ch uuid, action text, detail jsonb, actor uuid default null
) returns void language plpgsql security definer set search_path=public as $$
declare actor_name text; character_name text;
begin
  select coalesce(nullif(display_name,''),username) into actor_name
  from profiles where id=coalesce(actor,(select auth.uid()));
  select name into character_name from characters where id=ch;
  insert into audit_logs(
    campaign_id,character_id,actor_id,action,detail,actor_label,character_label
  ) values(
    c,ch,coalesce(actor,(select auth.uid())),action,detail,actor_name,character_name
  );
  insert into campaign_events(campaign_id,revision) values(c,1)
  on conflict(campaign_id) do update set revision=campaign_events.revision+1;
end$$;

create or replace function public.enrich_dracma_transaction()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.from_username is null and new.from_user_id is not null then
    select username into new.from_username from profiles where id=new.from_user_id;
  end if;
  if new.to_username is null and new.to_user_id is not null then
    select username into new.to_username from profiles where id=new.to_user_id;
  end if;
  return new;
end$$;
drop trigger if exists enrich_dracma_transaction_trigger on public.dracma_transactions;
create trigger enrich_dracma_transaction_trigger
before insert on public.dracma_transactions
for each row execute function public.enrich_dracma_transaction();

update public.dracma_transactions d set
  from_username=coalesce(d.from_username,(select username from public.profiles where id=d.from_user_id)),
  to_username=coalesce(d.to_username,(select username from public.profiles where id=d.to_user_id));

drop function if exists public.transfer_recipients(uuid);
create function public.transfer_recipients(c uuid)
returns table(
  recipient_type text,
  user_id uuid,
  character_id uuid,
  display_name text,
  username text,
  avatar_id uuid
) language sql stable security definer set search_path=public as $$
  select 'master'::text, cm.user_id, null::uuid,
         coalesce(nullif(p.display_name,''),p.username), p.username, null::uuid
  from campaign_members cm
  join profiles p on p.id=cm.user_id
  where cm.campaign_id=c and cm.role='master' and cm.access_active
    and cm.archived_at is null and is_member(c)
  union all
  select 'player'::text, ch.owner_id, ch.id,
         ch.name, p.username, ch.avatar_id
  from characters ch
  join profiles p on p.id=ch.owner_id
  join campaign_members cm on cm.campaign_id=ch.campaign_id and cm.user_id=ch.owner_id
  where ch.campaign_id=c and not ch.archived and cm.access_active
    and cm.archived_at is null and is_member(c)
  order by 1,4;
$$;
revoke execute on function public.transfer_recipients(uuid) from public,anon;
grant execute on function public.transfer_recipients(uuid) to authenticated,service_role;

create or replace function public.activity_ping(c uuid, session_id uuid, active boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p profiles; previous activity_sessions; added bigint := 0;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  select * into p from profiles where id=(select auth.uid());
  if p.id is null then raise exception 'Conta inválida'; end if;
  select * into previous from activity_sessions where id=session_id for update;
  if previous.id is null then
    insert into activity_sessions(
      id,campaign_id,user_id,username_snapshot,ended_at
    ) values(
      session_id,c,p.id,coalesce(nullif(p.display_name,''),p.username),
      case when active then null else now() end
    );
  else
    if previous.campaign_id<>c or previous.user_id is distinct from p.id then
      raise exception 'Sessão inválida';
    end if;
    if active then
      added := greatest(0,least(60,extract(epoch from now()-previous.last_heartbeat_at)::bigint));
    end if;
    update activity_sessions
    set last_interaction_at=case when active then now() else last_interaction_at end,
        last_heartbeat_at=now(),
        ended_at=case when active then null else now() end,
        active_seconds=active_seconds+added
    where id=session_id;
  end if;
  return jsonb_build_object('active_seconds',coalesce(previous.active_seconds,0)+added);
end$$;
revoke execute on function public.activity_ping(uuid,uuid,boolean) from public,anon;
grant execute on function public.activity_ping(uuid,uuid,boolean) to authenticated,service_role;

create or replace function public.submit_session_feedback(c uuid, score integer, note text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; p profiles;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  if score not between 1 and 5 then raise exception 'Avaliação inválida'; end if;
  select * into p from profiles where id=(select auth.uid());
  insert into session_feedback(
    campaign_id,user_id,username_snapshot,rating,comment
  ) values(
    c,p.id,coalesce(nullif(p.display_name,''),p.username),score,left(coalesce(note,''),1200)
  ) on conflict(campaign_id,user_id,feedback_date) do update
    set rating=excluded.rating,comment=excluded.comment,updated_at=now()
  returning id into result;
  perform record_event(c,null,'session_feedback',jsonb_build_object('rating',score));
  return result;
end$$;
revoke execute on function public.submit_session_feedback(uuid,integer,text) from public,anon;
grant execute on function public.submit_session_feedback(uuid,integer,text) to authenticated,service_role;

create or replace function public.wallet_action(c uuid, op text, d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor_member campaign_members;
  requester_ch characters;
  target_ch characters;
  requester_member campaign_members;
  target_member campaign_members;
  charge dracma_charges;
  original dracma_transactions;
  receipt alvorecer_private.receipts;
  out_payload jsonb := '{}';
  req_id uuid;
  tx_id uuid;
  charge_id uuid;
  amount bigint;
  source_before bigint;
  source_after bigint;
  target_before bigint;
  target_after bigint;
  requester_label text;
  requester_username text;
  target_label text;
  target_username text;
  each_amount bigint;
  base_amount bigint;
  remainder bigint;
  item jsonb;
  character_id uuid;
  n integer;
  i integer := 0;
begin
  if (select auth.uid()) is null or not is_member(c) then raise exception 'Sem permissão'; end if;
  select * into actor_member from campaign_members
  where campaign_id=c and user_id=(select auth.uid());

  if op in ('pay_charge','distribute_reward','reverse_transaction') then
    req_id:=nullif(d->>'request_id','')::uuid;
    if req_id is null then raise exception 'Identificador da operação obrigatório'; end if;
    insert into alvorecer_private.receipts(actor_id,request_id,operation,payload,result)
    values((select auth.uid()),req_id,op,d,null) on conflict do nothing;
    if not found then
      select * into receipt from alvorecer_private.receipts rcp
      where rcp.actor_id=(select auth.uid()) and rcp.request_id=req_id;
      if receipt.operation<>op or receipt.payload<>d then
        raise exception 'Identificador reutilizado para outra operação';
      end if;
      return receipt.result;
    end if;
  end if;

  if op='create_charge' then
    amount:=(d->>'amount_cents')::bigint;
    if amount is null or amount<=0 then raise exception 'Informe um valor maior que zero'; end if;
    if actor_member.role='master' then
      requester_label:=coalesce((select nullif(display_name,'') from profiles where id=(select auth.uid())),'Pink');
      requester_username:=(select username from profiles where id=(select auth.uid()));
    else
      select * into requester_ch from characters
      where id=(d->>'source_character_id')::uuid and campaign_id=c
        and owner_id=(select auth.uid()) and not archived;
      if requester_ch.id is null then raise exception 'Carteira de origem inválida'; end if;
      requester_label:=requester_ch.name;
      requester_username:=(select username from profiles where id=requester_ch.owner_id);
    end if;
    if d->>'recipient_type'='master' then
      if actor_member.role='master' then raise exception 'Escolha outro destinatário'; end if;
      select * into target_member from campaign_members
      where campaign_id=c and role='master' and access_active for share;
      target_label:=coalesce((select nullif(display_name,'') from profiles where id=target_member.user_id),'Pink');
      target_username:=(select username from profiles where id=target_member.user_id);
    else
      select * into target_ch from characters
      where id=(d->>'recipient_character_id')::uuid and campaign_id=c
        and owner_id is not null and not archived;
      if target_ch.id is null or target_ch.owner_id=(select auth.uid()) then
        raise exception 'Destinatário inválido';
      end if;
      target_label:=target_ch.name;
      target_username:=(select username from profiles where id=target_ch.owner_id);
    end if;
    insert into dracma_charges(
      campaign_id,requester_user_id,requester_character_id,requester_label,requester_username,
      target_user_id,target_character_id,target_label,target_username,amount_cents,reason
    ) values(
      c,(select auth.uid()),requester_ch.id,requester_label,requester_username,
      coalesce(target_ch.owner_id,target_member.user_id),target_ch.id,target_label,target_username,
      amount,left(coalesce(d->>'reason',''),240)
    ) returning id into charge_id;
    out_payload:=jsonb_build_object('id',charge_id,'amount_cents',amount,'to',target_label);
    perform record_event(c,requester_ch.id,'dracma_charge_created',
      out_payload||jsonb_build_object('reason',left(coalesce(d->>'reason',''),240)));

  elsif op in ('pay_charge','refuse_charge') then
    select * into charge from dracma_charges
    where id=(d->>'charge_id')::uuid and campaign_id=c for update;
    if charge.id is null or charge.status<>'pending' then raise exception 'Cobrança indisponível'; end if;
    if charge.target_user_id is distinct from (select auth.uid()) then raise exception 'Cobrança não pertence a você'; end if;
    if op='refuse_charge' then
      update dracma_charges set status='refused',responded_at=now() where id=charge.id;
      out_payload:=jsonb_build_object('id',charge.id,'status','refused');
      perform record_event(c,charge.target_character_id,'dracma_charge_refused',
        jsonb_build_object('from',charge.requester_label,'amount_cents',charge.amount_cents));
    else
      perform 1 from campaign_events where campaign_id=c for update;
      if charge.target_character_id is not null then
        select * into target_ch from characters where id=charge.target_character_id for update;
        if target_ch.id is null or target_ch.owner_id is distinct from (select auth.uid()) then raise exception 'Carteira pagadora indisponível'; end if;
        source_before:=target_ch.dracmas_cents;
      else
        select * into target_member from campaign_members
        where campaign_id=c and user_id=(select auth.uid()) and role='master' for update;
        if target_member.user_id is null then raise exception 'Carteira pagadora indisponível'; end if;
        source_before:=target_member.dracmas_cents;
      end if;
      if source_before<charge.amount_cents then raise exception 'Saldo insuficiente'; end if;
      if charge.requester_character_id is not null then
        select * into requester_ch from characters where id=charge.requester_character_id for update;
        if requester_ch.id is null then raise exception 'Destinatário indisponível'; end if;
        target_before:=requester_ch.dracmas_cents;
        update characters set dracmas_cents=dracmas_cents+charge.amount_cents,
          money=floor((dracmas_cents+charge.amount_cents)/100.0)::integer
        where id=requester_ch.id;
      else
        select * into requester_member from campaign_members
        where campaign_id=c and user_id=charge.requester_user_id and role='master' for update;
        if requester_member.user_id is null then raise exception 'Destinatário indisponível'; end if;
        target_before:=requester_member.dracmas_cents;
        update campaign_members set dracmas_cents=dracmas_cents+charge.amount_cents
        where campaign_id=c and user_id=requester_member.user_id;
      end if;
      if target_ch.id is not null then
        update characters set dracmas_cents=dracmas_cents-charge.amount_cents,
          money=floor((dracmas_cents-charge.amount_cents)/100.0)::integer
        where id=target_ch.id;
      else
        update campaign_members set dracmas_cents=dracmas_cents-charge.amount_cents
        where campaign_id=c and user_id=target_member.user_id;
      end if;
      source_after:=source_before-charge.amount_cents;
      target_after:=target_before+charge.amount_cents;
      tx_id:=gen_random_uuid();
      insert into dracma_transactions(
        id,campaign_id,kind,actor_id,from_user_id,from_character_id,from_label,from_username,
        to_user_id,to_character_id,to_label,to_username,amount_cents,reason,
        from_balance_after,to_balance_after
      ) values(
        tx_id,c,'charge_payment',(select auth.uid()),charge.target_user_id,
        charge.target_character_id,charge.target_label,charge.target_username,
        charge.requester_user_id,charge.requester_character_id,charge.requester_label,
        charge.requester_username,charge.amount_cents,charge.reason,source_after,target_after
      );
      update dracma_charges set status='paid',transaction_id=tx_id,
        responded_at=now() where id=charge.id;
      out_payload:=jsonb_build_object('id',tx_id,'charge_id',charge.id,
        'amount_cents',charge.amount_cents,'from',charge.target_label,'to',charge.requester_label,
        'from_balance_after',source_after,'to_balance_after',target_after);
      perform record_event(c,charge.target_character_id,'dracma_charge_paid',out_payload);
    end if;

  elsif op='distribute_reward' then
    if actor_member.role<>'master' then raise exception 'Somente o mestre'; end if;
    amount:=(d->>'amount_cents')::bigint;
    if amount is null or amount<=0 then raise exception 'Informe um valor maior que zero'; end if;
    n:=jsonb_array_length(coalesce(d->'character_ids','[]'::jsonb));
    if n<1 or n>100 then raise exception 'Selecione os personagens'; end if;
    if coalesce(d->>'mode','each')='split' then
      base_amount:=amount/n;
      remainder:=amount%n;
      if base_amount=0 then raise exception 'O valor é pequeno demais para dividir'; end if;
    else
      base_amount:=amount;
      remainder:=0;
    end if;
    perform 1 from campaign_events where campaign_id=c for update;
    for item in select * from jsonb_array_elements(d->'character_ids') loop
      character_id:=(item#>>'{}')::uuid;
      select * into target_ch from characters
      where id=character_id and campaign_id=c and not archived for update;
      if target_ch.id is null then raise exception 'Personagem inválido'; end if;
      each_amount:=base_amount+case when i<remainder then 1 else 0 end;
      i:=i+1;
      target_before:=target_ch.dracmas_cents;
      target_after:=target_before+each_amount;
      update characters set dracmas_cents=target_after,
        money=floor(target_after/100.0)::integer where id=target_ch.id;
      tx_id:=gen_random_uuid();
      insert into dracma_transactions(
        id,campaign_id,kind,actor_id,from_label,to_user_id,to_character_id,to_label,
        to_username,amount_cents,reason,to_balance_after
      ) values(
        tx_id,c,'reward',(select auth.uid()),'Recompensa da campanha',
        target_ch.owner_id,target_ch.id,target_ch.name,
        (select username from profiles where id=target_ch.owner_id),each_amount,
        left(coalesce(d->>'reason','Recompensa da campanha'),240),target_after
      );
    end loop;
    out_payload:=jsonb_build_object('recipients',n,'total_cents',base_amount*n+remainder);
    perform record_event(c,null,'dracma_reward_distributed',
      out_payload||jsonb_build_object('reason',left(coalesce(d->>'reason','Recompensa da campanha'),240)));

  elsif op='reverse_transaction' then
    if actor_member.role<>'master' then raise exception 'Somente o mestre'; end if;
    perform 1 from campaign_events where campaign_id=c for update;
    select * into original from dracma_transactions
    where id=(d->>'transaction_id')::uuid and campaign_id=c for update;
    if original.id is null or original.kind='reversal' or original.reversed_at is not null then
      raise exception 'Movimentação não pode ser estornada';
    end if;
    if original.kind='purchase' then
      raise exception 'Compras devem ser corrigidas pelo ajuste administrativo para preservar item e estoque';
    end if;
    if original.to_character_id is not null then
      select * into target_ch from characters where id=original.to_character_id for update;
      if target_ch.id is null or target_ch.dracmas_cents<original.amount_cents then raise exception 'Saldo do destinatário insuficiente para estorno'; end if;
      source_before:=target_ch.dracmas_cents;
      update characters set dracmas_cents=dracmas_cents-original.amount_cents,
        money=floor((dracmas_cents-original.amount_cents)/100.0)::integer where id=target_ch.id;
      source_after:=source_before-original.amount_cents;
    elsif original.to_user_id is not null then
      select * into target_member from campaign_members
      where campaign_id=c and user_id=original.to_user_id for update;
      if target_member.user_id is null or target_member.dracmas_cents<original.amount_cents then raise exception 'Saldo do destinatário insuficiente para estorno'; end if;
      source_before:=target_member.dracmas_cents;
      update campaign_members set dracmas_cents=dracmas_cents-original.amount_cents
      where campaign_id=c and user_id=target_member.user_id;
      source_after:=source_before-original.amount_cents;
    end if;
    if original.from_character_id is not null then
      select * into requester_ch from characters where id=original.from_character_id for update;
      if requester_ch.id is null then raise exception 'Carteira de origem não existe mais'; end if;
      target_before:=requester_ch.dracmas_cents;
      update characters set dracmas_cents=dracmas_cents+original.amount_cents,
        money=floor((dracmas_cents+original.amount_cents)/100.0)::integer where id=requester_ch.id;
      target_after:=target_before+original.amount_cents;
    elsif original.from_user_id is not null then
      select * into requester_member from campaign_members
      where campaign_id=c and user_id=original.from_user_id for update;
      if requester_member.user_id is null then raise exception 'Carteira de origem não existe mais'; end if;
      target_before:=requester_member.dracmas_cents;
      update campaign_members set dracmas_cents=dracmas_cents+original.amount_cents
      where campaign_id=c and user_id=requester_member.user_id;
      target_after:=target_before+original.amount_cents;
    end if;
    tx_id:=gen_random_uuid();
    insert into dracma_transactions(
      id,campaign_id,kind,actor_id,from_user_id,from_character_id,from_label,from_username,
      to_user_id,to_character_id,to_label,to_username,amount_cents,reason,
      from_balance_after,to_balance_after,original_transaction_id
    ) values(
      tx_id,c,'reversal',(select auth.uid()),original.to_user_id,original.to_character_id,
      coalesce(original.to_label,'Sistema'),original.to_username,original.from_user_id,
      original.from_character_id,coalesce(original.from_label,'Sistema'),original.from_username,
      original.amount_cents,left(coalesce(d->>'reason','Estorno'),240),source_after,target_after,original.id
    );
    update dracma_transactions set reversed_at=now(),reversed_by=(select auth.uid()),
      reversal_transaction_id=tx_id where id=original.id;
    out_payload:=jsonb_build_object('id',tx_id,'original_id',original.id,
      'amount_cents',original.amount_cents,'from',coalesce(original.to_label,'Sistema'),
      'to',coalesce(original.from_label,'Sistema'));
    perform record_event(c,original.from_character_id,'dracma_reversal',
      out_payload||jsonb_build_object('reason',left(coalesce(d->>'reason','Estorno'),240)));
  else
    raise exception 'Operação de carteira desconhecida';
  end if;

  if req_id is not null then
    update alvorecer_private.receipts rcp set result=out_payload
    where rcp.actor_id=(select auth.uid()) and rcp.request_id=req_id;
  end if;
  return out_payload;
end$$;
revoke execute on function public.wallet_action(uuid,text,jsonb) from public,anon;
grant execute on function public.wallet_action(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.lifecycle_preview(c uuid, entity text, target uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  if not is_master(c) then raise exception 'Somente o mestre'; end if;
  case entity
    when 'character' then
      select jsonb_build_object(
        'name',ch.name,
        'active_combats',(select count(*) from combat_participants cp join combat_rooms cr on cr.id=cp.room_id where cp.character_id=ch.id and cr.active),
        'transactions',(select count(*) from dracma_transactions dt where dt.from_character_id=ch.id or dt.to_character_id=ch.id),
        'inventory',(select count(*) from character_items ci where ci.character_id=ch.id)
      ) into result from characters ch where ch.id=target and ch.campaign_id=c;
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
end$$;

create or replace function public.lifecycle_action(c uuid, op text, d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare entity text:=d->>'entity'; target uuid:=(d->>'id')::uuid; info jsonb; name text;
begin
  if not is_master(c) then raise exception 'Somente o mestre'; end if;
  info:=lifecycle_preview(c,entity,target);
  name:=info->>'name';
  if op in ('archive','restore') then
    case entity
      when 'character' then update characters set archived=(op='archive'),archived_at=case when op='archive' then now() else null end where id=target and campaign_id=c;
      when 'creature' then update creature_templates set active=(op='restore'),archived_at=case when op='archive' then now() else null end where id=target and campaign_id=c;
      when 'item' then update items set active=(op='restore'),archived_at=case when op='archive' then now() else null end where id=target and campaign_id=c;
      when 'advantage' then update advantages set active=(op='restore'),archived_at=case when op='archive' then now() else null end where id=target and campaign_id=c;
      when 'shop' then update shops set active=(op='restore'),archived_at=case when op='archive' then now() else null end where id=target and campaign_id=c;
      when 'product' then update shop_products sp set active=(op='restore'),archived_at=case when op='archive' then now() else null end from shops s where sp.id=target and s.id=sp.shop_id and s.campaign_id=c;
      when 'attribute' then update attributes set active=(op='restore'),archived_at=case when op='archive' then now() else null end where id=target and campaign_id=c;
      else raise exception 'Tipo inválido';
    end case;
    perform record_event(c,case when entity='character' then target else null end,
      entity||case when op='archive' then '_archived' else '_restored' end,
      jsonb_build_object('name',name));
  elsif op='delete' then
    if entity='character' then
      if (info->>'active_combats')::integer>0 then raise exception 'Retire o personagem do combate ativo antes de excluir'; end if;
      update audit_logs set character_label=coalesce(character_label,name) where character_id=target;
      update combat_participants cp set
        name=coalesce(nullif(cp.name,''),name),
        life=coalesce((select current from character_resources where character_id=target and key='life'),cp.life),
        life_max=coalesce((select maximum from character_resources where character_id=target and key='life'),cp.life_max),
        mana=coalesce((select current from character_resources where character_id=target and key='mana'),cp.mana),
        mana_max=coalesce((select maximum from character_resources where character_id=target and key='mana'),cp.mana_max),
        stamina=coalesce((select current from character_resources where character_id=target and key='stamina'),cp.stamina),
        stamina_max=coalesce((select maximum from character_resources where character_id=target and key='stamina'),cp.stamina_max)
      where cp.character_id=target;
      delete from characters where id=target and campaign_id=c;
    elsif entity='creature' then
      if (info->>'active_combats')::integer>0 then raise exception 'Esta criatura está sendo usada em um combate ativo. Retire-a antes de excluir.'; end if;
      delete from creature_templates where id=target and campaign_id=c;
    elsif entity='item' then
      if (info->>'inventories')::integer>0 or (info->>'products')::integer>0 then raise exception 'O item ainda está em inventários ou lojas'; end if;
      delete from items where id=target and campaign_id=c;
    elsif entity='advantage' then
      if (info->>'characters')::integer>0 then raise exception 'A vantagem ainda está atribuída a personagens'; end if;
      delete from advantages where id=target and campaign_id=c;
    elsif entity='shop' then
      if (info->>'products')::integer>0 then raise exception 'Remova os produtos antes de excluir a loja'; end if;
      delete from shops where id=target and campaign_id=c;
    elsif entity='product' then
      delete from shop_products sp using shops s where sp.id=target and s.id=sp.shop_id and s.campaign_id=c;
    elsif entity='attribute' then
      if (info->>'values')::integer>0 or (info->>'resources')::integer>0 or (info->>'campaign_rules')::integer>0 then raise exception 'O atributo ainda possui valores ou regras vinculadas'; end if;
      delete from attributes where id=target and campaign_id=c;
    else raise exception 'Tipo inválido';
    end if;
    perform record_event(c,null,entity||'_deleted',jsonb_build_object('name',name,'id',target));
  else raise exception 'Ação inválida';
  end if;
  return info;
end$$;

revoke execute on function public.lifecycle_preview(uuid,text,uuid), public.lifecycle_action(uuid,text,jsonb) from public,anon;
grant execute on function public.lifecycle_preview(uuid,text,uuid), public.lifecycle_action(uuid,text,jsonb) to authenticated,service_role;

create or replace function public.prepare_delete_player(
  c uuid, target_user uuid, remove_characters boolean, actor uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare profile_row profiles; character_row characters; character_list jsonb:='[]'::jsonb;
begin
  if not exists(
    select 1 from campaign_members
    where campaign_id=c and user_id=actor and role='master' and access_active
  ) then raise exception 'Somente o mestre'; end if;
  if not exists(
    select 1 from campaign_members
    where campaign_id=c and user_id=target_user and role='player'
  ) then raise exception 'Jogador não encontrado'; end if;
  select * into profile_row from profiles where id=target_user;
  for character_row in select * from characters where campaign_id=c and owner_id=target_user loop
    if remove_characters and exists(
      select 1 from combat_participants cp join combat_rooms cr on cr.id=cp.room_id
      where cp.character_id=character_row.id and cr.active
    ) then raise exception 'Retire os personagens do combate ativo antes de excluir a conta'; end if;
    update audit_logs set character_label=coalesce(character_label,character_row.name)
    where character_id=character_row.id;
    update combat_participants cp set
      name=coalesce(nullif(cp.name,''),character_row.name),
      life=coalesce((select current from character_resources where character_id=character_row.id and key='life'),cp.life),
      life_max=coalesce((select maximum from character_resources where character_id=character_row.id and key='life'),cp.life_max),
      mana=coalesce((select current from character_resources where character_id=character_row.id and key='mana'),cp.mana),
      mana_max=coalesce((select maximum from character_resources where character_id=character_row.id and key='mana'),cp.mana_max),
      stamina=coalesce((select current from character_resources where character_id=character_row.id and key='stamina'),cp.stamina),
      stamina_max=coalesce((select maximum from character_resources where character_id=character_row.id and key='stamina'),cp.stamina_max)
    where cp.character_id=character_row.id;
    character_list:=character_list||jsonb_build_array(jsonb_build_object(
      'id',character_row.id,'name',character_row.name
    ));
  end loop;
  update audit_logs set actor_label=coalesce(actor_label,
    coalesce(nullif(profile_row.display_name,''),profile_row.username))
  where actor_id=target_user;
  update campaign_members set access_active=false,disabled_at=now()
  where campaign_id=c and user_id=target_user;
  perform record_event(c,null,'player_delete_prepared',jsonb_build_object(
    'username',profile_row.username,'name',profile_row.full_name,
    'remove_characters',remove_characters,'characters',character_list
  ),actor);
  return jsonb_build_object(
    'username',profile_row.username,'name',profile_row.full_name,'characters',character_list
  );
end$$;
revoke execute on function public.prepare_delete_player(uuid,uuid,boolean,uuid)
  from public,anon,authenticated;
grant execute on function public.prepare_delete_player(uuid,uuid,boolean,uuid)
  to service_role;

create or replace function public.cleanup_preview(c uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select case when is_master(c) then jsonb_build_object(
    'characters',coalesce((select jsonb_agg(jsonb_build_object('id',ch.id,'name',ch.name,'entity','character') order by ch.name)
      from characters ch where ch.campaign_id=c and ch.archived
        and not exists(select 1 from combat_participants cp join combat_rooms cr on cr.id=cp.room_id where cp.character_id=ch.id and cr.active)),'[]'::jsonb),
    'creatures',coalesce((select jsonb_agg(jsonb_build_object('id',ct.id,'name',ct.name,'entity','creature') order by ct.name)
      from creature_templates ct where ct.campaign_id=c and not ct.active
        and not exists(select 1 from combat_participants cp join combat_rooms cr on cr.id=cp.room_id where cp.template_id=ct.id and cr.active)),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'entity','item') order by i.name)
      from items i where i.campaign_id=c and not i.active
        and not exists(select 1 from character_items ci where ci.item_id=i.id)
        and not exists(select 1 from shop_products sp where sp.item_id=i.id)),'[]'::jsonb),
    'advantages',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'entity','advantage') order by a.name)
      from advantages a where a.campaign_id=c and not a.active
        and not exists(select 1 from character_advantages ca where ca.advantage_id=a.id)),'[]'::jsonb),
    'invites',coalesce((select jsonb_agg(jsonb_build_object(
        'id',i.id,
        'name',case when i.cancelled then 'Convite cancelado' else 'Convite expirado' end||' · validade '||to_char(i.expires_at,'DD/MM/YYYY HH24:MI'),
        'entity','invite'
      ) order by i.expires_at)
      from invites i where i.campaign_id=c and i.used_by is null and (i.cancelled or i.expires_at<now())),'[]'::jsonb),
    'avatars',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'entity','avatar') order by a.name)
      from campaign_avatars a where a.campaign_id=c and not a.active
        and not exists(select 1 from characters ch where ch.avatar_id=a.id)),'[]'::jsonb)
  ) else null end
$$;
revoke execute on function public.cleanup_preview(uuid) from public,anon;
grant execute on function public.cleanup_preview(uuid) to authenticated,service_role;

create or replace function public.log_purchase_transaction()
returns trigger language plpgsql security definer set search_path=public as $$
declare ch characters; transaction_id uuid;
begin
  if new.action='purchase' and coalesce((new.detail->>'delta_cents')::bigint,0)<0 then
    select * into ch from characters where id=new.character_id;
    transaction_id:=gen_random_uuid();
    insert into dracma_transactions(
      id,campaign_id,kind,actor_id,from_user_id,from_character_id,from_label,from_username,
      to_label,amount_cents,reason,from_balance_after,audit_log_id
    ) values(
      transaction_id,new.campaign_id,'purchase',new.actor_id,ch.owner_id,ch.id,
      coalesce(ch.name,new.character_label),(select username from profiles where id=ch.owner_id),
      coalesce('Compra · '||nullif(new.detail->>'name',''),'Loja'),
      abs((new.detail->>'delta_cents')::bigint),
      coalesce('Compra de '||nullif(new.detail->>'name',''),'Compra em loja'),
      (new.detail->>'after_cents')::bigint,new.id
    ) on conflict(audit_log_id) where audit_log_id is not null do nothing;
  end if;
  return new;
end$$;

drop trigger if exists log_purchase_transaction_trigger on public.audit_logs;
create trigger log_purchase_transaction_trigger
after insert on public.audit_logs
for each row execute function public.log_purchase_transaction();

-- Backfill purchases that existed before the wallet statement included stores.
insert into public.dracma_transactions(
  campaign_id,kind,actor_id,from_user_id,from_character_id,from_label,from_username,
  to_label,amount_cents,reason,from_balance_after,audit_log_id,created_at
)
select l.campaign_id,'purchase',l.actor_id,ch.owner_id,l.character_id,
       coalesce(ch.name,l.character_label),(select username from profiles where id=ch.owner_id),
       coalesce('Compra · '||nullif(l.detail->>'name',''),'Loja'),
       abs((l.detail->>'delta_cents')::bigint),
       coalesce('Compra de '||nullif(l.detail->>'name',''),'Compra em loja'),
       (l.detail->>'after_cents')::bigint,l.id,l.created_at
from public.audit_logs l
left join public.characters ch on ch.id=l.character_id
where l.action='purchase' and coalesce((l.detail->>'delta_cents')::bigint,0)<0
on conflict(audit_log_id) where audit_log_id is not null do nothing;

-- Keep disabled accounts from appearing in normal player directories immediately.
create index if not exists campaign_members_campaign_access_idx
  on public.campaign_members(campaign_id,access_active,role);
create index if not exists characters_campaign_archived_idx
  on public.characters(campaign_id,archived,name);
