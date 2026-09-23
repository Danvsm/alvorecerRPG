create table if not exists alvorecer_private.mobile_capture_defaults (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  flag_secure_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists alvorecer_private.mobile_capture_account_settings (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  flag_secure_enabled boolean not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

alter table alvorecer_private.mobile_capture_defaults enable row level security;
alter table alvorecer_private.mobile_capture_account_settings enable row level security;

revoke all on alvorecer_private.mobile_capture_defaults from public, anon, authenticated;
revoke all on alvorecer_private.mobile_capture_account_settings from public, anon, authenticated;

create or replace function public.mobile_capture_read(p_campaign_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'default_enabled',
    coalesce(
      (select d.flag_secure_enabled
       from alvorecer_private.mobile_capture_defaults d
       where d.campaign_id = p_campaign_id),
      true
    ),
    'overrides',
    coalesce(
      (select jsonb_object_agg(s.user_id::text, s.flag_secure_enabled)
       from alvorecer_private.mobile_capture_account_settings s
       where s.campaign_id = p_campaign_id),
      '{}'::jsonb
    )
  );
$$;

create or replace function public.mobile_capture_resolve(p_campaign_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.flag_secure_enabled
     from alvorecer_private.mobile_capture_account_settings s
     where s.campaign_id = p_campaign_id and s.user_id = p_user_id),
    (select d.flag_secure_enabled
     from alvorecer_private.mobile_capture_defaults d
     where d.campaign_id = p_campaign_id),
    true
  );
$$;

create or replace function public.mobile_capture_set_default(
  p_campaign_id uuid, p_enabled boolean, p_updated_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into alvorecer_private.mobile_capture_defaults (
    campaign_id, flag_secure_enabled, updated_by, updated_at
  )
  values (p_campaign_id, p_enabled, p_updated_by, now())
  on conflict (campaign_id) do update
    set flag_secure_enabled = excluded.flag_secure_enabled,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

create or replace function public.mobile_capture_set_account(
  p_campaign_id uuid, p_user_id uuid, p_enabled boolean, p_updated_by uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.campaign_members m
    where m.campaign_id = p_campaign_id
      and m.user_id = p_user_id
      and m.access_active
      and m.archived_at is null
  ) then
    raise exception 'Conta ativa não encontrada na campanha';
  end if;

  insert into alvorecer_private.mobile_capture_account_settings (
    campaign_id, user_id, flag_secure_enabled, updated_by, updated_at
  )
  values (p_campaign_id, p_user_id, p_enabled, p_updated_by, now())
  on conflict (campaign_id, user_id) do update
    set flag_secure_enabled = excluded.flag_secure_enabled,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

create or replace function public.mobile_capture_clear_account(p_campaign_id uuid, p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from alvorecer_private.mobile_capture_account_settings
  where campaign_id = p_campaign_id and user_id = p_user_id;
$$;

revoke all on function public.mobile_capture_read(uuid) from public, anon, authenticated;
revoke all on function public.mobile_capture_resolve(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mobile_capture_set_default(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.mobile_capture_set_account(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.mobile_capture_clear_account(uuid, uuid) from public, anon, authenticated;

grant execute on function public.mobile_capture_read(uuid) to service_role;
grant execute on function public.mobile_capture_resolve(uuid, uuid) to service_role;
grant execute on function public.mobile_capture_set_default(uuid, boolean, uuid) to service_role;
grant execute on function public.mobile_capture_set_account(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.mobile_capture_clear_account(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
