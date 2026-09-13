create function public.grant_reward(c uuid,target uuid,d jsonb,request_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare ch characters; i social_identities; xp_amount integer:=coalesce((d->>'xp')::integer,0);
 cents bigint:=coalesce((d->>'cents')::bigint,0); cosmetic_id uuid; r alvorecer_private.receipts;
 payload jsonb:=jsonb_build_object('campaign',c,'target',target,'reward',d); answer jsonb; reason text:=left(trim(coalesce(d->>'reason','Recompensa')),500);
begin
 if not is_master(c) or request_id is null then raise exception 'Somente Pink'; end if;
 if xp_amount<0 or cents<0 or length(reason)=0 then raise exception 'Recompensa inválida'; end if;
 if xp_amount=0 and cents=0 and jsonb_array_length(coalesce(d->'cosmetics','[]'::jsonb))=0 then raise exception 'Selecione uma recompensa'; end if;
 select * into ch from characters where id=target and campaign_id=c and not archived for update;
 if ch.id is null then raise exception 'Personagem indisponível'; end if;
 select * into i from social_identities where campaign_id=c and user_id=ch.owner_id and active;
 if i.id is null then raise exception 'Jogador indisponível'; end if;
 insert into alvorecer_private.receipts(actor_id,request_id,operation,payload) values(auth.uid(),request_id,'reward',payload) on conflict do nothing;
 if not found then
   select * into r from alvorecer_private.receipts x where x.actor_id=auth.uid() and x.request_id=grant_reward.request_id;
   if r.operation<>'reward' or r.payload<>payload then raise exception 'Identificador reutilizado'; end if;
   return r.result;
 end if;
 update characters set xp=xp+xp_amount,dracmas_cents=dracmas_cents+cents,money=floor((dracmas_cents+cents)/100.0)::integer where id=target;
 if cents>0 then
   insert into dracma_transactions(campaign_id,kind,actor_id,to_user_id,to_character_id,to_label,amount_cents,reason,to_balance_after)
   values(c,'reward',auth.uid(),ch.owner_id,ch.id,ch.name,cents,reason,ch.dracmas_cents+cents);
 end if;
 for cosmetic_id in select value::text::uuid from jsonb_array_elements_text(coalesce(d->'cosmetics','[]'::jsonb)) loop
   perform identity_action(c,'grant',jsonb_build_object('identity_id',i.id,'cosmetic_id',cosmetic_id,'origin',coalesce(d->>'origin','gift'),'note',reason));
 end loop;
 if xp_amount>0 then insert into notifications(campaign_id,user_id,kind,title,reference_id) values(c,ch.owner_id,'reward','Você recebeu '||xp_amount||' XP',ch.id::text); end if;
 answer:=jsonb_build_object('xp_before',ch.xp,'xp_after',ch.xp+xp_amount,'cents',cents);
 perform record_event(c,ch.id,'reward',answer||jsonb_build_object('reason',reason));
 update alvorecer_private.receipts set result=answer where actor_id=auth.uid() and receipts.request_id=grant_reward.request_id;
 return answer;
end$$;
revoke all on function grant_reward(uuid,uuid,jsonb,uuid) from public,anon;
grant execute on function grant_reward(uuid,uuid,jsonb,uuid) to authenticated,service_role;
