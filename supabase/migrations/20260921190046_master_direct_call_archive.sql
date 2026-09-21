create or replace function public.master_direct_call_archive(c uuid)
returns table(
  id uuid,
  conversation_id uuid,
  caller_id uuid,
  caller_name text,
  callee_id uuid,
  callee_name text,
  status text,
  created_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  ended_by_name text,
  failure_reason text,
  duration_seconds integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode acessar o arquivo de chamadas';
  end if;

  return query
  select
    call.id,
    call.conversation_id,
    call.caller_id,
    caller.name,
    call.callee_id,
    callee.name,
    call.status,
    call.created_at,
    call.answered_at,
    call.ended_at,
    call.ended_by,
    ended_identity.name,
    call.failure_reason,
    case
      when call.answered_at is null or call.ended_at is null then 0
      else greatest(
        0,
        floor(extract(epoch from (call.ended_at - call.answered_at)))::integer
      )
    end
  from public.direct_calls call
  join public.social_identities caller on caller.id=call.caller_id
  join public.social_identities callee on callee.id=call.callee_id
  left join public.social_identities ended_identity on ended_identity.id=call.ended_by
  where call.campaign_id=c
    and call.status in ('ended','declined','cancelled','missed','failed')
  order by coalesce(call.ended_at,call.created_at) desc,call.id desc
  limit 200;
end
$function$;

revoke all on function public.master_direct_call_archive(uuid) from public;
revoke all on function public.master_direct_call_archive(uuid) from anon;
grant execute on function public.master_direct_call_archive(uuid) to authenticated;
