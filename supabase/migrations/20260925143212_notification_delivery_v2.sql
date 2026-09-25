create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (
    select 1 from vault.secrets
    where name = 'alvorecer_notification_push_hook_v1'
  ) then
    perform vault.create_secret(
      gen_random_uuid()::text || gen_random_uuid()::text,
      'alvorecer_notification_push_hook_v1'
    );
  end if;
end
$$;

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

create or replace function public.enrich_notification_content()
returns trigger
language plpgsql
security definer
set search_path to 'public'
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

create or replace function public.enqueue_notification_delivery()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  hook_token text;
  payload jsonb;
begin
  select decrypted_secret into hook_token
  from vault.decrypted_secrets
  where name = 'alvorecer_notification_push_hook_v1';

  if hook_token is null then return null; end if;

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

  if jsonb_array_length(payload) = 0 then return null; end if;

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
  when others then return null;
end
$$;

revoke all on function public.enqueue_notification_delivery()
  from public, anon, authenticated;

drop trigger if exists notifications_delivery_push on public.notifications;
create trigger notifications_delivery_push
after insert on public.notifications
referencing new table as new_notifications
for each statement
execute function public.enqueue_notification_delivery();
