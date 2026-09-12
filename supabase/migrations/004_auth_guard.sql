-- Normal Auth password/email edits cannot bypass the application credential workflow.
-- Installation requires the project database owner (Supabase SQL editor/migrations).
create function public.guard_rpg_identity() returns trigger language plpgsql security definer set search_path=public as $$begin
 if exists(select 1 from credential_vault where user_id=old.id) then
  if new.email is distinct from old.email then raise exception 'A identidade técnica do Alvorecer não pode ser alterada'; end if;
  if new.encrypted_password is distinct from old.encrypted_password and not exists(select 1 from credential_vault where user_id=old.id and pending_ciphertext is not null) then
   raise exception 'Altere a senha pelo painel do mestre';
  end if;
 end if;
 return new;
end$$;
revoke execute on function public.guard_rpg_identity() from public,anon,authenticated;
create trigger alvorecer_identity_guard before update of email,encrypted_password on auth.users for each row execute function public.guard_rpg_identity();
