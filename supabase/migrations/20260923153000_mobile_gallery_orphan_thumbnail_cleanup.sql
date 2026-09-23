create or replace function public.mobile_gallery_orphan_thumbnail_paths(p_limit integer default 500)
returns table(path text)
language sql
security invoker
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'master-gallery-thumbnails'
    and not exists (
      select 1
      from alvorecer_private.mobile_gallery_items i
      join alvorecer_private.mobile_gallery_devices d
        on d.id = i.device_id
      where i.thumbnail_path = o.name
        and i.available
        and d.active
    )
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.mobile_gallery_orphan_thumbnail_paths(integer)
  from public, anon, authenticated;
grant execute on function public.mobile_gallery_orphan_thumbnail_paths(integer)
  to service_role;
