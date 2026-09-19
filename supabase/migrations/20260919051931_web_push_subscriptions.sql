create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_user_campaign_idx
  on public.push_subscriptions(user_id, campaign_id);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to service_role;

create or replace function public.server_push_vapid_private()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'alvorecer_web_push_vapid_private_v1'
$$;

revoke all on function public.server_push_vapid_private() from public;
revoke all on function public.server_push_vapid_private() from anon;
revoke all on function public.server_push_vapid_private() from authenticated;
grant execute on function public.server_push_vapid_private() to service_role;

drop policy if exists notification_master_insert on public.notifications;
revoke insert on table public.notifications from authenticated;
revoke execute on function public.send_master_notification(uuid, uuid[], text, text, text)
  from public, anon, authenticated;
