-- Complete the public recruitment intake and expose only master-scoped RPCs.
-- The underlying table remains in a private schema with no Data API grants.

alter table alvorecer_private.recruitment_applications
  add column if not exists preferred_name text,
  add column if not exists city text,
  add column if not exists neighborhood text,
  add column if not exists availability text,
  add column if not exists preferred_time text,
  add column if not exists expectations text,
  add column if not exists avoided_content text,
  add column if not exists discovery_source text,
  add column if not exists campaign_name text not null
    default 'A Promessa do Amanhecer',
  add column if not exists private_notes text not null default '';

alter table alvorecer_private.recruitment_applications
  alter column instagram drop not null;

update alvorecer_private.recruitment_applications
set status = case status
  when 'selected' then 'approved'
  when 'declined' then 'not_selected'
  when 'archived' then 'not_selected'
  else status
end;

alter table alvorecer_private.recruitment_applications
  drop constraint if exists recruitment_applications_status_check;

alter table alvorecer_private.recruitment_applications
  add constraint recruitment_applications_status_check check (
    status in (
      'new', 'reviewing', 'contacted', 'approved', 'waitlist', 'not_selected'
    )
  ),
  add constraint recruitment_applications_preferred_name_check check (
    preferred_name is null or char_length(preferred_name) between 2 and 80
  ),
  add constraint recruitment_applications_city_check check (
    city is null or char_length(city) between 2 and 100
  ),
  add constraint recruitment_applications_neighborhood_check check (
    neighborhood is null or char_length(neighborhood) between 2 and 100
  ),
  add constraint recruitment_applications_private_notes_check check (
    char_length(private_notes) <= 4000
  );

drop function if exists public.submit_recruitment_application(
  text,integer,text,text,text,text,text,text,boolean,text,text
);

create function public.submit_recruitment_application(
  p_full_name text,
  p_preferred_name text,
  p_age integer,
  p_email text,
  p_whatsapp text,
  p_instagram text,
  p_city text,
  p_neighborhood text,
  p_experience_level text,
  p_availability text,
  p_preferred_time text,
  p_expectations text,
  p_avoided_content text,
  p_discovery_source text,
  p_contact_consent boolean,
  p_rate_key text,
  p_website text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  clean_name text := trim(coalesce(p_full_name, ''));
  clean_preferred_name text := trim(coalesce(p_preferred_name, ''));
  clean_email text := lower(trim(coalesce(p_email, '')));
  clean_whatsapp text := trim(coalesce(p_whatsapp, ''));
  clean_phone_digits text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  clean_instagram text := nullif(trim(coalesce(p_instagram, '')), '');
  clean_city text := trim(coalesce(p_city, ''));
  clean_neighborhood text := trim(coalesce(p_neighborhood, ''));
  clean_availability text := trim(coalesce(p_availability, ''));
  clean_preferred_time text := trim(coalesce(p_preferred_time, ''));
  clean_expectations text := trim(coalesce(p_expectations, ''));
  clean_avoided_content text := nullif(trim(coalesce(p_avoided_content, '')), '');
  clean_discovery_source text := trim(coalesce(p_discovery_source, ''));
  existing_id uuid;
  created_id uuid;
begin
  if trim(coalesce(p_website, '')) <> '' then
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
  if char_length(clean_preferred_name) not between 2 and 80 then
    raise exception 'Informe como gostaria de ser chamado.';
  end if;
  if p_age is null or p_age not between 1 and 120 then
    raise exception 'Informe uma idade válida.';
  end if;
  if clean_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Informe um e-mail válido.';
  end if;
  if char_length(clean_phone_digits) not between 8 and 15 then
    raise exception 'Informe um WhatsApp válido.';
  end if;
  if char_length(coalesce(clean_instagram, '')) > 80 then
    raise exception 'O Instagram ficou muito longo.';
  end if;
  if char_length(clean_city) not between 2 and 100 then
    raise exception 'Informe sua cidade ou município.';
  end if;
  if char_length(clean_neighborhood) not between 2 and 100 then
    raise exception 'Informe seu bairro.';
  end if;
  if p_experience_level not in (
    'iniciante', 'algumas_vezes', 'intermediario', 'experiente'
  ) then
    raise exception 'Selecione sua experiência com RPG.';
  end if;
  if char_length(clean_availability) not between 2 and 200 then
    raise exception 'Informe sua disponibilidade.';
  end if;
  if char_length(clean_preferred_time) not between 2 and 120 then
    raise exception 'Informe sua preferência de horário.';
  end if;
  if char_length(clean_expectations) not between 3 and 1500 then
    raise exception 'Conte o que espera de uma mesa de RPG.';
  end if;
  if char_length(coalesce(clean_avoided_content, '')) > 1500 then
    raise exception 'O campo de conteúdo ficou muito longo.';
  end if;
  if char_length(clean_discovery_source) not between 2 and 120 then
    raise exception 'Informe como conheceu o projeto.';
  end if;
  if not coalesce(p_contact_consent, false) then
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

  insert into alvorecer_private.recruitment_applications (
    full_name,
    preferred_name,
    age,
    email,
    whatsapp,
    instagram,
    city,
    neighborhood,
    experience_level,
    availability,
    preferred_time,
    expectations,
    avoided_content,
    discovery_source,
    contact_consent,
    campaign_name,
    status
  )
  values (
    clean_name,
    clean_preferred_name,
    p_age,
    clean_email,
    clean_whatsapp,
    clean_instagram,
    clean_city,
    clean_neighborhood,
    p_experience_level,
    clean_availability,
    clean_preferred_time,
    clean_expectations,
    clean_avoided_content,
    clean_discovery_source,
    true,
    'A Promessa do Amanhecer',
    'new'
  )
  returning id into created_id;

  return created_id;
end
$function$;

revoke all on function public.submit_recruitment_application(
  text,text,integer,text,text,text,text,text,text,text,text,text,text,text,boolean,text,text
) from public, authenticated;

grant execute on function public.submit_recruitment_application(
  text,text,integer,text,text,text,text,text,text,text,text,text,text,text,boolean,text,text
) to anon, service_role;

create or replace function public.master_recruitment_applications(c uuid)
returns table (
  id uuid,
  full_name text,
  preferred_name text,
  age smallint,
  email text,
  whatsapp text,
  instagram text,
  city text,
  neighborhood text,
  experience_level text,
  availability text,
  preferred_time text,
  expectations text,
  avoided_content text,
  discovery_source text,
  campaign_name text,
  status text,
  private_notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_master(c) then
    raise exception 'Somente o Mestre pode consultar inscrições';
  end if;

  if not exists (
    select 1
    from public.campaigns campaign
    where campaign.id = c
      and campaign.name = 'A Promessa do Amanhecer'
  ) then
    raise exception 'Campanha não autorizada';
  end if;

  return query
  select
    application.id,
    application.full_name,
    application.preferred_name,
    application.age,
    application.email,
    application.whatsapp,
    application.instagram,
    application.city,
    application.neighborhood,
    application.experience_level,
    application.availability,
    application.preferred_time,
    application.expectations,
    application.avoided_content,
    application.discovery_source,
    application.campaign_name,
    application.status,
    application.private_notes,
    application.created_at,
    application.updated_at
  from alvorecer_private.recruitment_applications application
  where application.campaign_name = 'A Promessa do Amanhecer'
  order by
    case application.status
      when 'new' then 0
      when 'reviewing' then 1
      when 'contacted' then 2
      else 3
    end,
    application.created_at desc;
end
$function$;

revoke all on function public.master_recruitment_applications(uuid)
  from public, anon;
grant execute on function public.master_recruitment_applications(uuid)
  to authenticated, service_role;

create or replace function public.master_recruitment_application_update(
  c uuid,
  target uuid,
  next_status text,
  notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not public.is_master(c) then
    raise exception 'Somente o Mestre pode atualizar inscrições';
  end if;

  if next_status not in (
    'new', 'reviewing', 'contacted', 'approved', 'waitlist', 'not_selected'
  ) then
    raise exception 'Status inválido';
  end if;

  if char_length(coalesce(notes, '')) > 4000 then
    raise exception 'As notas privadas ficaram muito longas';
  end if;

  update alvorecer_private.recruitment_applications application
  set
    status = next_status,
    private_notes = trim(coalesce(notes, '')),
    updated_at = now()
  where application.id = target
    and application.campaign_name = 'A Promessa do Amanhecer'
    and exists (
      select 1
      from public.campaigns campaign
      where campaign.id = c
        and campaign.name = application.campaign_name
    );

  if not found then
    raise exception 'Inscrição não encontrada';
  end if;
end
$function$;

revoke all on function public.master_recruitment_application_update(
  uuid,uuid,text,text
) from public, anon;
grant execute on function public.master_recruitment_application_update(
  uuid,uuid,text,text
) to authenticated, service_role;

revoke all on alvorecer_private.recruitment_applications
  from public, anon, authenticated;
