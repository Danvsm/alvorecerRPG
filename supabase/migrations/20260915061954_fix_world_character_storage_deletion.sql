drop function if exists public.delete_world_character(uuid,uuid);

create function public.prepare_delete_world_character(
  c uuid,
  target_id uuid,
  actor uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target social_identities;
  conversation_ids uuid[];
  storage_paths jsonb;
begin
  if not exists(
    select 1 from campaign_members
    where campaign_id=c
      and user_id=actor
      and role='master'
      and access_active
      and archived_at is null
  ) then
    raise exception 'Somente Pink';
  end if;

  select * into target
  from social_identities
  where id=target_id and campaign_id=c
  for update;

  if target.id is null or target.kind<>'npc' or target.user_id is not null then
    raise exception 'Personagem do mundo inválido';
  end if;

  select coalesce(array_agg(id),array[]::uuid[]) into conversation_ids
  from direct_conversations
  where campaign_id=c and target.id in(first_id,second_id);

  select coalesce(jsonb_agg(storage_path order by storage_path),'[]'::jsonb)
  into storage_paths
  from (
    select distinct storage_path
    from chat_media
    where conversation_id=any(conversation_ids) or sender_id=target.id
  ) media;

  return jsonb_build_object(
    'id',target.id,
    'name',target.name,
    'storage_paths',storage_paths
  );
end
$$;

create function public.finalize_delete_world_character(
  c uuid,
  target_id uuid,
  actor uuid
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target social_identities;
  conversation_ids uuid[];
begin
  if not exists(
    select 1 from campaign_members
    where campaign_id=c
      and user_id=actor
      and role='master'
      and access_active
      and archived_at is null
  ) then
    raise exception 'Somente Pink';
  end if;

  select * into target
  from social_identities
  where id=target_id and campaign_id=c
  for update;

  if target.id is null or target.kind<>'npc' or target.user_id is not null then
    raise exception 'Personagem do mundo inválido';
  end if;

  select coalesce(array_agg(id),array[]::uuid[]) into conversation_ids
  from direct_conversations
  where campaign_id=c and target.id in(first_id,second_id);

  delete from notifications
  where campaign_id=c
    and kind='message'
    and reference_id in(select unnest(conversation_ids)::text);

  delete from direct_messages
  where conversation_id=any(conversation_ids) or sender_id=target.id;

  delete from chat_media
  where conversation_id=any(conversation_ids) or sender_id=target.id;

  delete from conversation_reads
  where conversation_id=any(conversation_ids) or identity_id=target.id;

  delete from direct_conversations where id=any(conversation_ids);
  delete from profile_comments where profile_id=target.id or author_id=target.id;
  delete from cosmetic_equipment where identity_id=target.id;
  delete from cosmetic_grants where identity_id=target.id;
  delete from social_identities where id=target.id;

  perform record_event(
    c,
    null,
    'identity_npc_delete',
    jsonb_build_object('id',target.id,'name',target.name),
    actor
  );

  return jsonb_build_object('id',target.id,'deleted',true);
end
$$;

revoke all on function public.prepare_delete_world_character(uuid,uuid,uuid)
  from public,anon,authenticated;
revoke all on function public.finalize_delete_world_character(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.prepare_delete_world_character(uuid,uuid,uuid)
  to service_role;
grant execute on function public.finalize_delete_world_character(uuid,uuid,uuid)
  to service_role;
