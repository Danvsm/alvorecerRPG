-- Initialize attributes before calculated resource maxima.
create or replace function public.provision_player(c uuid,u uuid,uname text,identity text,cipher text,d jsonb,claim uuid default null, actor uuid default null) returns uuid language plpgsql security definer set search_path=public as $$declare ch uuid; k text; aid uuid; begin
 if claim is not null then
  perform 1 from invites where campaign_id=c and claim_id=claim and not cancelled and used_by is null and expires_at>now() for update;
  if not found then raise exception 'Convite inválido'; end if;
 end if;
 insert into profiles values(u,uname);
 insert into credential_vault(user_id,identity,ciphertext) values(u,identity,cipher);
 insert into campaign_members values(c,u,'player');
 insert into characters(campaign_id,owner_id,name,class,race,xp,money,information) values(c,u,coalesce(nullif(d->>'name',''),uname),coalesce(d->>'class',''),coalesce(d->>'race',''),coalesce((d->>'xp')::integer,0),coalesce((d->>'money')::integer,0),coalesce(d->'information','{}')) returning id into ch;
 for aid in select id from attributes where campaign_id=c and character_id is null loop
  insert into character_attributes values(ch,aid,coalesce((d->'attributes'->>aid::text)::integer,0));
 end loop;
 for k in select unnest(array['life','mana','stamina']) loop
  insert into character_resources(character_id,key,current,maximum) values(ch,k,coalesce((d->>(k||'_current'))::integer,(d->>k)::integer,0),coalesce((d->>k)::integer,0));
 end loop;
 if claim is not null then update invites set used_by=u where claim_id=claim; end if;
 perform record_event(c,ch,'create_player',jsonb_build_object('username',uname),coalesce(actor,u));
 return ch;
end$$;
