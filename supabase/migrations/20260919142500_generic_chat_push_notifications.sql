create or replace function public.social_action(c uuid, op text, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor social_identities;
  recipient social_identities;
  conversation direct_conversations;
  result_id uuid;
  message_text text;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;

  if op='moderate' then
    if not is_master(c) then raise exception 'Somente Pink'; end if;
    update profile_comments
    set hidden=coalesce((d->>'hidden')::boolean,true)
    where id=(d->>'id')::uuid and campaign_id=c
    returning id into result_id;
    if result_id is null then raise exception 'Comentário não encontrado'; end if;
  else
    select * into actor
    from social_identities
    where id=(d->>'actor_id')::uuid and campaign_id=c and active;

    if actor.id is null
       or (
         actor.user_id is distinct from auth.uid()
         and not (is_master(c) and actor.kind='npc')
       ) then
      raise exception 'Identidade não autorizada';
    end if;

    if op in('comment','conversation') then
      select * into recipient
      from social_identities
      where id=(d->>'recipient_id')::uuid and campaign_id=c and active;

      if recipient.id is null then raise exception 'Perfil indisponível'; end if;

      if op='comment' then
        insert into profile_comments(campaign_id,profile_id,author_id,body)
        values(c,recipient.id,actor.id,trim(d->>'body'))
        returning id into result_id;
      else
        if actor.id=recipient.id then raise exception 'Selecione outro destinatário'; end if;
        insert into direct_conversations(campaign_id,first_id,second_id)
        values(c,least(actor.id,recipient.id),greatest(actor.id,recipient.id))
        on conflict(first_id,second_id)
        do update set campaign_id=excluded.campaign_id
        returning id into result_id;
      end if;
    elsif op in('message','read') then
      select * into conversation
      from direct_conversations
      where id=(d->>'conversation_id')::uuid and campaign_id=c;

      if conversation.id is null
         or actor.id not in(conversation.first_id,conversation.second_id) then
        raise exception 'Conversa não autorizada';
      end if;

      result_id:=conversation.id;

      if op='read' then
        insert into conversation_reads(conversation_id,identity_id)
        values(conversation.id,actor.id)
        on conflict(conversation_id,identity_id)
        do update set read_at=now();
      else
        message_text:=trim(d->>'body');
        insert into direct_messages(conversation_id,sender_id,body)
        values(conversation.id,actor.id,message_text)
        returning id into result_id;

        select * into recipient
        from social_identities
        where id=case
          when actor.id=conversation.first_id then conversation.second_id
          else conversation.first_id
        end;

        if recipient.user_id is not null and recipient.active then
          insert into notifications(
            campaign_id,user_id,kind,title,body,reference_id
          )
          values(
            c,
            recipient.user_id,
            'message',
            'Olha quem te mandou mensagem 👀',
            'Você recebeu uma nova mensagem. Entre no Alvorecer para ver quem foi.',
            conversation.id::text
          );
        end if;
      end if;
    else
      raise exception 'Operação inválida';
    end if;
  end if;

  if op<>'read' then
    perform record_event(
      c,null,'social_'||op,jsonb_build_object('id',result_id)
    );
  end if;

  return jsonb_build_object('id',result_id);
end
$function$;

create or replace function public.chat_media_action(c uuid, op text, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor social_identities;
  conversation direct_conversations;
  media chat_media;
  new_id uuid;
  recipient uuid;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;

  select * into actor
  from social_identities
  where id=(d->>'actor_id')::uuid and campaign_id=c and active;

  if actor.id is null
     or (
       actor.user_id is distinct from auth.uid()
       and not (actor.kind='npc' and is_master(c))
     ) then
    raise exception 'Identidade não autorizada';
  end if;

  if op='reserve' then
    select * into conversation
    from direct_conversations
    where id=(d->>'conversation_id')::uuid and campaign_id=c;

    if conversation.id is null
       or actor.id not in(conversation.first_id,conversation.second_id) then
      raise exception 'Conversa não autorizada';
    end if;

    if not throttle('chat_upload:'||auth.uid()::text,30) then
      raise exception 'Limite temporário de imagens atingido';
    end if;

    new_id:=gen_random_uuid();
    insert into chat_media(
      id,conversation_id,sender_id,uploader_id,storage_path
    )
    values(
      new_id,
      conversation.id,
      actor.id,
      auth.uid(),
      conversation.id::text||'/'||new_id::text||'.webp'
    )
    returning * into media;

  elsif op='send' then
    select * into media
    from chat_media
    where id=(d->>'media_id')::uuid
    for update;

    if media.id is null
       or media.sender_id<>actor.id
       or media.uploader_id<>auth.uid()
       or media.expires_at<=now()
       or media.deleted_at is not null
       or not can_converse(media.conversation_id) then
      raise exception 'Imagem indisponível';
    end if;

    if media.consumed then
      select id into new_id
      from direct_messages
      where media_id=media.id;
      return jsonb_build_object('id',new_id);
    end if;

    if not exists(
      select 1
      from storage.objects
      where bucket_id='chat-media' and name=media.storage_path
    ) then
      raise exception 'Envio da imagem incompleto';
    end if;

    insert into direct_messages(conversation_id,sender_id,body,media_id)
    values(media.conversation_id,actor.id,'',media.id)
    returning id into new_id;

    update chat_media set consumed=true where id=media.id;

    select * into conversation
    from direct_conversations
    where id=media.conversation_id;

    select user_id into recipient
    from social_identities
    where id=case
      when conversation.first_id=actor.id then conversation.second_id
      else conversation.first_id
    end;

    if recipient is not null then
      insert into notifications(
        campaign_id,user_id,kind,title,body,reference_id
      )
      values(
        c,
        recipient,
        'message',
        'Olha quem te mandou mensagem 👀',
        'Você recebeu uma nova mensagem. Entre no Alvorecer para ver quem foi.',
        conversation.id::text
      );
    end if;

    perform record_event(
      c,null,'social_image',jsonb_build_object('id',new_id)
    );
  else
    raise exception 'Operação inválida';
  end if;

  return jsonb_build_object('id',media.id,'path',media.storage_path);
end
$function$;
