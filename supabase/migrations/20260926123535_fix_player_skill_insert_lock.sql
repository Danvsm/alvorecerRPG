-- Players can SELECT their character, but cannot lock its row FOR UPDATE.
-- An advisory transaction lock serializes skill inserts for the same character
-- without requiring UPDATE permission on characters.
create or replace function public.validate_character_skill()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.character_id <> old.character_id then
    raise exception 'Não é permitido mover uma habilidade entre personagens';
  end if;
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.character_id::text, 0)
    );
    if (select count(*) from public.character_skills where character_id = new.character_id) >= 13 then
      raise exception 'Limite de 13 habilidades por personagem';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;
