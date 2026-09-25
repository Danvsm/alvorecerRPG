create or replace function public.campaign_group_action(
  c uuid,
  actor_id uuid,
  op text,
  message_body text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor public.social_identities;
  target_group uuid;
  result_id uuid;
  clean_body text;
begin
  actor:=alvorecer_private.require_group_actor(c,actor_id);
  target_group:=alvorecer_private.ensure_campaign_group(c);

  if op='read' then
    insert into public.campaign_group_reads(group_id,identity_id,read_at)
    values(target_group,actor.id,now())
    on conflict(group_id,identity_id)
    do update set read_at=excluded.read_at;
    return jsonb_build_object('id',target_group);
  elsif op='message' then
    clean_body:=trim(coalesce(message_body,''));
    if char_length(clean_body) not between 1 and 4000 then
      raise exception 'Mensagem inválida';
    end if;

    insert into public.campaign_group_messages(group_id,sender_id,body)
    values(target_group,actor.id,clean_body)
    returning id into result_id;

    insert into public.campaign_group_reads(group_id,identity_id,read_at)
    values(target_group,actor.id,now())
    on conflict(group_id,identity_id)
    do update set read_at=excluded.read_at;

    insert into public.notifications(
      campaign_id,user_id,kind,title,body,reference_id
    )
    select
      c,
      member.user_id,
      'message',
      'Bar do Pink',
      left(coalesce(nullif(actor.name,''),'Alguém') || ': ' || clean_body,500),
      'group:' || target_group::text || ':' || actor.id::text
    from public.campaign_members member
    where member.campaign_id=c
      and member.access_active
      and member.archived_at is null
      and member.user_id<>auth.uid();

    perform public.record_event(
      c,null,'social_group_message',jsonb_build_object('id',result_id)
    );
    return jsonb_build_object('id',result_id,'group_id',target_group);
  end if;

  raise exception 'Operação inválida';
end
$function$;
