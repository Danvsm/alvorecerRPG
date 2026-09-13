create function public.admin_player_data(c uuid,target uuid,d jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare previous profiles; birthday date; uname text;
begin
 if not is_master(c) or not exists(select 1 from campaign_members where campaign_id=c and user_id=target and role='player') then raise exception 'Somente Pink'; end if;
 select * into previous from profiles where id=target for update;
 if coalesce(d->>'birth_date','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data de nascimento obrigatória'; end if;
 birthday:=(d->>'birth_date')::date;
 if birthday>current_date or birthday<'0001-01-01'::date then raise exception 'Nascimento inválido'; end if;
 uname:=lower(trim(d->>'username'));
 if uname is null or uname !~ '^[a-z0-9_]{3,32}$' then raise exception 'Username inválido'; end if;
 if length(trim(coalesce(d->>'full_name','')))=0 then raise exception 'Nome obrigatório'; end if;
 if length(coalesce(d->>'email',''))>254 or coalesce(d->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'E-mail inválido'; end if;
 update profiles set username=uname,full_name=left(trim(d->>'full_name'),160),personal_email=lower(trim(d->>'email')),birth_date=birthday where id=target;
 perform record_event(c,null,'player_data_changed',jsonb_build_object('user_id',target,'before',jsonb_build_object('username',previous.username,'full_name',previous.full_name,'email',previous.personal_email,'birth_date',previous.birth_date),'after',d));
end$$;
revoke all on function admin_player_data(uuid,uuid,jsonb) from public,anon;
grant execute on function admin_player_data(uuid,uuid,jsonb) to authenticated,service_role;

create function public.admin_player_summary(c uuid,target uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare activity jsonb; finances jsonb;
begin
 if not is_master(c) or not exists(select 1 from campaign_members where campaign_id=c and user_id=target and role='player') then raise exception 'Somente Pink'; end if;
 select jsonb_build_object('first_access',min(started_at),'last_access',max(started_at),'last_exit',max(ended_at),'total',coalesce(sum(active_seconds),0),
 'today',coalesce(sum(active_seconds) filter(where (started_at at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date),0),
 'week',coalesce(sum(active_seconds) filter(where started_at>=now()-interval '7 days'),0),
 'month',coalesce(sum(active_seconds) filter(where started_at>=now()-interval '30 days'),0),
 'sessions',count(*),'average',coalesce(round(avg(active_seconds)),0)) into activity from activity_sessions where campaign_id=c and user_id=target;
 select jsonb_build_object('received',coalesce(sum(amount_cents) filter(where to_user_id=target),0),'spent',coalesce(sum(amount_cents) filter(where from_user_id=target),0)) into finances from dracma_transactions where campaign_id=c and (to_user_id=target or from_user_id=target);
 return jsonb_build_object('activity',activity,'finances',finances);
end$$;
revoke all on function admin_player_summary(uuid,uuid) from public,anon;
grant execute on function admin_player_summary(uuid,uuid) to authenticated,service_role;
