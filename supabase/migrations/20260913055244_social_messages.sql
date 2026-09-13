create table public.profile_comments(
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references campaigns,
  profile_id uuid not null references social_identities,
  author_id uuid not null references social_identities,
  body text not null check(length(trim(body)) between 1 and 2000),
  hidden boolean not null default false, created_at timestamptz not null default now()
);
create index profile_comments_profile_date_idx on profile_comments(profile_id,created_at desc);
create index profile_comments_author_idx on profile_comments(author_id);
create index profile_comments_campaign_idx on profile_comments(campaign_id);
create table public.direct_conversations(
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references campaigns,
  first_id uuid not null references social_identities, second_id uuid not null references social_identities,
  created_at timestamptz not null default now(), check(first_id<second_id), unique(first_id,second_id)
);
create index direct_conversations_second_idx on direct_conversations(second_id);
create index direct_conversations_campaign_idx on direct_conversations(campaign_id);
create table public.direct_messages(
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references direct_conversations,
  sender_id uuid not null references social_identities,
  body text not null check(length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index direct_messages_conversation_date_idx on direct_messages(conversation_id,created_at desc);
create index direct_messages_sender_idx on direct_messages(sender_id);
create table public.conversation_reads(
  conversation_id uuid not null references direct_conversations, identity_id uuid not null references social_identities,
  read_at timestamptz not null default now(), primary key(conversation_id,identity_id)
);
create index conversation_reads_identity_idx on conversation_reads(identity_id);

create function public.can_converse(target uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from direct_conversations c where c.id=target and is_member(c.campaign_id) and
 (is_master(c.campaign_id) or exists(select 1 from social_identities i where i.id in(c.first_id,c.second_id) and i.user_id=auth.uid() and i.active)))
$$;
revoke all on function can_converse(uuid) from public,anon;
grant execute on function can_converse(uuid) to authenticated,service_role;

do $$declare t text;begin foreach t in array array['profile_comments','direct_conversations','direct_messages','conversation_reads'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
end loop;end$$;
create policy comment_read on profile_comments for select to authenticated using(is_member(campaign_id) and (not hidden or is_master(campaign_id)));
create policy conversation_read on direct_conversations for select to authenticated using(can_converse(id));
create policy message_read on direct_messages for select to authenticated using(can_converse(conversation_id));
create policy receipt_read on conversation_reads for select to authenticated using(can_converse(conversation_id));

create function public.social_action(c uuid,op text,d jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor social_identities; recipient social_identities; conversation direct_conversations; result_id uuid; message_text text;
begin
 if not is_member(c) then raise exception 'Sem permissão'; end if;
 if op='moderate' then
   if not is_master(c) then raise exception 'Somente Pink'; end if;
   update profile_comments set hidden=coalesce((d->>'hidden')::boolean,true) where id=(d->>'id')::uuid and campaign_id=c returning id into result_id;
   if result_id is null then raise exception 'Comentário não encontrado'; end if;
 else
   select * into actor from social_identities where id=(d->>'actor_id')::uuid and campaign_id=c and active;
   if actor.id is null or (actor.user_id is distinct from auth.uid() and not (is_master(c) and actor.kind='npc')) then raise exception 'Identidade não autorizada'; end if;
   if op in('comment','conversation') then
     select * into recipient from social_identities where id=(d->>'recipient_id')::uuid and campaign_id=c and active;
     if recipient.id is null then raise exception 'Perfil indisponível'; end if;
     if op='comment' then
       insert into profile_comments(campaign_id,profile_id,author_id,body) values(c,recipient.id,actor.id,trim(d->>'body')) returning id into result_id;
     else
       if actor.id=recipient.id then raise exception 'Selecione outro destinatário'; end if;
       insert into direct_conversations(campaign_id,first_id,second_id) values(c,least(actor.id,recipient.id),greatest(actor.id,recipient.id))
       on conflict(first_id,second_id) do update set campaign_id=excluded.campaign_id returning id into result_id;
     end if;
   elsif op in('message','read') then
     select * into conversation from direct_conversations where id=(d->>'conversation_id')::uuid and campaign_id=c;
     if conversation.id is null or actor.id not in(conversation.first_id,conversation.second_id) then raise exception 'Conversa não autorizada'; end if;
     result_id:=conversation.id;
     if op='read' then
       insert into conversation_reads(conversation_id,identity_id) values(conversation.id,actor.id)
       on conflict(conversation_id,identity_id) do update set read_at=now();
     else
       message_text:=trim(d->>'body');
       insert into direct_messages(conversation_id,sender_id,body) values(conversation.id,actor.id,message_text) returning id into result_id;
       select * into recipient from social_identities where id=case when actor.id=conversation.first_id then conversation.second_id else conversation.first_id end;
       if recipient.user_id is not null and recipient.active then
         insert into notifications(campaign_id,user_id,kind,title,reference_id) values(c,recipient.user_id,'message','Nova mensagem de '||actor.name,conversation.id::text);
       end if;
     end if;
   else raise exception 'Operação inválida'; end if;
 end if;
 -- Audit references only. Message bodies never enter campaign-wide history.
 if op<>'read' then perform record_event(c,null,'social_'||op,jsonb_build_object('id',result_id)); end if;
 return jsonb_build_object('id',result_id);
end$$;
revoke all on function social_action(uuid,text,jsonb) from public,anon;
grant execute on function social_action(uuid,text,jsonb) to authenticated,service_role;

create function public.unread_messages(c uuid,actor uuid) returns bigint language sql stable security invoker set search_path=public as $$
 select count(*) from direct_messages m join direct_conversations v on v.id=m.conversation_id
 join social_identities i on i.id=actor and (i.user_id=auth.uid() or (i.kind='npc' and is_master(c)))
 left join conversation_reads r on r.conversation_id=v.id and r.identity_id=actor
 where v.campaign_id=c and actor in(v.first_id,v.second_id) and m.sender_id<>actor and m.created_at>coalesce(r.read_at,'-infinity'::timestamptz)
$$;
revoke all on function unread_messages(uuid,uuid) from public,anon;
grant execute on function unread_messages(uuid,uuid) to authenticated,service_role;
