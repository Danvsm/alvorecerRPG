create table public.chat_media(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null references direct_conversations,
 sender_id uuid not null references social_identities,uploader_id uuid references profiles on delete set null,
 storage_path text not null unique,expires_at timestamptz not null default now()+interval '24 hours',
 consumed boolean not null default false,deleted_at timestamptz,created_at timestamptz not null default now()
);
create index chat_media_expiry_idx on chat_media(expires_at) where deleted_at is null;
create index chat_media_conversation_idx on chat_media(conversation_id);
create index chat_media_sender_idx on chat_media(sender_id);
create index chat_media_uploader_idx on chat_media(uploader_id);
alter table chat_media enable row level security;
revoke all on chat_media from anon,authenticated;
grant select on chat_media to authenticated;
grant all on chat_media to service_role;
create policy chat_media_read on chat_media for select to authenticated using(can_converse(conversation_id));
alter table direct_messages add column media_id uuid unique references chat_media;
alter table direct_messages drop constraint direct_messages_body_check;
alter table direct_messages add constraint direct_messages_body_check check((media_id is not null or length(trim(body))>0) and length(body)<=4000);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('chat-media','chat-media',false,262144,array['image/webp']) on conflict(id) do nothing;
create policy chat_image_read on storage.objects for select to authenticated using(bucket_id='chat-media' and exists(select 1 from chat_media m where m.storage_path=storage.objects.name and m.expires_at>now() and m.deleted_at is null and can_converse(m.conversation_id)));
create policy chat_image_insert on storage.objects for insert to authenticated with check(bucket_id='chat-media' and storage.extension(name)='webp' and exists(select 1 from chat_media m where m.storage_path=storage.objects.name and m.uploader_id=auth.uid() and not m.consumed and m.expires_at>now() and can_converse(m.conversation_id)));

create function public.chat_media_action(c uuid,op text,d jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor social_identities; conversation direct_conversations; media chat_media; new_id uuid; recipient uuid;
begin
 if not is_member(c) then raise exception 'Sem permissão'; end if;
 select * into actor from social_identities where id=(d->>'actor_id')::uuid and campaign_id=c and active;
 if actor.id is null or (actor.user_id is distinct from auth.uid() and not (actor.kind='npc' and is_master(c))) then raise exception 'Identidade não autorizada'; end if;
 if op='reserve' then
   select * into conversation from direct_conversations where id=(d->>'conversation_id')::uuid and campaign_id=c;
   if conversation.id is null or actor.id not in(conversation.first_id,conversation.second_id) then raise exception 'Conversa não autorizada'; end if;
   if not throttle('chat_upload:'||auth.uid()::text,30) then raise exception 'Limite temporário de imagens atingido'; end if;
   new_id:=gen_random_uuid();
   insert into chat_media(id,conversation_id,sender_id,uploader_id,storage_path) values(new_id,conversation.id,actor.id,auth.uid(),conversation.id::text||'/'||new_id::text||'.webp') returning * into media;
 elsif op='send' then
   select * into media from chat_media where id=(d->>'media_id')::uuid for update;
   if media.id is null or media.sender_id<>actor.id or media.uploader_id<>auth.uid() or media.expires_at<=now() or media.deleted_at is not null or not can_converse(media.conversation_id) then raise exception 'Imagem indisponível'; end if;
   if media.consumed then select id into new_id from direct_messages where media_id=media.id;return jsonb_build_object('id',new_id);end if;
   if not exists(select 1 from storage.objects where bucket_id='chat-media' and name=media.storage_path) then raise exception 'Envio da imagem incompleto'; end if;
   insert into direct_messages(conversation_id,sender_id,body,media_id) values(media.conversation_id,actor.id,'',media.id) returning id into new_id;
   update chat_media set consumed=true where id=media.id;
   select * into conversation from direct_conversations where id=media.conversation_id;
   select user_id into recipient from social_identities where id=case when conversation.first_id=actor.id then conversation.second_id else conversation.first_id end;
   if recipient is not null then insert into notifications(campaign_id,user_id,kind,title,reference_id) values(c,recipient,'message','Nova imagem de '||actor.name,conversation.id::text);end if;
   perform record_event(c,null,'social_image',jsonb_build_object('id',new_id));
 else raise exception 'Operação inválida'; end if;
 return jsonb_build_object('id',media.id,'path',media.storage_path);
end$$;
revoke all on function chat_media_action(uuid,text,jsonb) from public,anon;
grant execute on function chat_media_action(uuid,text,jsonb) to authenticated,service_role;
