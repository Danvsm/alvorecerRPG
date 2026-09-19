create or replace function public.send_master_notification(
  c uuid,
  recipient_ids uuid[],
  notification_kind text,
  notification_title text,
  notification_body text
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  sent_count integer := 0;
  clean_kind text;
  clean_title text;
  clean_body text;
begin
  if auth.uid() is null or not public.is_master(c) then
    raise exception 'Somente o mestre pode enviar notificações';
  end if;

  if recipient_ids is null or cardinality(recipient_ids) = 0 then
    raise exception 'Selecione pelo menos um jogador';
  end if;

  clean_kind := case lower(coalesce(notification_kind, 'announcement'))
    when 'announcement' then 'announcement'
    when 'message' then 'message'
    when 'event' then 'event'
    when 'reward' then 'reward'
    when 'warning' then 'warning'
    else 'announcement'
  end;

  clean_title := left(trim(coalesce(notification_title, '')), 100);
  clean_body := left(trim(coalesce(notification_body, '')), 500);

  if clean_title = '' then
    raise exception 'Informe um título';
  end if;

  if clean_body = '' then
    raise exception 'Escreva a mensagem da notificação';
  end if;

  insert into public.notifications (
    campaign_id,
    user_id,
    kind,
    title,
    body
  )
  select
    c,
    member.user_id,
    clean_kind,
    clean_title,
    clean_body
  from public.campaign_members member
  where member.campaign_id = c
    and member.role = 'player'
    and member.access_active
    and member.archived_at is null
    and member.user_id = any(recipient_ids);

  get diagnostics sent_count = row_count;

  if sent_count = 0 then
    raise exception 'Nenhum jogador válido foi selecionado';
  end if;

  return sent_count;
end;
$$;

revoke all on function public.send_master_notification(uuid, uuid[], text, text, text) from public;
revoke all on function public.send_master_notification(uuid, uuid[], text, text, text) from anon;
grant execute on function public.send_master_notification(uuid, uuid[], text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;
