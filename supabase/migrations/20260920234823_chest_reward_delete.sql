create or replace function public.chest_admin_action(c uuid, op text, d jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.campaign_members; reward public.chest_rewards; rid uuid; delta integer; odds_total integer;
begin
  if not public.is_master(c) then raise exception 'Somente Pink'; end if;
  perform alvorecer_private.ensure_chest_config(c);
  if op='adjust_gems' then
    delta:=coalesce((d->>'delta')::integer,0);
    if delta=0 then raise exception 'Informe a quantidade de Gemas'; end if;
    select * into target from public.campaign_members where campaign_id=c and user_id=(d->>'user_id')::uuid and role='player' for update;
    if target.user_id is null or target.gems+delta<0 then raise exception 'Saldo de Gemas inválido'; end if;
    update public.campaign_members set gems=gems+delta where campaign_id=c and user_id=target.user_id returning * into target;
    insert into public.gem_transactions(campaign_id,user_id,actor_id,kind,delta,balance_after,note)
    values(c,target.user_id,auth.uid(),'admin_adjustment',delta,target.gems,left(coalesce(d->>'note','Ajuste do Mestre'),200));
    return jsonb_build_object('gems',target.gems);
  elsif op='settings' then
    update public.chest_settings set cost_gems=coalesce((d->>'cost_gems')::integer,cost_gems),enabled=coalesce((d->>'enabled')::boolean,enabled),updated_at=now(),updated_by=auth.uid() where campaign_id=c;
  elsif op='odds' then
    update public.chest_rarity_odds o set weight_bp=(d->>o.rarity)::integer where o.campaign_id=c and d ? o.rarity;
    select sum(weight_bp) into odds_total from public.chest_rarity_odds where campaign_id=c;
    if odds_total<>10000 then raise exception 'As probabilidades devem somar 100%%'; end if;
  elsif op='reward_save' then
    rid:=coalesce(nullif(d->>'id','')::uuid,gen_random_uuid());
    if exists(select 1 from public.chest_rewards r where r.id=rid and r.campaign_id<>c) then raise exception 'Prêmio inválido'; end if;
    if d->>'reward_type'='avatar' then
      if not exists(select 1 from public.campaign_avatars a where a.id=(d->>'avatar_id')::uuid and a.campaign_id=c and a.active and not a.blocked) then raise exception 'Avatar inválido'; end if;
      update public.campaign_avatars set chest_only=true where id=(d->>'avatar_id')::uuid;
    elsif d->>'reward_type'='frame' then
      if not exists(select 1 from public.cosmetics x where x.id=(d->>'cosmetic_id')::uuid and x.campaign_id=c and x.kind='frame' and x.active and x.archived_at is null and x.rarity in ('common','uncommon','rare','epic','legendary')) then raise exception 'Moldura inválida para o Baú'; end if;
    elsif d->>'reward_type' not in ('xp','dracmas') or coalesce((d->>'amount')::bigint,0)<=0 then raise exception 'Prêmio inválido'; end if;
    insert into public.chest_rewards(id,campaign_id,rarity,reward_type,label,amount,avatar_id,cosmetic_id,weight,active,display_order,updated_at)
    values(rid,c,d->>'rarity',d->>'reward_type',trim(d->>'label'),nullif(d->>'amount','')::bigint,nullif(d->>'avatar_id','')::uuid,nullif(d->>'cosmetic_id','')::uuid,coalesce((d->>'weight')::integer,1),coalesce((d->>'active')::boolean,true),coalesce((d->>'display_order')::integer,0),now())
    on conflict(id) do update set rarity=excluded.rarity,reward_type=excluded.reward_type,label=excluded.label,amount=excluded.amount,avatar_id=excluded.avatar_id,cosmetic_id=excluded.cosmetic_id,weight=excluded.weight,active=excluded.active,display_order=excluded.display_order,updated_at=now()
    returning * into reward;
    return to_jsonb(reward);
  elsif op='reward_toggle' then
    update public.chest_rewards set active=coalesce((d->>'active')::boolean,false),updated_at=now() where id=(d->>'id')::uuid and campaign_id=c returning * into reward;
    if reward.id is null then raise exception 'Prêmio não encontrado'; end if;
    return to_jsonb(reward);
  elsif op='reward_delete' then
    delete from public.chest_rewards where id=(d->>'id')::uuid and campaign_id=c returning * into reward;
    if reward.id is null then raise exception 'Prêmio não encontrado'; end if;
    if reward.reward_type='avatar' and not exists(
      select 1 from public.chest_rewards r where r.campaign_id=c and r.avatar_id=reward.avatar_id
    ) then
      update public.campaign_avatars set chest_only=false where id=reward.avatar_id and campaign_id=c;
    end if;
    return to_jsonb(reward);
  else raise exception 'Operação inválida'; end if;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.chest_admin_action(uuid,text,jsonb) from public,anon;
grant execute on function public.chest_admin_action(uuid,text,jsonb) to authenticated,service_role;
