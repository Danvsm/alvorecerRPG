-- Keep the existing schedule and Vault-backed authentication. The default
-- pg_net timeout (5 seconds in production) was reached on consecutive runs.
-- Allow time for Edge startup and Storage requests before cancelling the call.
select cron.schedule('alvorecer-chat-media-cleanup','*/15 * * * *',$job$
 select net.http_post(
  url:='https://wsihnbrnqdnmidjvjchn.supabase.co/functions/v1/alvorecer-api/media-cleanup',
  headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='alvorecer_media_cleanup')),
  body:='{}'::jsonb,
  timeout_milliseconds:=60000
 );
$job$);
