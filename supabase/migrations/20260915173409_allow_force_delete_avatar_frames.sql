create function public.delete_avatar_frame(c uuid,target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  frame cosmetics;
  asset text;
  owner_count integer;
  equipped_count integer;
begin
  if not is_member(c) or not is_master(c) then
    raise exception 'Somente Pink';
  end if;

  select * into frame
  from cosmetics
  where id=target_id and campaign_id=c and kind='frame'
  for update;

  if frame.id is null then
    raise exception 'Moldura inválida';
  end if;

  select count(*) into owner_count
  from cosmetic_grants
  where cosmetic_id=frame.id and removed_at is null;

  select count(*) into equipped_count
  from cosmetic_equipment
  where cosmetic_id=frame.id and kind='frame';

  asset:=frame.asset_path;
  if exists(
    select 1 from cosmetics
    where id<>frame.id and asset_path=asset
  ) then
    asset:=null;
  end if;

  delete from cosmetic_equipment
  where cosmetic_id=frame.id and kind='frame';

  delete from cosmetic_grants
  where cosmetic_id=frame.id;

  delete from notifications
  where campaign_id=c
    and kind='cosmetic'
    and reference_id=frame.id::text;

  delete from cosmetics
  where id=frame.id and campaign_id=c and kind='frame';

  perform record_event(
    c,
    null,
    'frame_delete',
    jsonb_build_object(
      'id',frame.id,
      'name',frame.name,
      'owners_removed',owner_count,
      'equipment_removed',equipped_count
    )
  );

  return jsonb_build_object(
    'id',frame.id,
    'asset_path',asset,
    'owners_removed',owner_count,
    'equipment_removed',equipped_count
  );
end
$$;

revoke all on function public.delete_avatar_frame(uuid,uuid)
  from public,anon;
grant execute on function public.delete_avatar_frame(uuid,uuid)
  to authenticated,service_role;
