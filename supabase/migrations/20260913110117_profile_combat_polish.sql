alter table characters drop constraint characters_avatar_id_fkey;
alter table characters add constraint characters_avatar_id_fkey foreign key(avatar_id) references campaign_avatars(id) on delete restrict;
alter table creature_templates add column image_path text;
create function public.set_creature_image(c uuid,target uuid,path text) returns void language plpgsql security definer set search_path=public as $$
begin
 if not is_master(c) then raise exception 'Somente Pink'; end if;
 if path is not null and (split_part(path,'/',1)<>c::text or not exists(select 1 from storage.objects where bucket_id='item-media' and name=path)) then raise exception 'Imagem inválida'; end if;
 update creature_templates set image_path=path where id=target and campaign_id=c;
 if not found then raise exception 'Criatura indisponível'; end if;
 perform record_event(c,null,'creature_image',jsonb_build_object('id',target));
end$$;
revoke all on function set_creature_image(uuid,uuid,text) from public,anon;
grant execute on function set_creature_image(uuid,uuid,text) to authenticated,service_role;

create function public.combat_identities(c uuid) returns table(participant_id uuid,identity_id uuid,image_path text)
language sql stable security definer set search_path=public as $$
 select p.id,i.id,t.image_path from combat_participants p
 join combat_rooms r on r.id=p.room_id
 left join characters ch on ch.id=p.character_id
 left join social_identities i on i.user_id=ch.owner_id and i.campaign_id=c
 left join creature_templates t on t.id=p.template_id
 where r.campaign_id=c and is_member(c)
$$;
revoke all on function combat_identities(uuid) from public,anon;
grant execute on function combat_identities(uuid) to authenticated,service_role;

create function public.admin_character_progression(c uuid,target uuid,d jsonb) returns void language plpgsql security definer set search_path=public as $$
declare previous characters; after_value characters; reason text:=trim(coalesce(d->>'reason',''));
begin
 if not is_master(c) then raise exception 'Somente Pink'; end if;
 if length(reason)=0 then raise exception 'Informe o motivo'; end if;
 select * into previous from characters where id=target and campaign_id=c for update;
 if previous.id is null then raise exception 'Personagem indisponível'; end if;
 if (d->>'xp_total')::integer<previous.xp_total then raise exception 'XP total conquistado não pode diminuir'; end if;
 if (d->>'level')::integer not between 1 and 10 then raise exception 'Nível deve estar entre 1 e 10'; end if;
 update characters set xp=(d->>'xp')::integer,xp_total=(d->>'xp_total')::integer,level=(d->>'level')::integer where id=target returning * into after_value;
 perform record_event(c,target,'progression_adjustment',jsonb_build_object('before',jsonb_build_object('xp',previous.xp,'xp_total',previous.xp_total,'level',previous.level),'after',jsonb_build_object('xp',after_value.xp,'xp_total',after_value.xp_total,'level',after_value.level),'reason',left(reason,500)));
end$$;
revoke all on function admin_character_progression(uuid,uuid,jsonb) from public,anon;
grant execute on function admin_character_progression(uuid,uuid,jsonb) to authenticated,service_role;
