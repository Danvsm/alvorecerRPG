alter table public.campaign_members
  add column if not exists web_access_enabled boolean not null default false;

create or replace function public.set_player_web_access(
  c uuid,
  p_user_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_master(c) then
    raise exception 'Apenas o Mestre pode alterar o acesso pelo navegador.';
  end if;

  update public.campaign_members
  set web_access_enabled = coalesce(p_enabled, false)
  where campaign_id = c
    and user_id = p_user_id
    and role = 'player';

  if not found then
    raise exception 'Jogador não encontrado nesta campanha.';
  end if;

  perform public.record_event(
    c,
    null,
    case when p_enabled then 'player_web_access_enabled'
         else 'player_web_access_disabled'
    end,
    jsonb_build_object(
      'user_id', p_user_id,
      'web_access_enabled', coalesce(p_enabled, false)
    )
  );

  return coalesce(p_enabled, false);
end
$$;

revoke all on function public.set_player_web_access(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.set_player_web_access(uuid, uuid, boolean)
  to authenticated, service_role;
