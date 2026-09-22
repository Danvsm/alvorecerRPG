create table if not exists alvorecer_private.mobile_gallery_allowed_accounts (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

alter table alvorecer_private.mobile_gallery_allowed_accounts enable row level security;
revoke all on alvorecer_private.mobile_gallery_allowed_accounts from public, anon, authenticated;
grant all on alvorecer_private.mobile_gallery_allowed_accounts to service_role;
