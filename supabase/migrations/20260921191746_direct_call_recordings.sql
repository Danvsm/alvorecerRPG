create table if not exists public.direct_call_recordings(
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null unique references public.direct_calls(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  recorder_id uuid not null references public.social_identities(id),
  storage_path text not null unique,
  mime_type text not null
    check(mime_type in ('audio/webm','audio/ogg','audio/mp4')),
  duration_ms integer
    check(duration_ms is null or duration_ms between 250 and 14400000),
  byte_size bigint
    check(byte_size is null or byte_size between 1 and 52428800),
  upload_expires_at timestamptz not null default (now()+interval '30 minutes'),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists direct_call_recordings_campaign_idx
  on public.direct_call_recordings(campaign_id,created_at desc);
create index if not exists direct_call_recordings_recorder_idx
  on public.direct_call_recordings(recorder_id,created_at desc);

alter table public.direct_call_recordings enable row level security;
revoke all on public.direct_call_recordings from public,anon,authenticated;
grant all on public.direct_call_recordings to service_role;

drop policy if exists direct_call_recordings_no_direct_access
  on public.direct_call_recordings;
create policy direct_call_recordings_no_direct_access
  on public.direct_call_recordings
  for all
  to authenticated
  using(false)
  with check(false);

create table if not exists public.direct_call_recording_cleanup(
  storage_path text primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  queued_at timestamptz not null default now()
);

create index if not exists direct_call_recording_cleanup_queued_idx
  on public.direct_call_recording_cleanup(queued_at);
create index if not exists direct_call_recording_cleanup_campaign_idx
  on public.direct_call_recording_cleanup(campaign_id);

alter table public.direct_call_recording_cleanup enable row level security;
revoke all on public.direct_call_recording_cleanup from public,anon,authenticated;
grant all on public.direct_call_recording_cleanup to service_role;

drop policy if exists direct_call_recording_cleanup_no_direct_access
  on public.direct_call_recording_cleanup;
create policy direct_call_recording_cleanup_no_direct_access
  on public.direct_call_recording_cleanup
  for all
  to authenticated
  using(false)
  with check(false);

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'call-recordings',
  'call-recordings',
  false,
  52428800,
  array['audio/webm','audio/ogg','audio/mp4']
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

create or replace function alvorecer_private.can_upload_call_recording(path text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.direct_call_recordings recording
    join public.social_identities recorder on recorder.id=recording.recorder_id
    where recording.storage_path=path
      and recording.finalized_at is null
      and recording.upload_expires_at>now()
      and recorder.user_id=(select auth.uid())
  )
$$;

create or replace function alvorecer_private.can_read_call_recording(path text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.direct_call_recordings recording
    where recording.storage_path=path
      and recording.finalized_at is not null
      and public.is_master(recording.campaign_id)
  )
$$;

revoke all on function alvorecer_private.can_upload_call_recording(text)
  from public,anon,authenticated;
revoke all on function alvorecer_private.can_read_call_recording(text)
  from public,anon,authenticated;
grant execute on function alvorecer_private.can_upload_call_recording(text)
  to authenticated,service_role;
grant execute on function alvorecer_private.can_read_call_recording(text)
  to authenticated,service_role;

drop policy if exists call_recording_insert on storage.objects;
create policy call_recording_insert
on storage.objects
for insert
to authenticated
with check(
  bucket_id='call-recordings'
  and (select alvorecer_private.can_upload_call_recording(storage.objects.name))
);

drop policy if exists call_recording_read on storage.objects;
create policy call_recording_read
on storage.objects
for select
to authenticated
using(
  bucket_id='call-recordings'
  and (select alvorecer_private.can_read_call_recording(storage.objects.name))
);

create or replace function alvorecer_private.queue_direct_call_recording()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.direct_call_recording_cleanup(storage_path,campaign_id)
  values(old.storage_path,old.campaign_id)
  on conflict(storage_path) do update set queued_at=now();
  return old;
end
$$;

revoke all on function alvorecer_private.queue_direct_call_recording()
  from public,anon,authenticated;

drop trigger if exists direct_call_recording_queue_cleanup
  on public.direct_call_recordings;
create trigger direct_call_recording_queue_cleanup
after delete on public.direct_call_recordings
for each row execute function alvorecer_private.queue_direct_call_recording();

create or replace function public.direct_call_recording_reserve(
  c uuid,
  actor_id uuid,
  call_id uuid,
  requested_mime text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  call_row public.direct_calls;
  recording public.direct_call_recordings;
  extension text;
  new_id uuid;
begin
  actor:=alvorecer_private.require_call_actor(c,actor_id);

  select call.* into call_row
  from public.direct_calls call
  where call.id=call_id and call.campaign_id=c
  for update;

  if call_row.id is null
     or actor.id<>call_row.caller_id
     or call_row.status<>'active'
     or call_row.answered_at is null then
    raise exception 'A chamada não pode ser gravada';
  end if;

  if requested_mime not in ('audio/webm','audio/ogg','audio/mp4') then
    raise exception 'Formato de gravação inválido';
  end if;

  select existing.* into recording
  from public.direct_call_recordings existing
  where existing.call_id=call_row.id
  for update;

  if recording.id is not null and recording.finalized_at is not null then
    return jsonb_build_object(
      'id',recording.id,
      'path',recording.storage_path,
      'mime_type',recording.mime_type,
      'ready',true
    );
  end if;

  if recording.id is not null and recording.upload_expires_at<=now() then
    delete from public.direct_call_recordings where id=recording.id;
    recording:=null;
  end if;

  if recording.id is not null then
    return jsonb_build_object(
      'id',recording.id,
      'path',recording.storage_path,
      'mime_type',recording.mime_type,
      'ready',false
    );
  end if;

  extension:=case requested_mime
    when 'audio/webm' then 'webm'
    when 'audio/ogg' then 'ogg'
    else 'm4a'
  end;

  new_id:=gen_random_uuid();

  insert into public.direct_call_recordings(
    id,call_id,campaign_id,recorder_id,storage_path,mime_type
  )
  values(
    new_id,
    call_row.id,
    c,
    actor.id,
    c::text||'/'||call_row.id::text||'/'||new_id::text||'.'||extension,
    requested_mime
  )
  returning * into recording;

  return jsonb_build_object(
    'id',recording.id,
    'path',recording.storage_path,
    'mime_type',recording.mime_type,
    'ready',false
  );
end
$$;

revoke all on function public.direct_call_recording_reserve(uuid,uuid,uuid,text)
  from public,anon;
grant execute on function public.direct_call_recording_reserve(uuid,uuid,uuid,text)
  to authenticated;

create or replace function public.direct_call_recording_finalize(
  c uuid,
  actor_id uuid,
  call_id uuid,
  recording_id uuid,
  claimed_duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.social_identities;
  call_row public.direct_calls;
  recording public.direct_call_recordings;
  object_size bigint;
  object_mime text;
  maximum_duration_ms bigint;
begin
  actor:=alvorecer_private.require_call_actor(c,actor_id);

  select call.* into call_row
  from public.direct_calls call
  where call.id=call_id and call.campaign_id=c;

  if call_row.id is null
     or actor.id<>call_row.caller_id
     or call_row.answered_at is null then
    raise exception 'Chamada inválida para gravação';
  end if;

  select candidate.* into recording
  from public.direct_call_recordings candidate
  where candidate.id=recording_id
    and candidate.call_id=call_row.id
    and candidate.campaign_id=c
    and candidate.recorder_id=actor.id
  for update;

  if recording.id is null then
    raise exception 'Gravação não encontrada';
  end if;

  if recording.finalized_at is not null then
    return jsonb_build_object(
      'id',recording.id,
      'duration_ms',recording.duration_ms,
      'byte_size',recording.byte_size
    );
  end if;

  if recording.upload_expires_at<=now() then
    raise exception 'Envio da gravação expirou';
  end if;

  if claimed_duration_ms not between 250 and 14400000 then
    raise exception 'Duração da gravação inválida';
  end if;

  maximum_duration_ms:=
    floor(
      extract(epoch from (coalesce(call_row.ended_at,now())-call_row.answered_at))
      * 1000
    )::bigint + 15000;

  if claimed_duration_ms::bigint>maximum_duration_ms then
    raise exception 'Duração da gravação incompatível com a chamada';
  end if;

  select
    coalesce((object.metadata->>'size')::bigint,0),
    lower(coalesce(object.metadata->>'mimetype',''))
  into object_size,object_mime
  from storage.objects object
  where object.bucket_id='call-recordings'
    and object.name=recording.storage_path;

  if object_size is null or object_size<1 or object_size>52428800 then
    raise exception 'Arquivo da gravação inválido';
  end if;

  if object_mime<>recording.mime_type then
    raise exception 'Formato da gravação não corresponde ao arquivo';
  end if;

  update public.direct_call_recordings
  set duration_ms=claimed_duration_ms,
      byte_size=object_size,
      finalized_at=now()
  where id=recording.id
  returning * into recording;

  return jsonb_build_object(
    'id',recording.id,
    'duration_ms',recording.duration_ms,
    'byte_size',recording.byte_size
  );
end
$$;

revoke all on function public.direct_call_recording_finalize(
  uuid,uuid,uuid,uuid,integer
) from public,anon;
grant execute on function public.direct_call_recording_finalize(
  uuid,uuid,uuid,uuid,integer
) to authenticated;

drop function if exists public.master_direct_call_archive(uuid);

create function public.master_direct_call_archive(c uuid)
returns table(
  id uuid,
  conversation_id uuid,
  caller_id uuid,
  caller_name text,
  callee_id uuid,
  callee_name text,
  status text,
  created_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  ended_by_name text,
  failure_reason text,
  duration_seconds integer,
  recording_id uuid,
  recording_storage_path text,
  recording_mime_type text,
  recording_duration_ms integer,
  recording_byte_size bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode acessar o arquivo de chamadas';
  end if;

  return query
  select
    call.id,
    call.conversation_id,
    call.caller_id,
    caller.name,
    call.callee_id,
    callee.name,
    call.status,
    call.created_at,
    call.answered_at,
    call.ended_at,
    call.ended_by,
    ended_identity.name,
    call.failure_reason,
    case
      when call.answered_at is null or call.ended_at is null then 0
      else greatest(
        0,
        floor(extract(epoch from (call.ended_at-call.answered_at)))::integer
      )
    end,
    recording.id,
    recording.storage_path,
    recording.mime_type,
    recording.duration_ms,
    recording.byte_size
  from public.direct_calls call
  join public.social_identities caller on caller.id=call.caller_id
  join public.social_identities callee on callee.id=call.callee_id
  left join public.social_identities ended_identity on ended_identity.id=call.ended_by
  left join public.direct_call_recordings recording
    on recording.call_id=call.id
   and recording.finalized_at is not null
  where call.campaign_id=c
    and call.status in ('ended','declined','cancelled','missed','failed')
  order by coalesce(call.ended_at,call.created_at) desc,call.id desc
  limit 200;
end
$function$;

revoke all on function public.master_direct_call_archive(uuid)
  from public,anon;
grant execute on function public.master_direct_call_archive(uuid)
  to authenticated;
