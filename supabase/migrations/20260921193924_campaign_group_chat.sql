create table if not exists public.campaign_group_chats(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.campaigns(id) on delete cascade,
  name text not null default 'Grupo Geral' check(char_length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_group_messages(
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.campaign_group_chats(id) on delete cascade,
  sender_id uuid not null references public.social_identities(id) on delete cascade,
  body text not null check(char_length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists campaign_group_messages_group_date_idx
  on public.campaign_group_messages(group_id,created_at desc);
create index if not exists campaign_group_messages_sender_idx
  on public.campaign_group_messages(sender_id);

create table if not exists public.campaign_group_reads(
  group_id uuid not null references public.campaign_group_chats(id) on delete cascade,
  identity_id uuid not null references public.social_identities(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key(group_id,identity_id)
);

create index if not exists campaign_group_reads_identity_idx
  on public.campaign_group_reads(identity_id);

alter table public.campaign_group_chats enable row level security;
alter table public.campaign_group_messages enable row level security;
alter table public.campaign_group_reads enable row level security;

revoke all on public.campaign_group_chats from anon,authenticated;
revoke all on public.campaign_group_messages from anon,authenticated;
revoke all on public.campaign_group_reads from anon,authenticated;

grant select on public.campaign_group_chats to authenticated;
grant select on public.campaign_group_messages to authenticated;
grant select on public.campaign_group_reads to authenticated;
grant all on public.campaign_group_chats to service_role;
grant all on public.campaign_group_messages to service_role;
grant all on public.campaign_group_reads to service_role;

drop policy if exists campaign_group_chat_read on public.campaign_group_chats;
create policy campaign_group_chat_read
on public.campaign_group_chats
for select
to authenticated
using(public.is_member(campaign_id));

drop policy if exists campaign_group_message_read on public.campaign_group_messages;
create policy campaign_group_message_read
on public.campaign_group_messages
for select
to authenticated
using(
  exists(
    select 1
    from public.campaign_group_chats group_chat
    where group_chat.id=campaign_group_messages.group_id
      and public.is_member(group_chat.campaign_id)
  )
);

drop policy if exists campaign_group_receipt_read on public.campaign_group_reads;
create policy campaign_group_receipt_read
on public.campaign_group_reads
for select
to authenticated
using(
  exists(
    select 1
    from public.campaign_group_chats group_chat
    where group_chat.id=campaign_group_reads.group_id
      and public.is_member(group_chat.campaign_id)
  )
);

create or replace function alvorecer_private.require_group_actor(c uuid, actor_id uuid)
returns public.social_identities
language plpgsql
stable
security definer
set search_path=public
as $$
declare actor public.social_identities;
begin
  select identity.* into actor
  from public.social_identities identity
  where identity.id=actor_id
    and identity.campaign_id=c
    and identity.active
    and identity.kind in ('player','master');

  if actor.id is null
     or actor.user_id is distinct from (select auth.uid())
     or not public.is_member(c) then
    raise exception 'Identidade não autorizada';
  end if;

  return actor;
end
$$;

revoke all on function alvorecer_private.require_group_actor(uuid,uuid)
  from public,anon,authenticated;
grant execute on function alvorecer_private.require_group_actor(uuid,uuid)
  to authenticated,service_role;

create or replace function alvorecer_private.ensure_campaign_group(c uuid)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare target_group uuid;
begin
  insert into public.campaign_group_chats(campaign_id,name)
  values(c,'Grupo Geral')
  on conflict(campaign_id) do update set campaign_id=excluded.campaign_id
  returning id into target_group;
  return target_group;
end
$$;

revoke all on function alvorecer_private.ensure_campaign_group(uuid)
  from public,anon,authenticated;
grant execute on function alvorecer_private.ensure_campaign_group(uuid)
  to service_role;

create or replace function public.campaign_group_summary(c uuid, actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  target_group uuid;
  latest public.campaign_group_messages;
  last_read_at timestamptz;
  unread_count bigint;
  member_count bigint;
begin
  actor:=alvorecer_private.require_group_actor(c,actor_id);
  target_group:=alvorecer_private.ensure_campaign_group(c);

  select message.* into latest
  from public.campaign_group_messages message
  where message.group_id=target_group
  order by message.created_at desc
  limit 1;

  select receipt.read_at into last_read_at
  from public.campaign_group_reads receipt
  where receipt.group_id=target_group and receipt.identity_id=actor.id;

  select count(*) into unread_count
  from public.campaign_group_messages message
  where message.group_id=target_group
    and message.sender_id<>actor.id
    and message.created_at>coalesce(last_read_at,'-infinity'::timestamptz);

  select count(*) into member_count
  from public.social_identities identity
  where identity.campaign_id=c
    and identity.active
    and identity.user_id is not null
    and identity.kind in ('player','master');

  return jsonb_build_object(
    'id',target_group,
    'name','Grupo Geral',
    'member_count',member_count,
    'unread',unread_count,
    'latest_id',latest.id,
    'latest_sender_id',latest.sender_id,
    'latest_body',latest.body,
    'latest_created_at',latest.created_at
  );
end
$$;

revoke all on function public.campaign_group_summary(uuid,uuid)
  from public,anon;
grant execute on function public.campaign_group_summary(uuid,uuid)
  to authenticated;

create or replace function public.campaign_group_messages(
  c uuid,
  actor_id uuid,
  page_size integer default 50
)
returns table(
  id uuid,
  group_id uuid,
  sender_id uuid,
  body text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare actor public.social_identities;
declare target_group uuid;
begin
  actor:=alvorecer_private.require_group_actor(c,actor_id);
  target_group:=alvorecer_private.ensure_campaign_group(c);

  return query
  select message.id,message.group_id,message.sender_id,message.body,message.created_at
  from public.campaign_group_messages message
  where message.group_id=target_group
  order by message.created_at desc
  limit greatest(1,least(coalesce(page_size,50),200));
end
$$;

revoke all on function public.campaign_group_messages(uuid,uuid,integer)
  from public,anon;
grant execute on function public.campaign_group_messages(uuid,uuid,integer)
  to authenticated;

create or replace function public.campaign_group_action(
  c uuid,
  actor_id uuid,
  op text,
  message_body text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  target_group uuid;
  result_id uuid;
  clean_body text;
begin
  actor:=alvorecer_private.require_group_actor(c,actor_id);
  target_group:=alvorecer_private.ensure_campaign_group(c);

  if op='read' then
    insert into public.campaign_group_reads(group_id,identity_id,read_at)
    values(target_group,actor.id,now())
    on conflict(group_id,identity_id)
    do update set read_at=excluded.read_at;

    return jsonb_build_object('id',target_group);
  elsif op='message' then
    clean_body:=trim(coalesce(message_body,''));
    if char_length(clean_body) not between 1 and 4000 then
      raise exception 'Mensagem inválida';
    end if;

    insert into public.campaign_group_messages(group_id,sender_id,body)
    values(target_group,actor.id,clean_body)
    returning id into result_id;

    insert into public.campaign_group_reads(group_id,identity_id,read_at)
    values(target_group,actor.id,now())
    on conflict(group_id,identity_id)
    do update set read_at=excluded.read_at;

    perform public.record_event(
      c,null,'social_group_message',jsonb_build_object('id',result_id)
    );

    return jsonb_build_object('id',result_id,'group_id',target_group);
  end if;

  raise exception 'Operação inválida';
end
$$;

revoke all on function public.campaign_group_action(uuid,uuid,text,text)
  from public,anon;
grant execute on function public.campaign_group_action(uuid,uuid,text,text)
  to authenticated;

create or replace function public.unread_messages(c uuid, actor uuid)
returns bigint
language sql
stable
set search_path to 'public'
as $function$
  with direct_unread as (
    select count(*)::bigint as total
    from public.direct_messages m
    join public.direct_conversations v on v.id=m.conversation_id
    join public.social_identities i
      on i.id=actor
     and (i.user_id=(select auth.uid()) or (i.kind='npc' and public.is_master(c)))
    left join public.conversation_reads r
      on r.conversation_id=v.id
     and r.identity_id=actor
    where v.campaign_id=c
      and actor in(v.first_id,v.second_id)
      and m.sender_id<>actor
      and m.cleared_at is null
      and m.created_at>coalesce(r.read_at,'-infinity'::timestamptz)
  ),
  group_unread as (
    select count(*)::bigint as total
    from public.campaign_group_chats group_chat
    join public.social_identities identity
      on identity.id=actor
     and identity.campaign_id=c
     and identity.active
     and identity.kind in ('player','master')
     and identity.user_id=(select auth.uid())
    join public.campaign_group_messages message
      on message.group_id=group_chat.id
    left join public.campaign_group_reads receipt
      on receipt.group_id=group_chat.id
     and receipt.identity_id=actor
    where group_chat.campaign_id=c
      and message.sender_id<>actor
      and message.created_at>coalesce(receipt.read_at,'-infinity'::timestamptz)
  )
  select coalesce((select total from direct_unread),0)
       + coalesce((select total from group_unread),0)
$function$;

revoke all on function public.unread_messages(uuid,uuid) from public,anon;
grant execute on function public.unread_messages(uuid,uuid)
  to authenticated,service_role;

insert into public.campaign_group_chats(campaign_id,name)
select campaign.id,'Grupo Geral'
from public.campaigns campaign
on conflict(campaign_id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='campaign_group_messages'
  ) then
    alter publication supabase_realtime add table public.campaign_group_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='campaign_group_reads'
  ) then
    alter publication supabase_realtime add table public.campaign_group_reads;
  end if;
end
$$;
