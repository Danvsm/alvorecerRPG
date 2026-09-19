alter table public.community_profile_settings
  add column if not exists featured_medal_ids uuid[] not null
  default array[null::uuid,null::uuid,null::uuid];

update public.community_profile_settings
set featured_medal_ids=array[null::uuid,null::uuid,null::uuid]
where cardinality(featured_medal_ids)<>3;

drop function if exists public.community_profile_collectibles(uuid,uuid,uuid);

create function public.community_profile_collectibles(
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
set search_path=public
as $$
declare actor public.social_identities;
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
      when cosmetic.kind='medal'
      then array_position(
        coalesce(
          settings.featured_medal_ids,
          array[null::uuid,null::uuid,null::uuid]
        ),
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
      when cosmetic.kind='medal'
      then array_position(
        coalesce(
          settings.featured_medal_ids,
          array[null::uuid,null::uuid,null::uuid]
        ),
        grant_row.cosmetic_id
      )
      else null
    end nulls last,
    equipment.cosmetic_id is not null desc,
    grant_row.created_at desc;
end
$$;

revoke all on function public.community_profile_collectibles(uuid,uuid,uuid)
  from public,anon;
grant execute on function public.community_profile_collectibles(uuid,uuid,uuid)
  to authenticated,service_role;

create or replace function public.community_profile_action(c uuid,op text,d jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare actor public.social_identities;
declare target public.social_identities;
declare content text;
declare active boolean;
declare medal_id uuid;
declare medal_slot integer;
declare featured uuid[];
declare slot_index integer;
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
      select 1
      from public.cosmetic_grants grant_row
      join public.cosmetics cosmetic
        on cosmetic.id=grant_row.cosmetic_id
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
    values(
      actor.id,'',array[null::uuid,null::uuid,null::uuid],now()
    )
    on conflict(identity_id) do nothing;

    select settings.featured_medal_ids
    into featured
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
    set featured_medal_ids=featured,
        updated_at=now()
    where identity_id=actor.id;

    return jsonb_build_object(
      'identity_id',actor.id,
      'slot',medal_slot,
      'medal_id',medal_id
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
      ) values(actor.id,target.id);
      active:=true;
    end if;

    return jsonb_build_object('identity_id',target.id,'active',active);
  end if;

  raise exception 'Ação de perfil inválida';
end
$$;

revoke all on function public.community_profile_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_profile_action(uuid,text,jsonb)
  to authenticated,service_role;

create or replace function alvorecer_private.cleanup_featured_medal_reference()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.kind='medal' then
    update public.community_profile_settings settings
    set featured_medal_ids=array(
      select case
        when entry.medal_id=old.id then null::uuid
        else entry.medal_id
      end
      from unnest(settings.featured_medal_ids)
        with ordinality as entry(medal_id,position)
      order by entry.position
    ),
    updated_at=now()
    where old.id=any(settings.featured_medal_ids);
  end if;
  return old;
end
$$;

revoke all on function alvorecer_private.cleanup_featured_medal_reference()
  from public,anon,authenticated;

drop trigger if exists cleanup_featured_medal_reference
  on public.cosmetics;

create trigger cleanup_featured_medal_reference
before delete on public.cosmetics
for each row
execute function alvorecer_private.cleanup_featured_medal_reference();
