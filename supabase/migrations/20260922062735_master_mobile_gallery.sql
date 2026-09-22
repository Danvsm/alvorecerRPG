-- Private Android media index used only by Pink/Mestre and an authorized device.
create table alvorecer_private.mobile_gallery_devices (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  master_user_id uuid not null references auth.users(id) on delete cascade,
  installation_id text not null,
  device_name text not null check(char_length(device_name) between 1 and 80),
  token_hash text not null unique,
  fcm_token text,
  active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, master_user_id, installation_id)
);

create table alvorecer_private.mobile_gallery_items (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references alvorecer_private.mobile_gallery_devices(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  local_media_id text not null,
  display_name text not null,
  mime_type text not null check(mime_type like 'image/%' or mime_type like 'video/%'),
  byte_size bigint not null check(byte_size >= 0),
  modified_at bigint not null,
  duration_ms bigint not null default 0 check(duration_ms >= 0),
  width integer not null default 0 check(width >= 0),
  height integer not null default 0 check(height >= 0),
  thumbnail_path text not null,
  available boolean not null default true,
  indexed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(device_id, local_media_id)
);

create table alvorecer_private.mobile_gallery_requests (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  device_id uuid not null references alvorecer_private.mobile_gallery_devices(id) on delete cascade,
  item_id uuid not null references alvorecer_private.mobile_gallery_items(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'requested' check(status in ('requested','uploading','ready','unavailable','expired','failed')),
  original_path text,
  error_message text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index mobile_gallery_one_active_request
  on alvorecer_private.mobile_gallery_requests(item_id)
  where status in ('requested','uploading','ready');
create index mobile_gallery_devices_campaign_idx
  on alvorecer_private.mobile_gallery_devices(campaign_id, active, last_seen_at desc);
create index mobile_gallery_items_campaign_idx
  on alvorecer_private.mobile_gallery_items(campaign_id, available, modified_at desc);
create index mobile_gallery_requests_device_idx
  on alvorecer_private.mobile_gallery_requests(device_id, status, requested_at);

alter table alvorecer_private.mobile_gallery_devices enable row level security;
alter table alvorecer_private.mobile_gallery_items enable row level security;
alter table alvorecer_private.mobile_gallery_requests enable row level security;
revoke all on alvorecer_private.mobile_gallery_devices from public, anon, authenticated;
revoke all on alvorecer_private.mobile_gallery_items from public, anon, authenticated;
revoke all on alvorecer_private.mobile_gallery_requests from public, anon, authenticated;
grant all on alvorecer_private.mobile_gallery_devices to service_role;
grant all on alvorecer_private.mobile_gallery_items to service_role;
grant all on alvorecer_private.mobile_gallery_requests to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values
  ('master-gallery-thumbnails', 'master-gallery-thumbnails', false, 131072, array['image/webp']),
  ('master-gallery-originals', 'master-gallery-originals', false, 536870912, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- No client Storage policies are created. Every operation is mediated by the
-- Edge Function after validating either the Mestre session or the device token.
