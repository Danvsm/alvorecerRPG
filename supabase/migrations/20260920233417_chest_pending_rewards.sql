-- Players without a character may open the chest. Numeric rewards wait on the
-- campaign membership and are delivered automatically to the first character
-- that becomes active for that account.
alter table public.campaign_members
  add column if not exists chest_pending_xp bigint not null default 0
    check (chest_pending_xp >= 0),
  add column if not exists chest_pending_dracmas_cents bigint not null default 0
    check (chest_pending_dracmas_cents >= 0);

create or replace function alvorecer_private.deliver_pending_chest_rewards()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare member public.campaign_members;
begin
  if new.owner_id is null or new.archived then return new; end if;

  select * into member
  from public.campaign_members
  where campaign_id=new.campaign_id and user_id=new.owner_id
  for update;

  if member.user_id is null
     or (member.chest_pending_xp=0 and member.chest_pending_dracmas_cents=0) then
    return new;
  end if;

  update public.characters
  set xp=xp+member.chest_pending_xp::integer,
      dracmas_cents=dracmas_cents+member.chest_pending_dracmas_cents,
      money=floor((dracmas_cents+member.chest_pending_dracmas_cents)/100.0)::integer
  where id=new.id;

  if member.chest_pending_dracmas_cents>0 then
    insert into public.dracma_transactions(
      campaign_id,kind,actor_id,to_user_id,to_character_id,to_label,
      amount_cents,reason,to_balance_after
    ) values(
      new.campaign_id,'reward',new.owner_id,new.owner_id,new.id,new.name,
      member.chest_pending_dracmas_cents,'Prêmio guardado do Baú Dourado',
      new.dracmas_cents+member.chest_pending_dracmas_cents
    );
  end if;

  update public.campaign_members
  set chest_pending_xp=0,chest_pending_dracmas_cents=0
  where campaign_id=new.campaign_id and user_id=new.owner_id;

  insert into public.notifications(campaign_id,user_id,kind,title,body,reference_id)
  values(
    new.campaign_id,new.owner_id,'chest','Prêmios guardados entregues',
    'O XP e os Dracmas do Baú foram enviados para '||new.name||'.',new.id::text
  );
  return new;
end $$;

drop trigger if exists deliver_pending_chest_rewards on public.characters;
create trigger deliver_pending_chest_rewards
after insert or update of owner_id,archived on public.characters
for each row execute function alvorecer_private.deliver_pending_chest_rewards();

create or replace function public.chest_dashboard(c uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare answer jsonb;
begin
  if not public.is_member(c) then raise exception 'Sem permissão'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  select jsonb_build_object(
    'gems',m.gems,
    'pending_xp',m.chest_pending_xp,
    'pending_dracmas',floor(m.chest_pending_dracmas_cents/100.0)::bigint,
    'cost_gems',s.cost_gems,
    'enabled',s.enabled,
    'odds',(select jsonb_agg(jsonb_build_object('rarity',o.rarity,'weight_bp',o.weight_bp) order by
      case o.rarity when 'common' then 1 when 'uncommon' then 2 when 'rare' then 3 when 'epic' then 4 else 5 end)
      from public.chest_rarity_odds o where o.campaign_id=c),
    'characters',(select coalesce(jsonb_agg(jsonb_build_object('id',ch.id,'name',ch.name) order by ch.name),'[]'::jsonb)
      from public.characters ch where ch.campaign_id=c and ch.owner_id=auth.uid() and not ch.archived),
    'recipients',(select coalesce(jsonb_agg(jsonb_build_object('user_id',i.user_id,'name',i.name,'avatar_id',i.avatar_id) order by i.name),'[]'::jsonb)
      from public.social_identities i join public.campaign_members cm on cm.campaign_id=i.campaign_id and cm.user_id=i.user_id
      where i.campaign_id=c and i.active and i.kind='player' and i.user_id<>auth.uid()
        and cm.access_active and cm.archived_at is null),
    'gifts',(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'message',g.message,'sender_name',coalesce(si.name,sp.username),'created_at',g.created_at) order by g.created_at desc),'[]'::jsonb)
      from public.chest_gifts g left join public.social_identities si on si.campaign_id=g.campaign_id and si.user_id=g.sender_user_id
      join public.profiles sp on sp.id=g.sender_user_id
      where g.campaign_id=c and g.recipient_user_id=auth.uid() and g.status='pending'),
    'history',(select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc),'[]'::jsonb) from
      (select o.id,o.rarity,o.reward_type,o.reward_label,o.reward_amount,o.avatar_id,o.cosmetic_id,o.cost_gems,o.created_at,
        (o.gift_id is not null) gifted from public.chest_openings o where o.campaign_id=c and o.user_id=auth.uid()
       order by o.created_at desc limit 12) h)
  ) into answer
  from public.campaign_members m join public.chest_settings s on s.campaign_id=m.campaign_id
  where m.campaign_id=c and m.user_id=auth.uid() and m.access_active and m.archived_at is null;
  if answer is null then raise exception 'Membro indisponível'; end if;
  return answer;
end $$;

create or replace function public.chest_open(c uuid, selected_character uuid, gift uuid, request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare member public.campaign_members; settings public.chest_settings; identity public.social_identities;
  chosen public.chest_rewards; opening public.chest_openings; gift_row public.chest_gifts; ch public.characters;
  chosen_rarity text; price integer; result jsonb; reward_pending boolean:=false;
begin
  if request_id is null then raise exception 'Abertura inválida'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  select * into member from public.campaign_members where campaign_id=c and user_id=auth.uid()
    and role='player' and access_active and archived_at is null for update;
  if member.user_id is null then raise exception 'Jogador indisponível'; end if;
  select * into opening from public.chest_openings where user_id=auth.uid() and chest_openings.request_id=chest_open.request_id;
  if opening.id is not null then
    if opening.campaign_id<>c then raise exception 'Identificador reutilizado'; end if;
    return to_jsonb(opening)||jsonb_build_object('gems',member.gems,'pending',opening.character_id is null and opening.reward_type in ('xp','dracmas'));
  end if;
  select * into settings from public.chest_settings where campaign_id=c;
  if not settings.enabled then raise exception 'Baú temporariamente fechado'; end if;
  select * into identity from public.social_identities where campaign_id=c and user_id=auth.uid() and active;
  if identity.id is null then raise exception 'Perfil indisponível'; end if;

  if selected_character is not null then
    select * into ch from public.characters where id=selected_character and campaign_id=c and owner_id=auth.uid() and not archived;
    if ch.id is null then raise exception 'Personagem inválido'; end if;
  else
    select * into ch from public.characters where campaign_id=c and owner_id=auth.uid() and not archived order by id limit 1;
  end if;

  if gift is not null then
    select * into gift_row from public.chest_gifts where id=gift and campaign_id=c and recipient_user_id=auth.uid() and status='pending' for update;
    if gift_row.id is null then raise exception 'Presente indisponível'; end if;
    price:=0;
  else
    price:=settings.cost_gems;
    if member.gems<price then raise exception 'Gemas insuficientes'; end if;
  end if;

  select o.rarity into chosen_rarity
  from public.chest_rarity_odds o
  where o.campaign_id=c and o.weight_bp>0 and exists(
    select 1 from public.chest_rewards r where r.campaign_id=c and r.rarity=o.rarity and r.active and (
      r.reward_type in ('xp','dracmas')
      or (r.reward_type='avatar' and not exists(select 1 from public.avatar_grants ag where ag.identity_id=identity.id and ag.avatar_id=r.avatar_id))
      or (r.reward_type='frame' and not exists(select 1 from public.cosmetic_grants cg where cg.identity_id=identity.id and cg.cosmetic_id=r.cosmetic_id and cg.removed_at is null))
    )
  ) order by -ln(greatest(random(),0.0000001))/o.weight_bp limit 1;
  if chosen_rarity is null then raise exception 'Nenhum prêmio disponível'; end if;
  select r.* into chosen from public.chest_rewards r
  where r.campaign_id=c and r.rarity=chosen_rarity and r.active and (
    r.reward_type in ('xp','dracmas')
    or (r.reward_type='avatar' and not exists(select 1 from public.avatar_grants ag where ag.identity_id=identity.id and ag.avatar_id=r.avatar_id))
    or (r.reward_type='frame' and not exists(select 1 from public.cosmetic_grants cg where cg.identity_id=identity.id and cg.cosmetic_id=r.cosmetic_id and cg.removed_at is null))
  ) order by -ln(greatest(random(),0.0000001))/r.weight limit 1;

  if price>0 then
    update public.campaign_members set gems=gems-price where campaign_id=c and user_id=auth.uid() returning * into member;
  end if;
  if chosen.reward_type='xp' then
    if ch.id is null then
      update public.campaign_members set chest_pending_xp=chest_pending_xp+chosen.amount where campaign_id=c and user_id=auth.uid();
      reward_pending:=true;
    else update public.characters set xp=xp+chosen.amount::integer where id=ch.id;
    end if;
  elsif chosen.reward_type='dracmas' then
    if ch.id is null then
      update public.campaign_members set chest_pending_dracmas_cents=chest_pending_dracmas_cents+(chosen.amount*100) where campaign_id=c and user_id=auth.uid();
      reward_pending:=true;
    else
      update public.characters set dracmas_cents=dracmas_cents+(chosen.amount*100),money=floor((dracmas_cents+(chosen.amount*100))/100.0)::integer where id=ch.id;
      insert into public.dracma_transactions(campaign_id,kind,actor_id,to_user_id,to_character_id,to_label,amount_cents,reason,to_balance_after)
      values(c,'reward',auth.uid(),auth.uid(),ch.id,ch.name,chosen.amount*100,'Prêmio do Baú Dourado',ch.dracmas_cents+(chosen.amount*100));
    end if;
  elsif chosen.reward_type='avatar' then
    insert into public.avatar_grants(identity_id,avatar_id) values(identity.id,chosen.avatar_id) on conflict do nothing;
  else
    insert into public.cosmetic_grants(identity_id,cosmetic_id,origin,note,granted_by)
    values(identity.id,chosen.cosmetic_id,'chest','Prêmio do Baú Dourado',auth.uid())
    on conflict(identity_id,cosmetic_id) do update set removed_at=null,removed_by=null,origin='chest',note='Prêmio do Baú Dourado';
  end if;
  insert into public.chest_openings(campaign_id,user_id,character_id,gift_id,reward_id,rarity,reward_type,reward_label,reward_amount,avatar_id,cosmetic_id,cost_gems,request_id)
  values(c,auth.uid(),ch.id,gift,chosen.id,chosen.rarity,chosen.reward_type,chosen.label,chosen.amount,chosen.avatar_id,chosen.cosmetic_id,price,request_id)
  returning * into opening;
  if gift is not null then update public.chest_gifts set status='opened',opened_at=now() where id=gift; end if;
  if price>0 then insert into public.gem_transactions(campaign_id,user_id,actor_id,kind,delta,balance_after,reference_id,note)
    values(c,auth.uid(),auth.uid(),'chest_open',-price,member.gems,opening.id,'Abertura do Baú Dourado'); end if;
  result:=to_jsonb(opening)||jsonb_build_object('gems',member.gems,'pending',reward_pending);
  return result;
end $$;

revoke all on function public.chest_dashboard(uuid) from public,anon;
revoke all on function public.chest_open(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.chest_dashboard(uuid) to authenticated,service_role;
grant execute on function public.chest_open(uuid,uuid,uuid,uuid) to authenticated,service_role;
