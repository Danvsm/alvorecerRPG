-- Stories represent authenticated players and the master, never unowned NPCs.
create or replace function alvorecer_private.require_story_actor(
  c uuid,
  requested uuid
) returns public.social_identities
language plpgsql stable security definer set search_path=public as $$
declare actor public.social_identities;
begin
  if (select auth.uid()) is null or not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select identity.* into actor
  from public.social_identities identity
  where identity.id=requested
    and identity.campaign_id=c
    and identity.active
    and identity.user_id=(select auth.uid());

  if actor.id is null then raise exception 'Identidade inválida'; end if;
  return actor;
end$$;

revoke all on function alvorecer_private.require_story_actor(uuid,uuid)
  from public,anon,authenticated;

drop policy community_story_media_insert on storage.objects;
create policy community_story_media_insert on storage.objects
  for insert to authenticated with check(
    bucket_id='community-stories'
    and storage.extension(name)='webp'
    and exists(
      select 1 from public.social_identities identity
      where identity.campaign_id::text=(storage.foldername(storage.objects.name))[1]
        and identity.id::text=(storage.foldername(storage.objects.name))[2]
        and identity.active
        and identity.user_id=(select auth.uid())
    )
  );
