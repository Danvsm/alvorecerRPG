alter table public.chat_media
  add column if not exists view_once boolean not null default false,
  add column if not exists view_once_opened_at timestamptz,
  add column if not exists view_once_expires_at timestamptz;

create index if not exists chat_media_view_once_expiry_idx
  on public.chat_media(view_once_expires_at)
  where view_once and deleted_at is null;

update public.chat_media
set archive_expires_at=greatest(
  archive_expires_at,
  created_at + interval '72 hours'
)
where view_once
  and deleted_at is null;


create or replace function public.community_presence_detail(c uuid)
returns table(
  user_id uuid,
  online boolean,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, alvorecer_private
as $$
begin
  if not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  return query
  select
    member.user_id,
    exists(
      select 1
      from alvorecer_private.presence_sessions session
      where session.campaign_id=c
        and session.user_id=member.user_id
        and session.ended_at is null
        and session.last_heartbeat_at>now()-interval '2 minutes'
    ) as online,
    (
      select max(coalesce(session.ended_at,session.last_heartbeat_at))
      from alvorecer_private.presence_sessions session
      where session.campaign_id=c
        and session.user_id=member.user_id
    ) as last_seen_at
  from public.campaign_members member
  where member.campaign_id=c
    and member.access_active
    and member.archived_at is null
    and exists(
      select 1
      from public.social_identities identity
      where identity.campaign_id=c
        and identity.user_id=member.user_id
        and identity.active
    )
  order by member.user_id;
end
$$;

revoke all on function public.community_presence_detail(uuid) from public, anon;
grant execute on function public.community_presence_detail(uuid)
  to authenticated, service_role;

create or replace function public.chat_media_action(c uuid,op text,d jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor social_identities;
  conversation direct_conversations;
  media chat_media;
  new_id uuid;
  recipient uuid;
  deadline timestamptz;
  remaining_seconds integer;
begin
  if not is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select *
  into actor
  from social_identities
  where id=(d->>'actor_id')::uuid
    and campaign_id=c
    and active;

  if actor.id is null
     or (
       actor.user_id is distinct from auth.uid()
       and not (actor.kind='npc' and is_master(c))
     ) then
    raise exception 'Identidade não autorizada';
  end if;

  if op='reserve' then
    select *
    into conversation
    from direct_conversations
    where id=(d->>'conversation_id')::uuid
      and campaign_id=c;

    if conversation.id is null
       or actor.id not in(conversation.first_id,conversation.second_id) then
      raise exception 'Conversa não autorizada';
    end if;

    if not throttle('chat_upload:'||auth.uid()::text,30) then
      raise exception 'Limite temporário de imagens atingido';
    end if;

    new_id:=gen_random_uuid();

    insert into chat_media(
      id,
      conversation_id,
      sender_id,
      uploader_id,
      storage_path,
      view_once
    )
    values(
      new_id,
      conversation.id,
      actor.id,
      auth.uid(),
      conversation.id::text||'/'||new_id::text||'.webp',
      coalesce((d->>'view_once')::boolean,false)
    )
    returning * into media;

  elsif op='send' then
    select *
    into media
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
      select id
      into new_id
      from direct_messages
      where media_id=media.id;

      return jsonb_build_object('id',new_id);
    end if;

    if not exists(
      select 1
      from storage.objects
      where bucket_id='chat-media'
        and name=media.storage_path
    ) then
      raise exception 'Envio da imagem incompleto';
    end if;

    insert into direct_messages(conversation_id,sender_id,body,media_id)
    values(media.conversation_id,actor.id,'',media.id)
    returning id into new_id;

    update chat_media
    set consumed=true
    where id=media.id;

    select *
    into conversation
    from direct_conversations
    where id=media.conversation_id;

    select user_id
    into recipient
    from social_identities
    where id=case
      when conversation.first_id=actor.id then conversation.second_id
      else conversation.first_id
    end;

    if recipient is not null
       and not exists (
         select 1
         from conversation_mutes mute
         where mute.conversation_id=conversation.id
           and mute.user_id=recipient
       ) then
      insert into notifications(
        campaign_id,
        user_id,
        kind,
        title,
        body,
        reference_id
      )
      values(
        c,
        recipient,
        'message',
        'Olha quem te mandou mensagem 👀',
        'Entre no Alvorecer para ver quem foi.',
        conversation.id::text
      );
    end if;

    perform record_event(
      c,
      null,
      case when media.view_once then 'social_view_once_image' else 'social_image' end,
      jsonb_build_object('id',new_id)
    );

  elsif op='open_once' then
    select *
    into media
    from chat_media
    where id=(d->>'media_id')::uuid
    for update;

    if media.id is null
       or not media.view_once
       or media.media_type<>'image' then
      raise exception 'Foto de visualização única indisponível';
    end if;

    select *
    into conversation
    from direct_conversations
    where id=media.conversation_id
      and campaign_id=c;

    if conversation.id is null
       or actor.id not in(conversation.first_id,conversation.second_id)
       or actor.id=media.sender_id then
      raise exception 'Somente o destinatário pode abrir esta foto';
    end if;

    if media.deleted_at is not null
       or media.removed_from_chat_at is not null
       or media.expires_at<=now()
       or (
         media.view_once_expires_at is not null
         and media.view_once_expires_at<=now()
       ) then
      update chat_media
      set removed_from_chat_at=coalesce(removed_from_chat_at,now()),
          expires_at=least(expires_at,now())
      where id=media.id;

      return jsonb_build_object('expired',true);
    end if;

    if media.view_once_opened_at is null then
      deadline:=now()+interval '7 seconds';
      update chat_media
      set view_once_opened_at=now(),
          view_once_expires_at=deadline,
          expires_at=least(expires_at,deadline)
      where id=media.id
      returning * into media;
    end if;

    deadline:=media.view_once_expires_at;
    remaining_seconds:=greatest(
      1,
      ceil(extract(epoch from (deadline-now())))::integer
    );

    return jsonb_build_object(
      'expired',false,
      'path',media.storage_path,
      'seconds',remaining_seconds
    );

  elsif op='consume_once' then
    select *
    into media
    from chat_media
    where id=(d->>'media_id')::uuid
    for update;

    if media.id is null or not media.view_once then
      return jsonb_build_object('expired',true);
    end if;

    select *
    into conversation
    from direct_conversations
    where id=media.conversation_id
      and campaign_id=c;

    if conversation.id is null
       or actor.id not in(conversation.first_id,conversation.second_id)
       or actor.id=media.sender_id then
      raise exception 'Sem permissão';
    end if;

    update chat_media
    set removed_from_chat_at=coalesce(removed_from_chat_at,now()),
        expires_at=least(expires_at,now()),
        archive_expires_at=least(archive_expires_at,now()),
        view_once_expires_at=coalesce(view_once_expires_at,now())
    where id=media.id;

    return jsonb_build_object('expired',true);

  else
    raise exception 'Operação inválida';
  end if;

  return jsonb_build_object(
    'id',media.id,
    'path',media.storage_path,
    'view_once',media.view_once
  );
end
$$;

revoke all on function public.chat_media_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.chat_media_action(uuid,text,jsonb)
  to authenticated,service_role;

drop policy if exists chat_image_read on storage.objects;

create policy chat_image_read
on storage.objects
for select
to authenticated
using (
  bucket_id='chat-media'
  and exists (
    select 1
    from public.chat_media media
    join public.direct_conversations conversation
      on conversation.id=media.conversation_id
    where media.storage_path=storage.objects.name
      and media.deleted_at is null
      and (
        (
          not media.view_once
          and media.removed_from_chat_at is null
          and media.expires_at>now()
          and public.can_converse(media.conversation_id)
        )
        or (
          media.view_once
          and media.removed_from_chat_at is null
          and media.view_once_opened_at is not null
          and media.view_once_expires_at>now()
          and exists(
            select 1
            from public.social_identities viewer
            where viewer.user_id=auth.uid()
              and viewer.active
              and viewer.id in(conversation.first_id,conversation.second_id)
              and viewer.id<>media.sender_id
          )
        )
        or (
          media.archive_expires_at>now()
          and public.is_master(conversation.campaign_id)
        )
      )
  )
);

create or replace function public.master_chat_media_archive(c uuid)
returns table(
  id uuid,
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_name text,
  first_name text,
  second_name text,
  storage_path text,
  created_at timestamptz,
  chat_expires_at timestamptz,
  archive_expires_at timestamptz,
  removed_from_chat_at timestamptz,
  message_deleted_at timestamptz,
  message_cleared_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_master(c) then
    raise exception 'Somente o mestre pode acessar o arquivo de fotos';
  end if;

  return query
  select
    media.id,
    message.id,
    media.conversation_id,
    media.sender_id,
    sender.name,
    first_identity.name,
    second_identity.name,
    media.storage_path,
    media.created_at,
    media.expires_at,
    media.archive_expires_at,
    media.removed_from_chat_at,
    message.deleted_at,
    message.cleared_at
  from public.chat_media media
  join public.direct_messages message on message.media_id=media.id
  join public.direct_conversations conversation
    on conversation.id=media.conversation_id
  join public.social_identities sender on sender.id=media.sender_id
  join public.social_identities first_identity
    on first_identity.id=conversation.first_id
  join public.social_identities second_identity
    on second_identity.id=conversation.second_id
  where conversation.campaign_id=c
    and media.media_type='image'
    and media.consumed=true
    and media.deleted_at is null
    and media.archive_expires_at>now()
  order by media.created_at desc,media.id desc
  limit 200;
end
$$;

revoke all on function public.master_chat_media_archive(uuid) from public;
revoke all on function public.master_chat_media_archive(uuid) from anon;
grant execute on function public.master_chat_media_archive(uuid) to authenticated;
