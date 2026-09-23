create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists(
    select 1 from vault.secrets
    where name = 'alvorecer_notification_push_hook_v1'
  ) then
    perform vault.create_secret(
      gen_random_uuid()::text || gen_random_uuid()::text,
      'alvorecer_notification_push_hook_v1'
    );
  end if;
end
$$;

create or replace function public.verify_notification_push_hook(token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    length(coalesce(token, '')) > 40
    and exists(
      select 1
      from vault.decrypted_secrets
      where name = 'alvorecer_notification_push_hook_v1'
        and decrypted_secret = token
    )
$$;

revoke all on function public.verify_notification_push_hook(text)
  from public, anon, authenticated;
grant execute on function public.verify_notification_push_hook(text)
  to service_role;

create or replace function public.notification_android_devices(
  p_campaign_id uuid,
  p_user_ids uuid[]
)
returns table(
  device_id uuid,
  user_id uuid,
  fcm_token text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (d.fcm_token)
    d.id as device_id,
    d.master_user_id as user_id,
    d.fcm_token
  from alvorecer_private.mobile_gallery_devices d
  where d.campaign_id = p_campaign_id
    and d.master_user_id = any(p_user_ids)
    and d.active
    and nullif(trim(d.fcm_token), '') is not null
  order by d.fcm_token, d.last_seen_at desc nulls last
$$;

revoke all on function public.notification_android_devices(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.notification_android_devices(uuid, uuid[])
  to service_role;

create or replace function public.enqueue_native_notification_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hook_token text;
  payload jsonb;
begin
  select decrypted_secret
    into hook_token
  from vault.decrypted_secrets
  where name = 'alvorecer_notification_push_hook_v1';

  if hook_token is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id::text,
        'campaign_id', n.campaign_id::text,
        'user_id', n.user_id::text,
        'kind', n.kind,
        'reference_id', n.reference_id
      )
    ),
    '[]'::jsonb
  )
  into payload
  from new_notifications n;

  if jsonb_array_length(payload) = 0 then
    return null;
  end if;

  perform net.http_post(
    url := 'https://wsihnbrnqdnmidjvjchn.supabase.co/functions/v1/alvorecer-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-hook-token', hook_token
    ),
    body := jsonb_build_object(
      'action', 'notifications_created',
      'notifications', payload
    )
  );

  return null;
exception
  when others then
    return null;
end
$$;

revoke all on function public.enqueue_native_notification_push()
  from public, anon, authenticated;

drop trigger if exists notifications_native_push on public.notifications;

create trigger notifications_native_push
after insert on public.notifications
referencing new table as new_notifications
for each statement
execute function public.enqueue_native_notification_push();
