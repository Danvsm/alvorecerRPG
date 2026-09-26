-- A coluna "name" existe tanto em storage.objects quanto em characters.
-- Qualificá-la evita que a política compare a pasta com o nome do personagem.
drop policy if exists character_skill_image_insert on storage.objects;
create policy character_skill_image_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'character-skills'
  and array_length(storage.foldername(storage.objects.name), 1) = 2
  and exists (
    select 1 from public.characters ch
    where ch.id::text = (storage.foldername(storage.objects.name))[1]
      and ch.owner_id = (select auth.uid())
      and not ch.archived
      and public.is_member(ch.campaign_id)
  )
);

drop policy if exists character_skill_image_delete on storage.objects;
create policy character_skill_image_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'character-skills'
  and exists (
    select 1 from public.characters ch
    where ch.id::text = (storage.foldername(storage.objects.name))[1]
      and ch.owner_id = (select auth.uid())
      and not ch.archived
      and public.is_member(ch.campaign_id)
  )
);
