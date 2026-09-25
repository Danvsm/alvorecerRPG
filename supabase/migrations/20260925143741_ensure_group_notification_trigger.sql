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
  select group_chat.* into target_group
  from public.campaign_group_chats group_chat
  where group_chat.id = new.group_id;
  if target_group.id is null then return new; end if;

  select identity.* into sender
  from public.social_identities identity
  where identity.id = new.sender_id
    and identity.campaign_id = target_group.campaign_id
    and identity.active;
  if sender.id is null then return new; end if;

  insert into public.notifications(
    campaign_id,user_id,kind,title,body,reference_id
  )
  select
    target_group.campaign_id,
    member.user_id,
    'message',
    left(target_group.name,100),
    left(coalesce(nullif(sender.name,''),'Alguém') || ': ' || new.body,500),
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

drop trigger if exists campaign_group_message_notify
  on public.campaign_group_messages;
create trigger campaign_group_message_notify
after insert on public.campaign_group_messages
for each row
execute function public.notify_campaign_group_message();
