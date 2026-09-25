create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'alvorecer_notification_push_hook_v1'
  ) then
    perform vault.create_secret(
      gen_random_uuid()::text || gen_random_uuid()::text,
      'alvorecer_notification_push_hook_v1'
    );
  end if;
end
$$;

create or replace function public.enrich_notification_content()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  conversation_id uuid;
  latest_message public.direct_messages;
  sender public.social_identities;
  media public.chat_media;
  actor_name text;
begin
  if new.kind = 'message'
     and coalesce(new.reference_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    conversation_id := new.reference_id::uuid;

    select message.*
      into latest_message
    from public.direct_messages message
    join public.direct_conversations conversation
      on conversation.id = message.conversation_id
    where message.conversation_id = conversation_id
      and conversation.campaign_id = new.campaign_id
      and message.deleted_at is null
      and message.cleared_at is null
    order by message.created_at desc, message.id desc
    limit 1;

    if latest_message.id is not null then
      select identity.*
        into sender
      from public.social_identities identity
      where identity.id = latest_message.sender_id
        and identity.campaign_id = new.campaign_id
      limit 1;

      if latest_message.media_id is not null then
        select candidate.*
          into media
        from public.chat_media candidate
        where candidate.id = latest_message.media_id
        limit 1;
      end if;

      new.title := left(coalesce(nullif(sender.name, ''), 'Nova mensagem'), 100);
      new.body := left(
        case
          when latest_message.media_id is null
            then coalesce(nullif(trim(latest_message.body), ''), 'Nova mensagem')
          when media.media_type = 'audio'
            then '🎙️ Áudio'
          when media.view_once
            then '📸 Foto de visualização única'
          else '📷 Foto'
        end,
        500
      );
      new.reference_id :=
        'chat:' || conversation_id::text || ':' || latest_message.sender_id::text;
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

drop trigger if exists notifications_enrich_content on public.notifications;
create trigger notifications_enrich_content
before insert on public.notifications
for each row
execute function public.enrich_notification_content();

create or replace function public.notify_campaign_group_message()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_group public.campaign_group_chats;
  sender public.social_identities;
begin
  select group_chat.*
    into target_group
  from public.campaign_group_chats group_chat
  where group_chat.id = new.group_id;

  if target_group.id is null then
    return new;
  end if;

  select identity.*
    into sender
  from public.social_identities identity
  where identity.id = new.sender_id
    and identity.campaign_id = target_group.campaign_id
    and identity.active;

  if sender.id is null then
    return new;
  end if;

  insert into public.notifications(
    campaign_id,
    user_id,
    kind,
    title,
    body,
    reference_id
  )
  select
    target_group.campaign_id,
    member.user_id,
    'message',
    left(target_group.name, 100),
    left(coalesce(nullif(sender.name, ''), 'Alguém') || ': ' || new.body, 500),
    'group:' || target_group.id::text || ':' || sender.id::text
  from public.campaign_members member
  where member.campaign_id = target_group.campaign_id
    and member.access_active
    and member.archived_at is null
    and member.user_id is distinct from sender.user_id;

  return new;
end
$$;

revoke all on function public.notify_campaign_group_message()
  from public, anon, authenticated;

drop trigger if exists campaign_group_message_notify on public.campaign_group_messages;
create trigger campaign_group_message_notify
after insert on public.campaign_group_messages
for each row
execute function public.notify_campaign_group_message();

create or replace function public.verify_notification_push_hook(token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    length(coalesce(token, '')) > 40
    and exists(
      select 1
      from vault.decrypted_secrets
      where name = 'alvorecer_notification_push_hook_v1'
        and decrypted_secret = token
    )
$$;

revoke all on function public.verify_notification_push_hook(text)
  from public, anon, authenticated;
grant execute on function public.verify_notification_push_hook(text)
  to service_role;

create or replace function public.notification_android_devices(
  p_campaign_id uuid,
  p_user_ids uuid[]
)
returns table(
  device_id uuid,
  user_id uuid,
  fcm_token text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (d.fcm_token)
    d.id as device_id,
    d.master_user_id as user_id,
    d.fcm_token
  from alvorecer_private.mobile_gallery_devices d
  where d.campaign_id = p_campaign_id
    and d.master_user_id = any(p_user_ids)
    and d.active
    and nullif(trim(d.fcm_token), '') is not null
  order by d.fcm_token, d.last_seen_at desc nulls last
$$;

revoke all on function public.notification_android_devices(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.notification_android_devices(uuid, uuid[])
  to service_role;

create or replace function public.enqueue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hook_token text;
  payload jsonb;
begin
  select decrypted_secret
    into hook_token
  from vault.decrypted_secrets
  where name = 'alvorecer_notification_push_hook_v1';

  if hook_token is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', n.id,
        'campaign_id', n.campaign_id,
        'user_id', n.user_id,
        'kind', n.kind,
        'title', n.title,
        'body', n.body,
        'reference_id', n.reference_id
      )
      order by n.id
    ),
    '[]'::jsonb
  )
  into payload
  from new_notifications n;

  if jsonb_array_length(payload) = 0 then
    return null;
  end if;

  perform net.http_post(
    url := 'https://wsihnbrnqdnmidjvjchn.supabase.co/functions/v1/alvorecer-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notification-hook-token', hook_token
    ),
    body := jsonb_build_object(
      'action', 'notifications_created',
      'notifications', payload
    ),
    timeout_milliseconds := 5000
  );

  return null;
exception
  when others then
    return null;
end
$$;

revoke all on function public.enqueue_notification_delivery()
  from public, anon, authenticated;

drop trigger if exists notifications_native_push on public.notifications;
drop trigger if exists notifications_delivery_push on public.notifications;

create trigger notifications_delivery_push
after insert on public.notifications
referencing new table as new_notifications
for each statement
execute function public.enqueue_notification_delivery();
