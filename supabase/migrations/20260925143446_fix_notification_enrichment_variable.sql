create or replace function public.enrich_notification_content()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conversation_id uuid;
  latest_message public.direct_messages;
  sender public.social_identities;
  media public.chat_media;
  actor_name text;
begin
  if new.kind = 'message'
     and coalesce(new.reference_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_conversation_id := new.reference_id::uuid;

    select message.* into latest_message
    from public.direct_messages message
    join public.direct_conversations conversation
      on conversation.id = message.conversation_id
    where message.conversation_id = v_conversation_id
      and conversation.campaign_id = new.campaign_id
      and message.deleted_at is null
      and message.cleared_at is null
    order by message.created_at desc, message.id desc
    limit 1;

    if latest_message.id is not null then
      select identity.* into sender
      from public.social_identities identity
      where identity.id = latest_message.sender_id
        and identity.campaign_id = new.campaign_id
      limit 1;

      if latest_message.media_id is not null then
        select candidate.* into media
        from public.chat_media candidate
        where candidate.id = latest_message.media_id
        limit 1;
      end if;

      new.title := left(coalesce(nullif(sender.name, ''), 'Nova mensagem'), 100);
      new.body := left(
        case
          when latest_message.media_id is null
            then coalesce(nullif(trim(latest_message.body), ''), 'Nova mensagem')
          when media.media_type = 'audio' then '🎙️ Áudio'
          when media.view_once then '📸 Foto de visualização única'
          else '📷 Foto'
        end,
        500
      );
      new.reference_id :=
        'chat:' || v_conversation_id::text || ':' || latest_message.sender_id::text;
    end if;
  elsif new.kind = 'mention' then
    actor_name := nullif(trim(split_part(coalesce(new.title, ''), ' mencionou ', 1)), '');
    if actor_name is not null then
      new.title := left(actor_name || ' marcou você', 100);
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.enrich_notification_content()
  from public, anon, authenticated;
