-- Public identity is separate from profiles, which retains private account data.
create table public.social_identities(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns,
  user_id uuid references profiles on delete set null,
  kind text not null check(kind in ('player','master','npc')),
  name text not null check(length(trim(name)) between 1 and 120),
  subtitle text not null default '',
  avatar_id uuid references campaign_avatars on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(campaign_id,user_id)
);
create index social_identities_user_idx on social_identities(user_id);
create index social_identities_avatar_idx on social_identities(avatar_id);
create table public.cosmetics(
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references campaigns,
  kind text not null check(kind in ('frame','title','medal')),
  name text not null check(length(trim(name)) between 1 and 100),
  description text not null default '', color text not null default '#D02A43' check(color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text not null default 'star' check(icon in ('star','shield','crown','flame','moon','sword')),
  active boolean not null default true, created_at timestamptz not null default now()
);
create index cosmetics_campaign_idx on cosmetics(campaign_id);
create table public.cosmetic_grants(
  identity_id uuid not null references social_identities,
  cosmetic_id uuid not null references cosmetics,
  origin text not null check(origin in ('session','achievement','event','gift','supporter')),
  note text not null default '', created_at timestamptz not null default now(),
  primary key(identity_id,cosmetic_id)
);
create index cosmetic_grants_cosmetic_idx on cosmetic_grants(cosmetic_id);
create table public.cosmetic_equipment(
  identity_id uuid not null references social_identities,
  kind text not null check(kind in ('frame','title','medal')),
  cosmetic_id uuid not null,
  primary key(identity_id,kind),
  foreign key(identity_id,cosmetic_id) references cosmetic_grants on delete cascade
);
create index cosmetic_equipment_grant_idx on cosmetic_equipment(identity_id,cosmetic_id);
create table public.notifications(
  id bigint generated always as identity primary key,
  campaign_id uuid not null references campaigns,
  user_id uuid not null references profiles on delete cascade,
  kind text not null, title text not null,
  reference_id text, read_at timestamptz, dismissed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_date_idx on notifications(user_id,campaign_id,created_at desc);

do $$ declare t text; begin
  foreach t in array array['social_identities','cosmetics','cosmetic_grants','cosmetic_equipment','notifications'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end$$;
create policy identity_read on social_identities for select to authenticated using(is_member(campaign_id));
create policy cosmetics_read on cosmetics for select to authenticated using(is_member(campaign_id));
create policy grants_read on cosmetic_grants for select to authenticated using(exists(select 1 from social_identities i where i.id=identity_id and is_member(i.campaign_id)));
create policy equipment_read on cosmetic_equipment for select to authenticated using(exists(select 1 from social_identities i where i.id=identity_id and is_member(i.campaign_id)));
create policy notification_read on notifications for select to authenticated using(user_id=auth.uid() and is_member(campaign_id));

insert into social_identities(campaign_id,user_id,kind,name,avatar_id)
select m.campaign_id,m.user_id,m.role,coalesce(nullif(p.display_name,''),p.username),
  (select ch.avatar_id from characters ch where ch.owner_id=m.user_id and ch.campaign_id=m.campaign_id and not ch.archived order by ch.id limit 1)
from campaign_members m join profiles p on p.id=m.user_id;

create function alvorecer_private.identity_for_member() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into social_identities(campaign_id,user_id,kind,name)
    select new.campaign_id,new.user_id,new.role,coalesce(nullif(display_name,''),username) from profiles where id=new.user_id
    on conflict(campaign_id,user_id) do nothing;
  return new;
end$$;
create trigger member_identity after insert on campaign_members for each row execute function alvorecer_private.identity_for_member();

create function alvorecer_private.identity_access() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' then
    update social_identities set active=false where campaign_id=old.campaign_id and user_id=old.user_id;
    return old;
  end if;
  update social_identities set active=new.access_active where campaign_id=new.campaign_id and user_id=new.user_id;
  return new;
end$$;
create trigger member_identity_access after update of access_active or delete on campaign_members for each row execute function alvorecer_private.identity_access();
update social_identities i set active=m.access_active from campaign_members m where m.user_id=i.user_id and m.campaign_id=i.campaign_id;

create policy portrait_identity_read on storage.objects for select to authenticated using(
  bucket_id='portraits' and exists(select 1 from public.campaign_avatars a
    join public.social_identities i on i.avatar_id=a.id
    where a.storage_path=storage.objects.name and public.is_member(i.campaign_id))
);
create policy avatar_identity_read on campaign_avatars for select to authenticated using(
  is_member(campaign_id) and exists(select 1 from social_identities i where i.avatar_id=campaign_avatars.id and i.campaign_id=campaign_avatars.campaign_id)
);

create function public.identity_action(c uuid,op text,d jsonb)
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
      if op='grant' then
        insert into cosmetic_grants(identity_id,cosmetic_id,origin,note)
          values(target.id,cosmetic.id,coalesce(d->>'origin','gift'),left(coalesce(d->>'note',''),500)) on conflict do nothing;
        if found and target.user_id is not null then
          insert into notifications(campaign_id,user_id,kind,title,reference_id)
          values(c,target.user_id,'cosmetic','Você desbloqueou: '||cosmetic.name,cosmetic.id::text);
        end if;
      else
        if not exists(select 1 from cosmetic_grants where identity_id=target.id and cosmetic_id=cosmetic.id) then raise exception 'Cosmético bloqueado'; end if;
        insert into cosmetic_equipment(identity_id,kind,cosmetic_id) values(target.id,cosmetic.kind,cosmetic.id)
          on conflict(identity_id,kind) do update set cosmetic_id=excluded.cosmetic_id;
      end if;
    end if;
  elsif op in ('notification_read','notification_read_all','notification_clear') then
    update notifications set read_at=coalesce(read_at,now()),
      dismissed_at=case when op='notification_clear' then now() else dismissed_at end
      where campaign_id=c and user_id=auth.uid()
        and (op<>'notification_read' or id=(d->>'id')::bigint)
        and (op<>'notification_clear' or created_at<now()-interval '30 days');
  else raise exception 'Operação inválida'; end if;
  if op not like 'notification_%' then
    perform record_event(c,null,'identity_'||op,jsonb_build_object('id',result_id,'input',d));
  end if;
  return jsonb_build_object('id',result_id);
end$$;
revoke all on function public.identity_action(uuid,text,jsonb) from public,anon;
grant execute on function public.identity_action(uuid,text,jsonb) to authenticated,service_role;

create function public.wealth_ranking(c uuid)
returns table(rank bigint,identity_id uuid,name text,avatar_id uuid)
language sql stable security definer set search_path=public as $$
  select row_number() over(order by coalesce(sum(ch.dracmas_cents),0) desc,i.id),i.id,i.name,i.avatar_id
  from social_identities i join campaign_members m on m.campaign_id=i.campaign_id and m.user_id=i.user_id
  left join characters ch on ch.owner_id=i.user_id and ch.campaign_id=c and not ch.archived
  where i.campaign_id=c and i.kind='player' and i.active and m.access_active and is_member(c)
  group by i.id
$$;
revoke all on function public.wealth_ranking(uuid) from public,anon;
grant execute on function public.wealth_ranking(uuid) to authenticated,service_role;

create function alvorecer_private.financial_notification() returns trigger language plpgsql security definer set search_path=public as $$
declare recipient uuid; message text; amount text;
begin
  amount:=replace(to_char(new.amount_cents/100.0,'FM999999999999990.00'),'.',',');
  if tg_table_name='dracma_transactions' then
    recipient:=new.to_user_id;
    message:=case new.kind when 'transfer' then coalesce(new.from_label,'Um jogador')||' enviou '||amount||' Dracmas para você'
      when 'reward' then 'Você recebeu uma recompensa de '||amount||' Dracmas'
      when 'admin_adjustment' then 'Seu saldo recebeu um ajuste de '||amount||' Dracmas'
      else null end;
    if new.kind='admin_adjustment' and recipient is null then
      recipient:=new.from_user_id; message:='Seu saldo recebeu um ajuste de -'||amount||' Dracmas';
    end if;
  else
    if tg_op='INSERT' then recipient:=new.target_user_id; message:='Você recebeu uma cobrança de '||amount||' Dracmas';
    elsif new.status is distinct from old.status then
      recipient:=new.requester_user_id;
      message:=case new.status when 'paid' then 'Sua cobrança foi paga' when 'refused' then 'Sua cobrança foi recusada' else null end;
    end if;
  end if;
  if recipient is not null and message is not null then
    insert into notifications(campaign_id,user_id,kind,title,reference_id) values(new.campaign_id,recipient,'wallet',message,new.id::text);
  end if;
  return new;
end$$;
create trigger transaction_notification after insert on dracma_transactions for each row execute function alvorecer_private.financial_notification();
create trigger charge_notification after insert or update of status on dracma_charges for each row execute function alvorecer_private.financial_notification();
