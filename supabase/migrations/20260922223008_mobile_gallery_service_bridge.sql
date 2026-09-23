-- PostgREST cannot query the unexposed alvorecer_private schema. These narrow
-- RPCs are callable only by the Edge Function's service_role, not app sessions.
-- SECURITY INVOKER preserves the caller's privileges; no schema is exposed.
create function public.mobile_gallery_read_devices()
returns setof alvorecer_private.mobile_gallery_devices
language sql stable security invoker set search_path = ''
as $$ select * from alvorecer_private.mobile_gallery_devices $$;

create function public.mobile_gallery_read_items()
returns setof alvorecer_private.mobile_gallery_items
language sql stable security invoker set search_path = ''
as $$ select * from alvorecer_private.mobile_gallery_items $$;

create function public.mobile_gallery_read_requests()
returns setof alvorecer_private.mobile_gallery_requests
language sql stable security invoker set search_path = ''
as $$ select * from alvorecer_private.mobile_gallery_requests $$;

create function public.mobile_gallery_save_device(p_row jsonb)
returns setof alvorecer_private.mobile_gallery_devices
language sql security invoker set search_path = '' as $$
  insert into alvorecer_private.mobile_gallery_devices
    (campaign_id, master_user_id, installation_id, device_name, token_hash, fcm_token, active, last_seen_at)
  values ((p_row->>'campaign_id')::uuid, (p_row->>'master_user_id')::uuid,
    p_row->>'installation_id', p_row->>'device_name', p_row->>'token_hash', p_row->>'fcm_token', true, now())
  on conflict (campaign_id, master_user_id, installation_id) do update set
    device_name = excluded.device_name, token_hash = excluded.token_hash,
    fcm_token = coalesce(excluded.fcm_token, mobile_gallery_devices.fcm_token),
    active = true, last_seen_at = now(), updated_at = now()
  returning *
$$;

create function public.mobile_gallery_save_item(p_row jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into alvorecer_private.mobile_gallery_items
    (device_id, campaign_id, local_media_id, display_name, mime_type, byte_size,
     modified_at, duration_ms, width, height, thumbnail_path)
  select d.id, d.campaign_id, p_row->>'local_media_id', p_row->>'display_name',
    p_row->>'mime_type', (p_row->>'byte_size')::bigint, (p_row->>'modified_at')::bigint,
    (p_row->>'duration_ms')::bigint, (p_row->>'width')::integer, (p_row->>'height')::integer,
    p_row->>'thumbnail_path'
  from alvorecer_private.mobile_gallery_devices d
  where d.id = (p_row->>'device_id')::uuid and d.active
  on conflict (device_id, local_media_id) do update set
    display_name = excluded.display_name, mime_type = excluded.mime_type,
    byte_size = excluded.byte_size, modified_at = excluded.modified_at,
    duration_ms = excluded.duration_ms, width = excluded.width, height = excluded.height,
    thumbnail_path = excluded.thumbnail_path, available = true, indexed_at = now(), updated_at = now()
$$;

create function public.mobile_gallery_create_request(p_row jsonb)
returns setof alvorecer_private.mobile_gallery_requests
language sql security invoker set search_path = '' as $$
  insert into alvorecer_private.mobile_gallery_requests (campaign_id, device_id, item_id, requested_by)
  select i.campaign_id, i.device_id, i.id, (p_row->>'requested_by')::uuid
  from alvorecer_private.mobile_gallery_items i
  join alvorecer_private.mobile_gallery_devices d on d.id = i.device_id and d.active
  where i.id = (p_row->>'item_id')::uuid and i.campaign_id = (p_row->>'campaign_id')::uuid and i.available
  on conflict (item_id) where status in ('requested','uploading','ready')
    do update set item_id = excluded.item_id
  returning *
$$;

create function public.mobile_gallery_update_device(p_id uuid, p_patch jsonb)
returns void language sql security invoker set search_path = '' as $$
  update alvorecer_private.mobile_gallery_devices set
    last_seen_at = case when p_patch ? 'last_seen_at' then (p_patch->>'last_seen_at')::timestamptz else last_seen_at end,
    fcm_token = case when p_patch ? 'fcm_token' then p_patch->>'fcm_token' else fcm_token end,
    updated_at = now()
  where id = p_id
$$;

create function public.mobile_gallery_update_item(p_id uuid, p_patch jsonb)
returns void language sql security invoker set search_path = '' as $$
  update alvorecer_private.mobile_gallery_items set
    available = coalesce((p_patch->>'available')::boolean, available), updated_at = now()
  where id = p_id
$$;

create function public.mobile_gallery_update_requests(p_ids uuid[], p_patch jsonb)
returns void language sql security invoker set search_path = '' as $$
  update alvorecer_private.mobile_gallery_requests set
    status = coalesce(p_patch->>'status', status),
    original_path = case when p_patch ? 'original_path' then p_patch->>'original_path' else original_path end,
    error_message = case when p_patch ? 'error_message' then p_patch->>'error_message' else error_message end,
    started_at = case when p_patch ? 'started_at' then (p_patch->>'started_at')::timestamptz else started_at end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else completed_at end,
    expires_at = case when p_patch ? 'expires_at' then (p_patch->>'expires_at')::timestamptz else expires_at end,
    updated_at = now()
  where id = any(p_ids)
$$;

revoke all on function public.mobile_gallery_read_devices(), public.mobile_gallery_read_items(),
  public.mobile_gallery_read_requests(), public.mobile_gallery_save_device(jsonb),
  public.mobile_gallery_save_item(jsonb), public.mobile_gallery_create_request(jsonb),
  public.mobile_gallery_update_device(uuid,jsonb), public.mobile_gallery_update_item(uuid,jsonb),
  public.mobile_gallery_update_requests(uuid[],jsonb) from public, anon, authenticated;
grant execute on function public.mobile_gallery_read_devices(), public.mobile_gallery_read_items(),
  public.mobile_gallery_read_requests(), public.mobile_gallery_save_device(jsonb),
  public.mobile_gallery_save_item(jsonb), public.mobile_gallery_create_request(jsonb),
  public.mobile_gallery_update_device(uuid,jsonb), public.mobile_gallery_update_item(uuid,jsonb),
  public.mobile_gallery_update_requests(uuid[],jsonb) to service_role;
grant usage on schema alvorecer_private to service_role;
notify pgrst, 'reload schema';
