create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$begin
 if not exists(select 1 from vault.secrets where name='alvorecer_media_cleanup') then
   perform vault.create_secret(gen_random_uuid()::text||gen_random_uuid()::text,'alvorecer_media_cleanup');
 end if;
end$$;
create function public.verify_media_cleanup(token text) returns boolean language sql stable security definer set search_path='' as $$
 select length(token)>40 and exists(select 1 from vault.decrypted_secrets where name='alvorecer_media_cleanup' and decrypted_secret=token)
$$;
revoke all on function public.verify_media_cleanup(text) from public,anon,authenticated;
grant execute on function public.verify_media_cleanup(text) to service_role;
select cron.schedule('alvorecer-chat-media-cleanup','*/15 * * * *',$job$
 select net.http_post(
  url:='https://wsihnbrnqdnmidjvjchn.supabase.co/functions/v1/alvorecer-api/media-cleanup',
  headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='alvorecer_media_cleanup')),
  body:='{}'::jsonb
 );
$job$);
