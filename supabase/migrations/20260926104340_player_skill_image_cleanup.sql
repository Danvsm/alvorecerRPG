-- Permite ao dono limpar arquivos substituídos ou órfãos após a edição/exclusão.
drop policy character_skill_image_read on storage.objects;
create policy character_skill_image_read on storage.objects
for select to authenticated using (
  bucket_id = 'character-skills' and (
    exists (select 1 from public.character_skills s
      where s.image_path = storage.objects.name and public.can_character(s.character_id))
    or exists (select 1 from public.characters ch
      where ch.id::text = (storage.foldername(storage.objects.name))[1]
        and ch.owner_id = (select auth.uid()) and not ch.archived
        and public.is_member(ch.campaign_id))
  )
);
