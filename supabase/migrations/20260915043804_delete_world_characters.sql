create function public.delete_world_character(c uuid, target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target social_identities;
  conversation_ids uuid[];
begin
  if not is_member(c) then
    raise exception 'Sem permissão';
  end if;
  if not is_master(c) then
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

  delete from storage.objects object
  using chat_media media
  where object.bucket_id='chat-media'
    and object.name=media.storage_path
    and (media.conversation_id=any(conversation_ids) or media.sender_id=target.id);

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
    jsonb_build_object('id',target.id,'name',target.name)
  );

  return jsonb_build_object('id',target.id,'deleted',true);
end
$$;

revoke all on function public.delete_world_character(uuid,uuid) from public,anon;
grant execute on function public.delete_world_character(uuid,uuid) to authenticated,service_role;
