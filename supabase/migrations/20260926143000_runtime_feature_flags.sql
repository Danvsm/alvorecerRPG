create table if not exists public.runtime_feature_flags (
  feature_key text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint runtime_feature_flags_known_key
    check (feature_key in ('mobile_gallery', 'media_cleanup'))
);

alter table public.runtime_feature_flags enable row level security;
revoke all on table public.runtime_feature_flags from public, anon, authenticated;

insert into public.runtime_feature_flags(feature_key, enabled)
values ('mobile_gallery', true), ('media_cleanup', true)
on conflict (feature_key) do nothing;

create or replace function public.set_runtime_feature(
  p_feature_key text,
  p_enabled boolean,
  p_updated_by uuid default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_feature_key not in ('mobile_gallery', 'media_cleanup') then
    raise exception 'unknown feature';
  end if;

  insert into public.runtime_feature_flags(feature_key, enabled, updated_at, updated_by)
  values (p_feature_key, p_enabled, now(), p_updated_by)
  on conflict (feature_key) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  if p_feature_key = 'media_cleanup' then
    update cron.job
      set active = p_enabled
      where jobname = 'alvorecer-chat-media-cleanup';
  end if;
end;
$$;

revoke all on function public.set_runtime_feature(text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.set_runtime_feature(text, boolean, uuid)
  to service_role;
