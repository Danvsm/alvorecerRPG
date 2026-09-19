alter table public.cosmetic_grants
  drop constraint if exists cosmetic_grants_origin_check;

alter table public.cosmetic_grants
  add constraint cosmetic_grants_origin_check
  check (
    origin=any(array[
      'session'::text,
      'achievement'::text,
      'event'::text,
      'gift'::text,
      'supporter'::text,
      'master'::text
    ])
  );

create or replace function alvorecer_private.ensure_master_cosmetic_access(c uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
begin
  insert into public.cosmetic_grants(
    identity_id,
    cosmetic_id,
    origin,
    note,
    created_at,
    granted_by,
    removed_at,
    removed_by
  )
  select
    identity.id,
    cosmetic.id,
    'master',
    'Acesso universal do Mestre',
    now(),
    null,
    null,
    null
  from public.social_identities identity
  join public.campaign_members member
    on member.campaign_id=identity.campaign_id
    and member.user_id=identity.user_id
    and member.role='master'
    and member.access_active
    and member.archived_at is null
  join public.cosmetics cosmetic
    on cosmetic.campaign_id=identity.campaign_id
    and cosmetic.kind in ('frame','medal')
  where identity.campaign_id=c
    and identity.kind='master'
    and identity.active
  on conflict(identity_id,cosmetic_id) do update
    set removed_at=null,
        removed_by=null;
end
$function$;

revoke all on function alvorecer_private.ensure_master_cosmetic_access(uuid)
  from public,anon,authenticated;

create or replace function alvorecer_private.sync_master_cosmetic_access_from_cosmetic()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if new.kind in ('frame','medal') then
    perform alvorecer_private.ensure_master_cosmetic_access(new.campaign_id);
  end if;
  return new;
end
$function$;

revoke all on function alvorecer_private.sync_master_cosmetic_access_from_cosmetic()
  from public,anon,authenticated;

drop trigger if exists sync_master_cosmetic_access_from_cosmetic
  on public.cosmetics;

create trigger sync_master_cosmetic_access_from_cosmetic
after insert or update of campaign_id,kind
on public.cosmetics
for each row
execute function alvorecer_private.sync_master_cosmetic_access_from_cosmetic();

create or replace function alvorecer_private.sync_master_cosmetic_access_from_identity()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if new.kind='master' and new.active then
    perform alvorecer_private.ensure_master_cosmetic_access(new.campaign_id);
  end if;
  return new;
end
$function$;

revoke all on function alvorecer_private.sync_master_cosmetic_access_from_identity()
  from public,anon,authenticated;

drop trigger if exists sync_master_cosmetic_access_from_identity
  on public.social_identities;

create trigger sync_master_cosmetic_access_from_identity
after insert or update of campaign_id,user_id,kind,active
on public.social_identities
for each row
execute function alvorecer_private.sync_master_cosmetic_access_from_identity();

create or replace function alvorecer_private.sync_master_cosmetic_access_from_member()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if new.role='master' and new.access_active and new.archived_at is null then
    perform alvorecer_private.ensure_master_cosmetic_access(new.campaign_id);
  end if;
  return new;
end
$function$;

revoke all on function alvorecer_private.sync_master_cosmetic_access_from_member()
  from public,anon,authenticated;

drop trigger if exists sync_master_cosmetic_access_from_member
  on public.campaign_members;

create trigger sync_master_cosmetic_access_from_member
after insert or update of campaign_id,user_id,role,access_active,archived_at
on public.campaign_members
for each row
execute function alvorecer_private.sync_master_cosmetic_access_from_member();

do $patch_frame_action$
declare
  definition text;
  original text;
begin
  select pg_get_functiondef(p.oid)
  into definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='frame_action'
    and p.oid::regprocedure::text='frame_action(uuid,text,jsonb)';

  if definition is null then
    raise exception 'frame_action não encontrada';
  end if;

  original:=definition;

  definition:=replace(
    definition,
    'if f.exclusive_identity_id is not null and f.exclusive_identity_id<>target.id then raise exception ''Moldura exclusiva de outro jogador''; end if;',
    'if target.kind<>''master'' and f.exclusive_identity_id is not null and f.exclusive_identity_id<>target.id then raise exception ''Moldura exclusiva de outro jogador''; end if;'
  );

  definition:=replace(
    definition,
    'if exists(select 1 from cosmetic_grants where cosmetic_id=result_id) then',
    'if exists(select 1 from cosmetic_grants where cosmetic_id=result_id and origin<>''master'') then'
  );

  definition:=replace(
    definition,
    'delete from cosmetics where id=result_id;',
    'delete from cosmetic_grants where cosmetic_id=result_id and origin=''master''; delete from cosmetics where id=result_id;'
  );

  if definition=original
    or position('target.kind<>''master'' and f.exclusive_identity_id' in definition)=0
    or position('origin<>''master''' in definition)=0
  then
    raise exception 'Não foi possível aplicar a regra universal do Mestre em frame_action';
  end if;

  execute definition;
end
$patch_frame_action$;

do $backfill$
declare
  campaign_record record;
begin
  for campaign_record in
    select distinct identity.campaign_id
    from public.social_identities identity
    join public.campaign_members member
      on member.campaign_id=identity.campaign_id
      and member.user_id=identity.user_id
      and member.role='master'
      and member.access_active
      and member.archived_at is null
    where identity.kind='master'
      and identity.active
  loop
    perform alvorecer_private.ensure_master_cosmetic_access(
      campaign_record.campaign_id
    );
  end loop;
end
$backfill$;
