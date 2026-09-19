create or replace function public.medal_action(c uuid, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  operation text := lower(coalesce(d->>'action','save'));
  result_id uuid;
  medal_name text;
  medal_description text;
  asset text;
  object_size bigint;
  target_identity_id uuid;
  target_user_id uuid;
begin
  if (select auth.uid()) is null or not public.is_master(c) then
    raise exception 'Somente o mestre pode administrar medalhas';
  end if;

  if operation = 'save' then
    medal_name := trim(coalesce(d->>'name',''));
    medal_description := trim(coalesce(d->>'description',''));
    asset := nullif(d->>'asset_path','');

    if char_length(medal_name) not between 1 and 100 then
      raise exception 'O título da medalha deve ter entre 1 e 100 caracteres';
    end if;

    if char_length(medal_description) > 200 then
      raise exception 'A descrição da medalha aceita no máximo 200 caracteres';
    end if;

    if asset is null
      or split_part(asset,'/',1) <> c::text
      or split_part(asset,'/',2) <> 'medals'
      or lower(storage.extension(asset)) <> 'png'
    then
      raise exception 'Arquivo de medalha inválido';
    end if;

    select coalesce((o.metadata->>'size')::bigint,0)
    into object_size
    from storage.objects o
    where o.bucket_id='avatar-frames'
      and o.name=asset;

    if not found then
      raise exception 'Arquivo de medalha não encontrado';
    end if;

    if object_size > 1048576 then
      raise exception 'A imagem da medalha deve ter no máximo 1 MB';
    end if;

    result_id := coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());

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
    where cosmetics.campaign_id=c
      and cosmetics.kind='medal';

    if not found then
      raise exception 'Medalha inválida';
    end if;

    perform public.record_event(
      c,
      null,
      'medal_save',
      jsonb_build_object('id',result_id)
    );

    return jsonb_build_object('id',result_id,'asset_path',asset);
  elsif operation = 'grant' then
    result_id := nullif(d->>'medal_id','')::uuid;
    target_identity_id := nullif(d->>'identity_id','')::uuid;

    if result_id is null or target_identity_id is null then
      raise exception 'Selecione uma medalha e um jogador';
    end if;

    if not exists(
      select 1
      from public.cosmetics medal
      where medal.id=result_id
        and medal.campaign_id=c
        and medal.kind='medal'
        and medal.active
        and medal.archived_at is null
    ) then
      raise exception 'Medalha indisponível';
    end if;

    select identity.user_id
    into target_user_id
    from public.social_identities identity
    join public.campaign_members member
      on member.campaign_id=identity.campaign_id
      and member.user_id=identity.user_id
    where identity.id=target_identity_id
      and identity.campaign_id=c
      and identity.kind='player'
      and identity.active
      and identity.user_id is not null
      and member.role='player'
      and member.access_active
      and member.archived_at is null;

    if not found then
      raise exception 'Jogador inválido';
    end if;

    if exists(
      select 1
      from public.cosmetic_grants grant_row
      where grant_row.identity_id=target_identity_id
        and grant_row.cosmetic_id=result_id
        and grant_row.removed_at is null
    ) then
      raise exception 'Este jogador já possui esta medalha';
    end if;

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
    values(
      target_identity_id,
      result_id,
      'gift',
      'Medalha enviada pelo mestre',
      now(),
      (select auth.uid()),
      null,
      null
    )
    on conflict(identity_id,cosmetic_id) do update
      set origin='gift',
          note='Medalha enviada pelo mestre',
          created_at=now(),
          granted_by=(select auth.uid()),
          removed_at=null,
          removed_by=null;

    insert into public.notifications(
      campaign_id,
      user_id,
      kind,
      title,
      body,
      reference_id
    )
    values(
      c,
      target_user_id,
      'cosmetic',
      'Parabéns pela sua nova medalha.',
      'Uma nova medalha foi adicionada à sua coleção.',
      result_id::text
    );

    perform public.record_event(
      c,
      null,
      'medal_grant',
      jsonb_build_object(
        'id',result_id,
        'identity_id',target_identity_id,
        'user_id',target_user_id
      )
    );

    return jsonb_build_object(
      'id',result_id,
      'identity_id',target_identity_id,
      'user_id',target_user_id
    );
  elsif operation = 'delete' then
    result_id := nullif(d->>'medal_id','')::uuid;

    if result_id is null then
      raise exception 'Medalha inválida';
    end if;

    select medal.asset_path
    into asset
    from public.cosmetics medal
    where medal.id=result_id
      and medal.campaign_id=c
      and medal.kind='medal';

    if not found then
      raise exception 'Medalha inválida';
    end if;

    if asset is not null and exists(
      select 1
      from public.cosmetics other
      where other.id<>result_id
        and other.asset_path=asset
    ) then
      asset := null;
    end if;

    delete from public.notifications
    where campaign_id=c
      and kind='cosmetic'
      and reference_id=result_id::text;

    delete from public.cosmetic_equipment
    where cosmetic_id=result_id;

    delete from public.cosmetic_grants
    where cosmetic_id=result_id;

    delete from public.cosmetics
    where id=result_id
      and campaign_id=c
      and kind='medal';

    if not found then
      raise exception 'Medalha inválida';
    end if;

    perform public.record_event(
      c,
      null,
      'medal_delete',
      jsonb_build_object('id',result_id)
    );

    return jsonb_build_object('id',result_id,'asset_path',asset);
  else
    raise exception 'Operação de medalha inválida';
  end if;
end
$function$;

revoke all on function public.medal_action(uuid,jsonb) from public;
revoke all on function public.medal_action(uuid,jsonb) from anon;
grant execute on function public.medal_action(uuid,jsonb) to authenticated;
