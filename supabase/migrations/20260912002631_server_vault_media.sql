-- A distinct encryption key stays in Supabase Vault; only the backend can retrieve it.
do $$begin if not exists(select 1 from vault.secrets where name='alvorecer_credentials_v1') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'),'alvorecer_credentials_v1','Alvorecer credential encryption'); end if;end$$;
create function public.server_credential_key() returns text language sql security definer set search_path=public as $$select decrypted_secret from vault.decrypted_secrets where name='alvorecer_credentials_v1'$$;
revoke execute on function public.server_credential_key() from public,anon,authenticated;
grant execute on function public.server_credential_key() to service_role;
create table alvorecer_private.bootstrap_access(token_hash text primary key,claimed boolean not null default false);
alter table alvorecer_private.bootstrap_access enable row level security;
create function public.claim_bootstrap(h text) returns boolean language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from campaign_members where role='master') then return false;end if;
 update alvorecer_private.bootstrap_access set claimed=true where token_hash=h and not claimed;return found;
end$$;
revoke execute on function public.claim_bootstrap(text) from public,anon,authenticated;
grant execute on function public.claim_bootstrap(text) to service_role;
create function alvorecer_private.managed_signup() returns trigger language plpgsql security definer set search_path=public as $$begin
 if not coalesce((new.raw_app_meta_data->>'alvorecer_managed')::boolean,false) then raise exception 'Cadastro somente pelo mestre ou convite';end if;return new;
end$$;
create trigger alvorecer_managed_signup before insert on auth.users for each row execute function alvorecer_private.managed_signup();
revoke execute on function alvorecer_private.managed_signup() from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('item-media','item-media',false,262144,array['image/webp']);
create policy item_media_read on storage.objects for select to authenticated using(bucket_id='item-media' and exists(select 1 from public.campaign_members m where m.user_id=auth.uid() and m.campaign_id::text=(storage.foldername(name))[1]));
create policy item_media_insert on storage.objects for insert to authenticated with check(bucket_id='item-media' and exists(select 1 from public.campaign_members m where m.user_id=auth.uid() and m.role='master' and m.campaign_id::text=(storage.foldername(name))[1]));
create policy item_media_delete on storage.objects for delete to authenticated using(bucket_id='item-media' and exists(select 1 from public.campaign_members m where m.user_id=auth.uid() and m.role='master' and m.campaign_id::text=(storage.foldername(name))[1]));
