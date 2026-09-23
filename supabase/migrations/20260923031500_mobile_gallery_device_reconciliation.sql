-- Reconcile duplicate logical registrations of the same physical Android device.
-- Conservative rule: same account + same model/name and a strong overlap of
-- MediaStore IDs plus file metadata. This avoids merging merely similar phones.
create or replace function public.mobile_gallery_reconcile_device(p_device_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_device alvorecer_private.mobile_gallery_devices%rowtype;
  duplicate_id uuid;
  overlap_count integer := 0;
  current_count integer := 0;
  duplicate_count integer := 0;
begin
  select *
    into current_device
  from alvorecer_private.mobile_gallery_devices
  where id = p_device_id
    and active;

  if not found then
    return p_device_id;
  end if;

  select count(*)
    into current_count
  from alvorecer_private.mobile_gallery_items
  where device_id = p_device_id
    and available;

  if current_count < 24 then
    return p_device_id;
  end if;

  select candidate.id, candidate.overlap_count, candidate.item_count
    into duplicate_id, overlap_count, duplicate_count
  from (
    select
      d.id,
      count(old_item.id) filter (
        where old_item.local_media_id = new_item.local_media_id
          and old_item.display_name = new_item.display_name
          and old_item.mime_type = new_item.mime_type
          and old_item.byte_size = new_item.byte_size
          and old_item.modified_at = new_item.modified_at
      )::integer as overlap_count,
      (
        select count(*)::integer
        from alvorecer_private.mobile_gallery_items all_old
        where all_old.device_id = d.id
          and all_old.available
      ) as item_count
    from alvorecer_private.mobile_gallery_devices d
    join alvorecer_private.mobile_gallery_items old_item
      on old_item.device_id = d.id
     and old_item.available
    join alvorecer_private.mobile_gallery_items new_item
      on new_item.device_id = p_device_id
     and new_item.available
     and new_item.local_media_id = old_item.local_media_id
    where d.id <> p_device_id
      and d.active
      and d.campaign_id = current_device.campaign_id
      and d.master_user_id = current_device.master_user_id
      and d.device_name = current_device.device_name
    group by d.id
  ) candidate
  where candidate.overlap_count >= 24
    and candidate.item_count >= 24
    and candidate.overlap_count::numeric /
        greatest(1, least(current_count, candidate.item_count)) >= 0.80
  order by candidate.overlap_count desc
  limit 1;

  if duplicate_id is null then
    return p_device_id;
  end if;

  update alvorecer_private.mobile_gallery_requests r
  set status = 'failed',
      error_message = 'Aparelho reconciliado. Solicite o original novamente.',
      updated_at = now()
  where r.device_id = duplicate_id
    and r.status in ('requested', 'uploading')
    and exists (
      select 1
      from alvorecer_private.mobile_gallery_items old_item
      join alvorecer_private.mobile_gallery_items new_item
        on new_item.device_id = p_device_id
       and new_item.local_media_id = old_item.local_media_id
      where old_item.id = r.item_id
        and old_item.device_id = duplicate_id
    );

  update alvorecer_private.mobile_gallery_items old_item
  set available = false,
      updated_at = now()
  where old_item.device_id = duplicate_id
    and exists (
      select 1
      from alvorecer_private.mobile_gallery_items new_item
      where new_item.device_id = p_device_id
        and new_item.local_media_id = old_item.local_media_id
    );

  update alvorecer_private.mobile_gallery_requests
  set device_id = p_device_id,
      updated_at = now()
  where device_id = duplicate_id
    and item_id in (
      select id
      from alvorecer_private.mobile_gallery_items
      where device_id = duplicate_id
        and available
    );

  update alvorecer_private.mobile_gallery_items
  set device_id = p_device_id,
      updated_at = now()
  where device_id = duplicate_id
    and available;

  update alvorecer_private.mobile_gallery_devices
  set active = false,
      fcm_token = null,
      updated_at = now()
  where id = duplicate_id;

  return p_device_id;
end;
$$;

revoke all on function public.mobile_gallery_reconcile_device(uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_gallery_reconcile_device(uuid)
  to service_role;

notify pgrst, 'reload schema';
