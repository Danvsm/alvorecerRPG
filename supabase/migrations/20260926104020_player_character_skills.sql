-- Habilidades criadas pelo jogador, vinculadas à ficha e limitadas no banco.
create table public.character_skills (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references public.characters(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  level integer not null default 1 check (level between 1 and 99),
  cost_type text not null default 'mana' check (cost_type in ('mana','stamina','life','fury','other')),
  cost_amount integer not null default 0 check (cost_amount between 0 and 99999),
  other_cost_label text not null default '' check (char_length(other_cost_label) <= 40),
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint character_skill_image_path check (
    image_path is null or image_path like character_id::text || '/' || id::text || '/%'
  ),
  constraint character_skill_other_label check (
    cost_type <> 'other' or char_length(btrim(other_cost_label)) > 0
  )
);

create index character_skills_character_id_idx on public.character_skills(character_id, created_at);

create function public.validate_character_skill()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.character_id <> old.character_id then
    raise exception 'Não é permitido mover uma habilidade entre personagens';
  end if;
  if tg_op = 'INSERT' then
    -- Serializa inclusões na mesma ficha para impor o limite mesmo em abas simultâneas.
    perform 1 from public.characters where id = new.character_id for update;
    if (select count(*) from public.character_skills where character_id = new.character_id) >= 13 then
      raise exception 'Limite de 13 habilidades por personagem';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
create trigger validate_character_skill_before_write
before insert or update on public.character_skills
for each row execute function public.validate_character_skill();

alter table public.character_skills enable row level security;
create policy character_skills_read on public.character_skills
for select to authenticated using (public.can_character(character_id));
create policy character_skills_insert on public.character_skills
for insert to authenticated with check (
  exists (select 1 from public.characters ch where ch.id = character_id
    and ch.owner_id = (select auth.uid()) and not ch.archived
    and public.is_member(ch.campaign_id))
);
create policy character_skills_update on public.character_skills
for update to authenticated using (
  exists (select 1 from public.characters ch where ch.id = character_id
    and ch.owner_id = (select auth.uid()) and not ch.archived
    and public.is_member(ch.campaign_id))
) with check (
  exists (select 1 from public.characters ch where ch.id = character_id
    and ch.owner_id = (select auth.uid()) and not ch.archived
    and public.is_member(ch.campaign_id))
);
create policy character_skills_delete on public.character_skills
for delete to authenticated using (
  exists (select 1 from public.characters ch where ch.id = character_id
    and ch.owner_id = (select auth.uid()) and not ch.archived
    and public.is_member(ch.campaign_id))
);
revoke all on public.character_skills from anon;
grant select, insert, update, delete on public.character_skills to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('character-skills', 'character-skills', false, 307200,
  array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public = false, file_size_limit = 307200,
  allowed_mime_types = excluded.allowed_mime_types;

create policy character_skill_image_read on storage.objects
for select to authenticated using (
  bucket_id = 'character-skills' and exists (
    select 1 from public.character_skills s
    where s.image_path = storage.objects.name and public.can_character(s.character_id)
  )
);
create policy character_skill_image_insert on storage.objects
for insert to authenticated with check (
  bucket_id = 'character-skills' and array_length(storage.foldername(name), 1) = 2
  and exists (select 1 from public.characters ch
    where ch.id::text = (storage.foldername(name))[1]
      and ch.owner_id = (select auth.uid()) and not ch.archived
      and public.is_member(ch.campaign_id))
);
create policy character_skill_image_delete on storage.objects
for delete to authenticated using (
  bucket_id = 'character-skills' and exists (select 1 from public.characters ch
    where ch.id::text = (storage.foldername(name))[1]
      and ch.owner_id = (select auth.uid()) and not ch.archived
      and public.is_member(ch.campaign_id))
);
