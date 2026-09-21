create or replace function public.master_archive_delete(
  c uuid,
  item_type text,
  target_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_call public.direct_calls;
  target_post public.community_posts;
  target_media public.chat_media;
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode excluir itens dos arquivos';
  end if;

  if item_type='call' then
    select call.* into target_call
    from public.direct_calls call
    where call.id=target_id
      and call.campaign_id=c
      and call.status in ('ended','declined','cancelled','missed','failed')
    for update;

    if target_call.id is null then
      raise exception 'Chamada arquivada não encontrada';
    end if;

    delete from public.direct_calls
    where id=target_call.id;

    return jsonb_build_object(
      'deleted',true,
      'type','call',
      'id',target_call.id
    );

  elsif item_type='post' then
    select post.* into target_post
    from public.community_posts post
    where post.id=target_id
      and post.campaign_id=c
      and post.archived_at is not null
    for update;

    if target_post.id is null then
      raise exception 'Publicação arquivada não encontrada';
    end if;

    delete from public.community_posts
    where id=target_post.id;

    return jsonb_strip_nulls(jsonb_build_object(
      'deleted',true,
      'type','post',
      'id',target_post.id,
      'image_path',target_post.image_path
    ));

  elsif item_type='chat_media' then
    select media.* into target_media
    from public.chat_media media
    where media.id=target_id
      and media.consumed=true
      and media.deleted_at is null
      and exists(
        select 1
        from public.direct_conversations conversation
        where conversation.id=media.conversation_id
          and conversation.campaign_id=c
      )
    for update;

    if target_media.id is null then
      raise exception 'Mídia arquivada não encontrada';
    end if;

    update public.chat_media
    set archive_expires_at=least(archive_expires_at,now()),
        expires_at=least(expires_at,now()),
        removed_from_chat_at=coalesce(removed_from_chat_at,now())
    where id=target_media.id;

    return jsonb_build_object(
      'deleted',true,
      'type','chat_media',
      'id',target_media.id,
      'storage_path',target_media.storage_path
    );

  else
    raise exception 'Tipo de arquivo inválido';
  end if;
end
$function$;

revoke all on function public.master_archive_delete(uuid,text,uuid)
  from public,anon;
grant execute on function public.master_archive_delete(uuid,text,uuid)
  to authenticated;
