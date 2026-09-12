-- These functions are service-role-only. No identity or encrypted credential is browser-readable.
create function public.throttle(k text, max_attempts integer default 10) returns boolean language plpgsql security definer set search_path=public as $$declare n integer; begin
 insert into login_limits(key,count,started) values(k,1,now()) on conflict(key) do update set count=case when login_limits.started<now()-interval '15 minutes' then 1 else login_limits.count+1 end,started=case when login_limits.started<now()-interval '15 minutes' then now() else login_limits.started end returning count into n;
 return n<=max_attempts;
end$$;
create function public.claim_invite(h text, claim uuid) returns uuid language plpgsql security definer set search_path=public as $$declare c uuid; begin
 update invites set claim_id=claim,claimed_at=now() where token_hash=h and not cancelled and used_by is null and expires_at>now() and claim_id is null returning campaign_id into c;
 if c is null then raise exception 'Convite inválido, expirado ou em uso'; end if; return c;
end$$;
create function public.provision_player(c uuid,u uuid,uname text,identity text,cipher text,d jsonb,claim uuid default null, actor uuid default null) returns uuid language plpgsql security definer set search_path=public as $$declare ch uuid; k text; aid uuid; begin
 if claim is not null then
  perform 1 from invites where campaign_id=c and claim_id=claim and not cancelled and used_by is null and expires_at>now() for update;
  if not found then raise exception 'Convite inválido'; end if;
 end if;
 insert into profiles values(u,uname);
 insert into credential_vault(user_id,identity,ciphertext) values(u,identity,cipher);
 insert into campaign_members values(c,u,'player');
 insert into characters(campaign_id,owner_id,name,class,race,xp,money,information) values(c,u,coalesce(nullif(d->>'name',''),uname),coalesce(d->>'class',''),coalesce(d->>'race',''),coalesce((d->>'xp')::integer,0),coalesce((d->>'money')::integer,0),coalesce(d->'information','{}')) returning id into ch;
 for k in select unnest(array['life','mana','stamina']) loop
  insert into character_resources values(ch,k,coalesce((d->>(k||'_current'))::integer,(d->>k)::integer,0),coalesce((d->>k)::integer,0));
 end loop;
 for aid in select id from attributes where campaign_id=c and character_id is null loop
  insert into character_attributes values(ch,aid,coalesce((d->'attributes'->>aid::text)::integer,0));
 end loop;
 if claim is not null then update invites set used_by=u where claim_id=claim; end if;
 perform record_event(c,ch,'create_player',jsonb_build_object('username',uname),coalesce(actor,u));
 return ch;
end$$;
create function public.lock_credential(u uuid,cipher text) returns void language plpgsql security definer set search_path=public as $$begin
 update credential_vault set pending_ciphertext=cipher,locked_at=now() where user_id=u and pending_ciphertext is null;
 if not found then raise exception 'Existe uma alteração de senha pendente. Consulte a senha para reconciliar antes de tentar novamente.'; end if;
end$$;
create function public.finish_credential(u uuid,expected text,success boolean) returns void language plpgsql security definer set search_path=public as $$begin
 update credential_vault set ciphertext=case when success then pending_ciphertext else ciphertext end,pending_ciphertext=null,locked_at=null where user_id=u and pending_ciphertext=expected;
end$$;
revoke execute on function public.throttle(text,integer),public.claim_invite(text,uuid),public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid),public.lock_credential(uuid,text),public.finish_credential(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.is_master(uuid),public.is_member(uuid),public.can_character(uuid),public.record_event(uuid,uuid,text,jsonb,uuid),public.combat_snapshot(uuid),public.game_command(uuid,text,jsonb),public.throttle(text,integer),public.claim_invite(text,uuid),public.provision_player(uuid,uuid,text,text,text,jsonb,uuid,uuid),public.lock_credential(uuid,text),public.finish_credential(uuid,text,boolean) to service_role;
create function public.bootstrap_campaign(u uuid,uname text,identity text,cipher text) returns uuid language plpgsql security definer set search_path=public as $$declare c uuid; n text; pos integer:=0; begin
 perform pg_advisory_xact_lock(420011);
 if exists(select 1 from campaign_members where role='master') then raise exception 'Mestre já configurado'; end if;
 insert into profiles values(u,uname);
 insert into credential_vault(user_id,identity,ciphertext) values(u,identity,cipher);
 insert into campaigns(name) values('A Promessa do Amanhecer') returning id into c;
 insert into campaign_members values(c,u,'master');
 foreach n in array array['Força','Habilidade','Armadura','Vigor','PDF','Poder','Consciência','Esquiva','Raciocínio','Inteligência','Aparência'] loop
  insert into attributes(campaign_id,name,position) values(c,n,pos); pos:=pos+1;
 end loop;
 insert into campaign_events(campaign_id) values(c);
 return c;
end$$;
revoke execute on function public.bootstrap_campaign(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.bootstrap_campaign(uuid,text,text,text) to service_role;
