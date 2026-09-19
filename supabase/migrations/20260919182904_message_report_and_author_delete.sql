alter table public.direct_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_identity_id uuid references public.social_identities(id) on delete set null;

create index if not exists direct_messages_deleted_idx
  on public.direct_messages(conversation_id, deleted_at)
  where deleted_at is not null;

alter table public.conversation_reports
  add column if not exists report_kind text not null default 'conversation',
  add column if not exists message_id uuid references public.direct_messages(id) on delete set null,
  add column if not exists message_body_snapshot text,
  add column if not exists message_media_id uuid,
  add column if not exists message_created_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname='conversation_reports_kind_check'
      and conrelid='public.conversation_reports'::regclass
  ) then
    alter table public.conversation_reports
      add constraint conversation_reports_kind_check
      check (report_kind in ('conversation','message'));
  end if;
end
$$;

create index if not exists conversation_reports_message_idx
  on public.conversation_reports(message_id)
  where message_id is not null;

drop policy if exists message_read on public.direct_messages;

create policy message_read
on public.direct_messages
for select
to authenticated
using (
  cleared_at is null
  and deleted_at is null
  and public.can_converse(conversation_id)
);

drop function if exists public.master_conversation_messages(uuid, uuid, integer);

create function public.master_conversation_messages(
  c uuid,
  target uuid,
  page_size integer default 500
)
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  body text,
  media_id uuid,
  created_at timestamptz,
  cleared_at timestamptz,
  deleted_at timestamptz,
  deleted_by_identity_id uuid
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode acessar o monitoramento';
  end if;

  return query
  select
    message.id,
    message.conversation_id,
    message.sender_id,
    message.body,
    message.media_id,
    message.created_at,
    message.cleared_at,
    message.deleted_at,
    message.deleted_by_identity_id
  from public.direct_messages message
  join public.direct_conversations conversation
    on conversation.id = message.conversation_id
  where conversation.campaign_id = c
    and (target is null or message.conversation_id = target)
  order by message.created_at desc
  limit greatest(1, least(coalesce(page_size, 500), 1000));
end
$function$;

revoke all on function public.master_conversation_messages(uuid, uuid, integer) from public;
revoke all on function public.master_conversation_messages(uuid, uuid, integer) from anon;
grant execute on function public.master_conversation_messages(uuid, uuid, integer) to authenticated;
