drop policy if exists message_read on public.direct_messages;

create policy message_read
on public.direct_messages
for select
to authenticated
using (
  cleared_at is null
  and public.can_converse(conversation_id)
);

create or replace function public.master_conversation_messages(
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
  cleared_at timestamptz
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
    message.cleared_at
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
