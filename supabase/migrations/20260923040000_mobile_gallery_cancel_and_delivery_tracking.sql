alter table alvorecer_private.mobile_gallery_requests
  drop constraint if exists mobile_gallery_requests_status_check;

alter table alvorecer_private.mobile_gallery_requests
  add constraint mobile_gallery_requests_status_check
  check (status = any (array[
    'requested'::text,
    'uploading'::text,
    'ready'::text,
    'unavailable'::text,
    'expired'::text,
    'failed'::text,
    'cancelled'::text
  ]));

alter table alvorecer_private.mobile_gallery_requests
  add column if not exists device_polled_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

create or replace function public.mobile_gallery_mark_polled(p_ids uuid[])
returns void
language sql
set search_path = ''
as $$
  update alvorecer_private.mobile_gallery_requests
  set device_polled_at = now(),
      attempt_count = attempt_count + 1,
      updated_at = now()
  where id = any(p_ids)
    and status in ('requested', 'uploading');
$$;

revoke all on function public.mobile_gallery_mark_polled(uuid[])
  from public, anon, authenticated;
grant execute on function public.mobile_gallery_mark_polled(uuid[])
  to service_role;

notify pgrst, 'reload schema';
