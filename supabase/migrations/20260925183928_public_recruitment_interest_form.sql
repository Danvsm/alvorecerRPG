create table if not exists alvorecer_private.recruitment_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 3 and 120),
  age smallint not null check (age between 1 and 120),
  instagram text not null check (char_length(instagram) between 2 and 80),
  whatsapp text not null check (char_length(whatsapp) between 8 and 32),
  email text not null check (char_length(email) between 5 and 254),
  experience_level text not null check (
    experience_level in ('iniciante','algumas_vezes','intermediario','experiente')
  ),
  systems_played text,
  about text,
  contact_consent boolean not null default false,
  status text not null default 'new' check (
    status in ('new','reviewing','contacted','selected','declined','archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table alvorecer_private.recruitment_applications enable row level security;
revoke all on alvorecer_private.recruitment_applications
  from public, anon, authenticated;

create index if not exists recruitment_applications_created_idx
  on alvorecer_private.recruitment_applications (created_at desc);

create index if not exists recruitment_applications_status_created_idx
  on alvorecer_private.recruitment_applications (status, created_at desc);

create or replace function public.submit_recruitment_application(
  p_full_name text,
  p_age integer,
  p_instagram text,
  p_whatsapp text,
  p_email text,
  p_experience_level text,
  p_systems_played text default null,
  p_about text default null,
  p_contact_consent boolean default false,
  p_rate_key text default '',
  p_website text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  clean_name text := trim(coalesce(p_full_name,''));
  clean_instagram text := trim(coalesce(p_instagram,''));
  clean_whatsapp text := trim(coalesce(p_whatsapp,''));
  clean_phone_digits text := regexp_replace(coalesce(p_whatsapp,''), '\D', '', 'g');
  clean_email text := lower(trim(coalesce(p_email,'')));
  clean_systems text := nullif(trim(coalesce(p_systems_played,'')), '');
  clean_about text := nullif(trim(coalesce(p_about,'')), '');
  existing_id uuid;
  created_id uuid;
begin
  if trim(coalesce(p_website,'')) <> '' then
    raise exception 'Não foi possível enviar a inscrição.';
  end if;

  if p_rate_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Não foi possível validar a inscrição.';
  end if;

  if not public.throttle('recruitment:' || p_rate_key, 5) then
    raise exception 'Muitas tentativas. Aguarde alguns minutos.';
  end if;

  if char_length(clean_name) not between 3 and 120 then
    raise exception 'Informe seu nome e sobrenome.';
  end if;
  if p_age is null or p_age not between 1 and 120 then
    raise exception 'Informe uma idade válida.';
  end if;
  if char_length(clean_instagram) not between 2 and 80 then
    raise exception 'Informe seu Instagram.';
  end if;
  if char_length(clean_phone_digits) not between 8 and 15 then
    raise exception 'Informe um WhatsApp válido.';
  end if;
  if clean_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Informe um e-mail válido.';
  end if;
  if p_experience_level not in (
    'iniciante','algumas_vezes','intermediario','experiente'
  ) then
    raise exception 'Selecione sua experiência com RPG.';
  end if;
  if char_length(coalesce(clean_systems,'')) > 1000 then
    raise exception 'A lista de sistemas ficou muito longa.';
  end if;
  if char_length(coalesce(clean_about,'')) > 1200 then
    raise exception 'Sua apresentação ficou muito longa.';
  end if;
  if not coalesce(p_contact_consent,false) then
    raise exception 'Autorize o contato para concluir.';
  end if;

  select application.id
    into existing_id
  from alvorecer_private.recruitment_applications application
  where application.created_at > now() - interval '30 minutes'
    and (
      lower(application.email) = clean_email
      or regexp_replace(application.whatsapp, '\D', '', 'g') = clean_phone_digits
    )
  order by application.created_at desc
  limit 1;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into alvorecer_private.recruitment_applications(
    full_name, age, instagram, whatsapp, email, experience_level,
    systems_played, about, contact_consent
  )
  values(
    clean_name, p_age, clean_instagram, clean_whatsapp, clean_email,
    p_experience_level, clean_systems, clean_about, true
  )
  returning id into created_id;

  return created_id;
end
$function$;

revoke all on function public.submit_recruitment_application(
  text,integer,text,text,text,text,text,text,boolean,text,text
) from public, authenticated;

grant execute on function public.submit_recruitment_application(
  text,integer,text,text,text,text,text,text,boolean,text,text
) to anon, service_role;
