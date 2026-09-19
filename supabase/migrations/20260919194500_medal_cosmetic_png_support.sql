drop policy if exists frame_asset_insert on storage.objects;

create policy frame_asset_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id='avatar-frames'
  and (
    (
      (storage.foldername(name))[2]='frames'
      and storage.extension(name)=any(array['webp','png'])
    )
    or (
      (storage.foldername(name))[2]='medals'
      and storage.extension(name)='png'
    )
  )
  and exists (
    select 1
    from public.campaign_members m
    where m.user_id=(select auth.uid())
      and m.role='master'
      and m.access_active
      and m.archived_at is null
      and m.campaign_id::text=(storage.foldername(objects.name))[1]
  )
);

create or replace function alvorecer_private.can_read_frame_asset(asset text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists(
    select 1
    from public.cosmetics c
    where c.kind in ('frame','medal')
      and c.asset_path=asset
      and public.is_member(c.campaign_id)
      and (
        public.is_master(c.campaign_id)
        or (
          c.active
          and c.archived_at is null
          and (
            exists(
              select 1
              from public.cosmetic_equipment e
              join public.social_identities i on i.id=e.identity_id
              where e.cosmetic_id=c.id
                and i.campaign_id=c.campaign_id
                and i.active
            )
            or (
              c.visible
              and (
                not c.secret
                or exists(
                  select 1
                  from public.cosmetic_grants g
                  join public.social_identities i on i.id=g.identity_id
                  where g.cosmetic_id=c.id
                    and g.removed_at is null
                    and i.user_id=(select auth.uid())
                )
              )
            )
          )
        )
      )
  )
$function$;

create or replace function public.medal_action(c uuid, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  result_id uuid;
  medal_name text;
  medal_description text;
  asset text;
  object_size bigint;
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode administrar medalhas';
  end if;

  medal_name:=trim(coalesce(d->>'name',''));
  medal_description:=trim(coalesce(d->>'description',''));
  asset:=nullif(d->>'asset_path','');

  if char_length(medal_name) not between 1 and 100 then
    raise exception 'O título da medalha deve ter entre 1 e 100 caracteres';
  end if;
  if char_length(medal_description)>200 then
    raise exception 'A descrição da medalha aceita no máximo 200 caracteres';
  end if;

  if asset is null
    or split_part(asset,'/',1)<>c::text
    or split_part(asset,'/',2)<>'medals'
    or lower(storage.extension(asset))<>'png'
  then
    raise exception 'Arquivo de medalha inválido';
  end if;

  select coalesce((o.metadata->>'size')::bigint,0)
  into object_size
  from storage.objects o
  where o.bucket_id='avatar-frames' and o.name=asset;

  if not found then raise exception 'Arquivo de medalha não encontrado'; end if;
  if object_size>1048576 then
    raise exception 'A imagem da medalha deve ter no máximo 1 MB';
  end if;

  result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());

  if exists(
    select 1
    from public.cosmetics existing
    where existing.id=result_id
      and (existing.campaign_id<>c or existing.kind<>'medal')
  ) then
    raise exception 'Medalha inválida';
  end if;

  insert into public.cosmetics(
    id,campaign_id,kind,name,description,color,icon,active,asset_path,
    rarity,acquisition_origin,visible,secret,updated_at
  )
  values(
    result_id,c,'medal',medal_name,medal_description,'#D9B568','star',true,asset,
    'common','manual',true,false,now()
  )
  on conflict(id) do update
    set name=excluded.name,
        description=excluded.description,
        asset_path=excluded.asset_path,
        active=true,
        updated_at=now()
  where cosmetics.campaign_id=c and cosmetics.kind='medal';

  if not found then raise exception 'Medalha inválida'; end if;

  perform public.record_event(c,null,'medal_save',jsonb_build_object('id',result_id));
  return jsonb_build_object('id',result_id,'asset_path',asset);
end
$function$;

revoke all on function public.medal_action(uuid,jsonb) from public;
revoke all on function public.medal_action(uuid,jsonb) from anon;
grant execute on function public.medal_action(uuid,jsonb) to authenticated;
