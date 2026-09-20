
alter table public.community_profile_settings
  add column if not exists featured_title_ids uuid[]
  not null default array[null::uuid,null::uuid];

alter table public.cosmetics
  drop constraint if exists cosmetics_icon_check;

alter table public.cosmetics
  add constraint cosmetics_icon_check
  check (
    icon = any (
      array[
        'star'::text,'shield'::text,'crown'::text,'flame'::text,
        'moon'::text,'sword'::text,'sparkles'::text,'compass'::text,
        'book'::text,'eye'::text,'heart'::text,'leaf'::text,
        'sun'::text,'gem'::text,'feather'::text,'key'::text
      ]
    )
  );

alter table public.cosmetic_grants
  drop constraint if exists cosmetic_grants_origin_check;

alter table public.cosmetic_grants
  add constraint cosmetic_grants_origin_check
  check (
    origin = any (
      array[
        'session'::text,'achievement'::text,'event'::text,'gift'::text,
        'supporter'::text,'master'::text,'default'::text
      ]
    )
  );

create or replace function alvorecer_private.ensure_default_profile_titles(c uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  first_title uuid;
  second_title uuid;
begin
  select cosmetic.id
  into first_title
  from public.cosmetics cosmetic
  where cosmetic.campaign_id=c
    and cosmetic.kind='title'
    and cosmetic.name='Novo no mundo'
    and cosmetic.acquisition_origin='free'
    and cosmetic.display_order=-1000
  limit 1;

  if first_title is null then
    first_title:=gen_random_uuid();
    insert into public.cosmetics(
      id,campaign_id,kind,name,description,color,icon,active,
      rarity,acquisition_origin,visible,secret,display_order,updated_at
    )
    values(
      first_title,c,'title','Novo no mundo',
      'Título inicial de quem acabou de chegar ao mundo de Alvorecer.',
      '#D9B568','star',true,
      'common','free',true,false,-1000,now()
    );
  end if;

  select cosmetic.id
  into second_title
  from public.cosmetics cosmetic
  where cosmetic.campaign_id=c
    and cosmetic.kind='title'
    and cosmetic.name='Muda sem nome'
    and cosmetic.acquisition_origin='free'
    and cosmetic.display_order=-999
  limit 1;

  if second_title is null then
    second_title:=gen_random_uuid();
    insert into public.cosmetics(
      id,campaign_id,kind,name,description,color,icon,active,
      rarity,acquisition_origin,visible,secret,display_order,updated_at
    )
    values(
      second_title,c,'title','Muda sem nome',
      'Título inicial para quem ainda está construindo sua história.',
      '#C9C2B7','moon',true,
      'common','free',true,false,-999,now()
    );
  end if;

  insert into public.cosmetic_grants(
    identity_id,cosmetic_id,origin,note,created_at,
    granted_by,removed_at,removed_by
  )
  select
    identity.id,title.id,'default','Título inicial do perfil',
    now(),null,null,null
  from public.social_identities identity
  cross join lateral (
    values(first_title),(second_title)
  ) as title(id)
  where identity.campaign_id=c
    and identity.active
    and identity.kind in ('player','master')
  on conflict(identity_id,cosmetic_id) do update
    set removed_at=null,
        removed_by=null,
        origin='default',
        note='Título inicial do perfil';

  insert into public.community_profile_settings(
    identity_id,bio,featured_title_ids,updated_at
  )
  select
    identity.id,'',array[first_title,second_title],now()
  from public.social_identities identity
  where identity.campaign_id=c
    and identity.active
    and identity.kind in ('player','master')
  on conflict(identity_id) do nothing;

  update public.community_profile_settings settings
  set featured_title_ids=array[first_title,second_title],
      updated_at=now()
  from public.social_identities identity
  where identity.id=settings.identity_id
    and identity.campaign_id=c
    and identity.active
    and identity.kind in ('player','master')
    and (
      cardinality(settings.featured_title_ids)<>2
      or settings.featured_title_ids=array[null::uuid,null::uuid]
    );
end
$function$;

create or replace function alvorecer_private.sync_default_profile_titles_from_identity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.active and new.kind in ('player','master') then
    perform alvorecer_private.ensure_default_profile_titles(new.campaign_id);
  end if;
  return new;
end
$function$;

drop trigger if exists sync_default_profile_titles_from_identity
  on public.social_identities;

create trigger sync_default_profile_titles_from_identity
after insert or update of campaign_id,kind,active
on public.social_identities
for each row
execute function alvorecer_private.sync_default_profile_titles_from_identity();

create or replace function alvorecer_private.cleanup_featured_medal_reference()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.kind='medal' then
    update public.community_profile_settings settings
    set featured_medal_ids=array(
      select case
        when entry.cosmetic_id=old.id then null::uuid
        else entry.cosmetic_id
      end
      from unnest(settings.featured_medal_ids)
        with ordinality as entry(cosmetic_id,position)
      order by entry.position
    ),
    updated_at=now()
    where old.id=any(settings.featured_medal_ids);
  elsif old.kind='title' then
    update public.community_profile_settings settings
    set featured_title_ids=array(
      select case
        when entry.cosmetic_id=old.id then null::uuid
        else entry.cosmetic_id
      end
      from unnest(settings.featured_title_ids)
        with ordinality as entry(cosmetic_id,position)
      order by entry.position
    ),
    updated_at=now()
    where old.id=any(settings.featured_title_ids);
  end if;
  return old;
end
$function$;

create or replace function public.community_profile_collectibles(
  c uuid,
  requested_actor uuid,
  target_identity uuid
)
returns table(
  cosmetic_id uuid,
  kind text,
  equipped boolean,
  earned_at timestamptz,
  featured_slot integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  actor public.social_identities;
begin
  actor:=alvorecer_private.require_community_actor(c,requested_actor);

  if not exists(
    select 1
    from public.social_identities identity
    where identity.id=target_identity
      and identity.campaign_id=c
      and identity.active
  ) then
    raise exception 'Perfil indisponível';
  end if;

  return query
  select
    grant_row.cosmetic_id,
    cosmetic.kind,
    equipment.cosmetic_id is not null,
    grant_row.created_at,
    case
      when cosmetic.kind='medal' then array_position(
        coalesce(settings.featured_medal_ids,array[null::uuid,null::uuid,null::uuid]),
        grant_row.cosmetic_id
      )
      when cosmetic.kind='title' then array_position(
        coalesce(settings.featured_title_ids,array[null::uuid,null::uuid]),
        grant_row.cosmetic_id
      )
      else null
    end
  from public.cosmetic_grants grant_row
  join public.cosmetics cosmetic
    on cosmetic.id=grant_row.cosmetic_id
    and cosmetic.campaign_id=c
  left join public.cosmetic_equipment equipment
    on equipment.identity_id=grant_row.identity_id
    and equipment.kind=cosmetic.kind
    and equipment.cosmetic_id=grant_row.cosmetic_id
  left join public.community_profile_settings settings
    on settings.identity_id=grant_row.identity_id
  where grant_row.identity_id=target_identity
    and grant_row.removed_at is null
  order by
    case
      when cosmetic.kind='medal' then array_position(
        coalesce(settings.featured_medal_ids,array[null::uuid,null::uuid,null::uuid]),
        grant_row.cosmetic_id
      )
      when cosmetic.kind='title' then array_position(
        coalesce(settings.featured_title_ids,array[null::uuid,null::uuid]),
        grant_row.cosmetic_id
      )
      else null
    end nulls last,
    equipment.cosmetic_id is not null desc,
    grant_row.created_at desc;
end
$function$;

create or replace function public.community_profile_action(
  c uuid,
  op text,
  d jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.social_identities;
  target public.social_identities;
  content text;
  active boolean;
  medal_id uuid;
  medal_slot integer;
  title_id uuid;
  title_slot integer;
  featured uuid[];
  slot_index integer;
begin
  actor:=alvorecer_private.require_community_actor(c,(d->>'actor_id')::uuid);

  if op='bio' then
    content:=trim(coalesce(d->>'bio',''));
    if char_length(content)>240 then
      raise exception 'A bio aceita até 240 caracteres';
    end if;
    insert into public.community_profile_settings(identity_id,bio,updated_at)
    values(actor.id,content,now())
    on conflict(identity_id) do update
      set bio=excluded.bio,updated_at=excluded.updated_at;
    return jsonb_build_object('identity_id',actor.id,'bio',content);

  elsif op='featured_medal' then
    medal_slot:=coalesce((d->>'slot')::integer,0);
    medal_id:=nullif(d->>'medal_id','')::uuid;
    if medal_slot not between 1 and 3 then
      raise exception 'Posição da medalha inválida';
    end if;
    if medal_id is not null and not exists(
      select 1 from public.cosmetic_grants grant_row
      join public.cosmetics cosmetic on cosmetic.id=grant_row.cosmetic_id
      where grant_row.identity_id=actor.id
        and grant_row.cosmetic_id=medal_id
        and grant_row.removed_at is null
        and cosmetic.campaign_id=c
        and cosmetic.kind='medal'
        and cosmetic.active
        and cosmetic.archived_at is null
    ) then
      raise exception 'Você não possui esta medalha';
    end if;

    insert into public.community_profile_settings(
      identity_id,bio,featured_medal_ids,updated_at
    )
    values(actor.id,'',array[null::uuid,null::uuid,null::uuid],now())
    on conflict(identity_id) do nothing;

    select settings.featured_medal_ids into featured
    from public.community_profile_settings settings
    where settings.identity_id=actor.id
    for update;

    if cardinality(featured)<>3 then
      featured:=array[null::uuid,null::uuid,null::uuid];
    end if;

    if medal_id is not null then
      for slot_index in 1..3 loop
        if slot_index<>medal_slot and featured[slot_index]=medal_id then
          featured[slot_index]:=null;
        end if;
      end loop;
    end if;

    featured[medal_slot]:=medal_id;

    update public.community_profile_settings
    set featured_medal_ids=featured,updated_at=now()
    where identity_id=actor.id;

    return jsonb_build_object(
      'identity_id',actor.id,'slot',medal_slot,'medal_id',medal_id
    );

  elsif op='featured_title' then
    title_slot:=coalesce((d->>'slot')::integer,0);
    title_id:=nullif(d->>'title_id','')::uuid;

    if title_slot not between 1 and 2 then
      raise exception 'Posição do título inválida';
    end if;

    if title_id is not null and not exists(
      select 1 from public.cosmetic_grants grant_row
      join public.cosmetics cosmetic on cosmetic.id=grant_row.cosmetic_id
      where grant_row.identity_id=actor.id
        and grant_row.cosmetic_id=title_id
        and grant_row.removed_at is null
        and cosmetic.campaign_id=c
        and cosmetic.kind='title'
        and cosmetic.active
        and cosmetic.archived_at is null
    ) then
      raise exception 'Você não possui este título';
    end if;

    insert into public.community_profile_settings(
      identity_id,bio,featured_title_ids,updated_at
    )
    values(actor.id,'',array[null::uuid,null::uuid],now())
    on conflict(identity_id) do nothing;

    select settings.featured_title_ids into featured
    from public.community_profile_settings settings
    where settings.identity_id=actor.id
    for update;

    if cardinality(featured)<>2 then
      featured:=array[null::uuid,null::uuid];
    end if;

    if title_id is not null then
      for slot_index in 1..2 loop
        if slot_index<>title_slot and featured[slot_index]=title_id then
          featured[slot_index]:=null;
        end if;
      end loop;
    end if;

    featured[title_slot]:=title_id;

    update public.community_profile_settings
    set featured_title_ids=featured,updated_at=now()
    where identity_id=actor.id;

    return jsonb_build_object(
      'identity_id',actor.id,'slot',title_slot,'title_id',title_id
    );

  elsif op='follow' then
    select identity.* into target
    from public.social_identities identity
    where identity.id=(d->>'target_id')::uuid
      and identity.campaign_id=c
      and identity.active;

    if target.id is null or target.id=actor.id then
      raise exception 'Perfil inválido para seguir';
    end if;

    if actor.user_id is null then
      raise exception 'Escolha seu perfil principal para seguir';
    end if;

    delete from public.community_profile_follows
    where follower_identity_id=actor.id
      and followed_identity_id=target.id;

    if found then
      active:=false;
    else
      insert into public.community_profile_follows(
        follower_identity_id,followed_identity_id
      )
      values(actor.id,target.id);
      active:=true;
    end if;

    return jsonb_build_object('identity_id',target.id,'active',active);
  end if;

  raise exception 'Ação de perfil inválida';
end
$function$;

select alvorecer_private.ensure_default_profile_titles(campaign.id)
from public.campaigns campaign;

revoke all on function alvorecer_private.ensure_default_profile_titles(uuid)
  from public,anon,authenticated;
revoke all on function alvorecer_private.sync_default_profile_titles_from_identity()
  from public,anon,authenticated;

grant execute on function public.community_profile_action(uuid,text,jsonb)
  to authenticated,service_role;
grant execute on function public.community_profile_collectibles(uuid,uuid,uuid)
  to authenticated,service_role;
