create table if not exists public.direct_message_likes(
  message_id uuid not null references public.direct_messages(id) on delete cascade,
  identity_id uuid not null references public.social_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(message_id,identity_id)
);

create index if not exists direct_message_likes_identity_idx
  on public.direct_message_likes(identity_id,created_at desc);

alter table public.direct_message_likes enable row level security;

revoke all on public.direct_message_likes from anon,authenticated;
grant select on public.direct_message_likes to authenticated;
grant all on public.direct_message_likes to service_role;

drop policy if exists direct_message_likes_read on public.direct_message_likes;
create policy direct_message_likes_read
on public.direct_message_likes
for select
to authenticated
using(
  exists(
    select 1
    from public.direct_messages message
    where message.id=direct_message_likes.message_id
      and message.cleared_at is null
      and message.deleted_at is null
      and public.can_converse(message.conversation_id)
  )
);

create or replace function public.direct_message_like_toggle(
  c uuid,
  actor_id uuid,
  target_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  target_message public.direct_messages;
  removed integer;
  liked boolean;
  total bigint;
begin
  if not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select *
  into actor
  from public.social_identities
  where id=actor_id
    and campaign_id=c
    and active;

  if actor.id is null
     or (
       actor.user_id is distinct from (select auth.uid())
       and not (public.is_master(c) and actor.kind='npc')
     ) then
    raise exception 'Identidade não autorizada';
  end if;

  select message.*
  into target_message
  from public.direct_messages message
  join public.direct_conversations target_conversation
    on target_conversation.id=message.conversation_id
  where message.id=target_message_id
    and target_conversation.campaign_id=c
    and actor.id in(target_conversation.first_id,target_conversation.second_id)
    and message.cleared_at is null
    and message.deleted_at is null;

  if target_message.id is null then
    raise exception 'Mensagem indisponível';
  end if;

  delete from public.direct_message_likes
  where message_id=target_message.id
    and identity_id=actor.id;

  get diagnostics removed=row_count;

  if removed>0 then
    liked:=false;
  else
    insert into public.direct_message_likes(message_id,identity_id)
    values(target_message.id,actor.id);
    liked:=true;
  end if;

  select count(*)::bigint
  into total
  from public.direct_message_likes
  where message_id=target_message.id;

  return jsonb_build_object(
    'message_id',target_message.id,
    'liked',liked,
    'count',total
  );
end
$$;

revoke all on function public.direct_message_like_toggle(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.direct_message_like_toggle(uuid,uuid,uuid)
  to authenticated,service_role;

do $$
begin
  if not exists(
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='direct_message_likes'
  ) then
    alter publication supabase_realtime
      add table public.direct_message_likes;
  end if;
end
$$;
