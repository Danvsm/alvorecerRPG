create function alvorecer_private.archive_detached_identity() returns trigger language plpgsql set search_path=public as $$
begin
 if new.kind<>'npc' and new.user_id is null then new.active:=false; end if;
 return new;
end$$;
create trigger identity_detached before update of user_id on social_identities for each row execute function alvorecer_private.archive_detached_identity();
update social_identities set active=false where user_id is null and kind<>'npc';
