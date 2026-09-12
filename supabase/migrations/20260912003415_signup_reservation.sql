create table alvorecer_private.signup_reservations(identity text primary key,created_at timestamptz not null default now());
alter table alvorecer_private.signup_reservations enable row level security;
create function public.reserve_auth_identity(identity text) returns void language sql security definer set search_path=public as $$insert into alvorecer_private.signup_reservations(identity) values(identity) on conflict do nothing$$;
revoke execute on function public.reserve_auth_identity(text) from public,anon,authenticated;
grant execute on function public.reserve_auth_identity(text) to service_role;
create or replace function alvorecer_private.managed_signup() returns trigger language plpgsql security definer set search_path=public as $$begin
 delete from alvorecer_private.signup_reservations where identity=new.email and created_at>now()-interval '15 minutes';
 if not found then raise exception 'Cadastro somente pelo mestre ou convite';end if;return new;
end$$;
