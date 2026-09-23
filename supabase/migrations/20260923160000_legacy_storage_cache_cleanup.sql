create or replace function public.legacy_storage_cache_paths(p_limit integer default 25)
returns table(bucket_id text, path text, mime_type text)
language sql
security invoker
set search_path = ''
as $$
  select
    o.bucket_id,
    o.name as path,
    coalesce(o.metadata->>'mimetype', 'application/octet-stream') as mime_type
  from storage.objects o
  where o.bucket_id in ('portraits', 'item-media', 'avatar-frames')
    and coalesce(o.metadata->>'cacheControl', '') <> 'max-age=31536000'
  order by o.bucket_id, o.name
  limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.legacy_storage_cache_paths(integer)
  from public, anon, authenticated;
grant execute on function public.legacy_storage_cache_paths(integer)
  to service_role;
