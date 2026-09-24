create or replace function public.verify_web_player_access_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from vault.decrypted_secrets
    where name = 'alvorecer_web_player_access_code_v1'
      and decrypted_secret = coalesce(p_code, '')
  )
$$;

revoke all on function public.verify_web_player_access_code(text)
  from public, anon, authenticated;
grant execute on function public.verify_web_player_access_code(text)
  to service_role;
