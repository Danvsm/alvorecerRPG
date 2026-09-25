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
security definer
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
