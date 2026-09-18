-- "Limpar notificações" dismisses every notification visible to the
-- authenticated user in the selected campaign. The rows remain available for
-- audit/reference purposes and only their dismissed timestamp changes.
create or replace function public.identity_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target social_identities; cosmetic cosmetics; result_id uuid; a uuid;
begin
  if not is_member(c) then raise exception 'Sem permissão'; end if;
  if op in ('npc','cosmetic','grant') and not is_master(c) then raise exception 'Somente Pink'; end if;
  if op='npc' then
    result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
    a:=nullif(d->>'avatar_id','')::uuid;
    if a is not null and not exists(select 1 from campaign_avatars where id=a and campaign_id=c and active) then raise exception 'Avatar inválido'; end if;
    if exists(select 1 from social_identities where id=result_id and (campaign_id<>c or kind<>'npc')) then raise exception 'Personagem inválido'; end if;
    insert into social_identities(id,campaign_id,kind,name,subtitle,avatar_id,active)
      values(result_id,c,'npc',trim(d->>'name'),left(coalesce(d->>'subtitle',''),160),a,coalesce((d->>'active')::boolean,true))
      on conflict(id) do update set name=excluded.name,subtitle=excluded.subtitle,avatar_id=excluded.avatar_id,active=excluded.active;
  elsif op='cosmetic' then
    if d->>'kind'='frame' then raise exception 'Molduras devem ser administradas por frame_action'; end if;
    result_id:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
    if exists(select 1 from cosmetics where id=result_id and (campaign_id<>c or kind<>d->>'kind')) then raise exception 'Cosmético inválido'; end if;
    insert into cosmetics(id,campaign_id,kind,name,description,color,icon,active)
      values(result_id,c,d->>'kind',trim(d->>'name'),left(coalesce(d->>'description',''),2000),coalesce(d->>'color','#D02A43'),coalesce(d->>'icon','star'),coalesce((d->>'active')::boolean,true))
      on conflict(id) do update set name=excluded.name,description=excluded.description,color=excluded.color,icon=excluded.icon,active=excluded.active;
  elsif op in ('avatar','equip','grant') then
    select * into target from social_identities where id=(d->>'identity_id')::uuid and campaign_id=c for update;
    if target.id is null or (not is_master(c) and (target.user_id is distinct from auth.uid() or not target.active)) then raise exception 'Perfil não autorizado'; end if;
    result_id:=target.id;
    if op='avatar' then
      a:=(d->>'avatar_id')::uuid;
      if not exists(select 1 from campaign_avatars where id=a and campaign_id=c and active) then raise exception 'Avatar indisponível'; end if;
      update social_identities set avatar_id=a where id=target.id;
      update characters set avatar_id=a where owner_id=target.user_id and campaign_id=c and not archived;
    else
      select * into cosmetic from cosmetics where id=(d->>'cosmetic_id')::uuid and campaign_id=c and active;
      if cosmetic.id is null then raise exception 'Cosmético indisponível'; end if;
      if cosmetic.kind='frame' then raise exception 'Molduras devem usar frame_action'; end if;
      if op='grant' then
        insert into cosmetic_grants(identity_id,cosmetic_id,origin,note)
          values(target.id,cosmetic.id,coalesce(d->>'origin','gift'),left(coalesce(d->>'note',''),500)) on conflict do nothing;
        if found and target.user_id is not null then
          insert into notifications(campaign_id,user_id,kind,title,reference_id)
          values(c,target.user_id,'cosmetic','Você desbloqueou: '||cosmetic.name,cosmetic.id::text);
        end if;
      else
        if not exists(
          select 1 from cosmetic_grants
          where identity_id=target.id and cosmetic_id=cosmetic.id and removed_at is null
        ) then raise exception 'Cosmético bloqueado'; end if;
        insert into cosmetic_equipment(identity_id,kind,cosmetic_id) values(target.id,cosmetic.kind,cosmetic.id)
          on conflict(identity_id,kind) do update set cosmetic_id=excluded.cosmetic_id;
      end if;
    end if;
  elsif op in ('notification_read','notification_read_all','notification_clear') then
    update notifications set read_at=coalesce(read_at,now()),
      dismissed_at=case when op='notification_clear' then now() else dismissed_at end
      where campaign_id=c and user_id=auth.uid()
        and (op<>'notification_read' or id=(d->>'id')::bigint);
  else raise exception 'Operação inválida'; end if;
  if op not like 'notification_%' then
    perform record_event(c,null,'identity_'||op,jsonb_build_object('id',result_id,'input',d));
  end if;
  return jsonb_build_object('id',result_id);
end$$;

revoke all on function public.identity_action(uuid,text,jsonb) from public,anon;
grant execute on function public.identity_action(uuid,text,jsonb)
  to authenticated,service_role;
