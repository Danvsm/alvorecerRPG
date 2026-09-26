-- The activity history is retained for 30 days. Financial records are separate.
create index if not exists audit_logs_retention_created_at_idx
  on public.audit_logs(created_at);

create policy audit_logs_recent_only on public.audit_logs
  as restrictive for select to authenticated
  using (created_at >= now() - interval '30 days');

-- Initial cleanup. dracma_transactions.audit_log_id uses ON DELETE SET NULL.
delete from public.audit_logs where created_at < now() - interval '30 days';

-- Daily at 03:00 America/Sao_Paulo (06:00 UTC).
select cron.schedule('alvorecer-audit-retention', '0 6 * * *',
  $job$delete from public.audit_logs where created_at < now() - interval '30 days';$job$);

-- Stop bundling history into every dashboard refresh; load it when viewed.
create or replace function public.game_load_bundle(c uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'tables', jsonb_build_object(
      'resource_rules',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.resource_rules x), '[]'::jsonb),
      'item_effects',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.item_effects x), '[]'::jsonb),
      'shops',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.shops x), '[]'::jsonb),
      'shop_products',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.shop_products x), '[]'::jsonb),
      'characters',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.characters x where x.campaign_id = c), '[]'::jsonb),
      'character_resources',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.character_resources x), '[]'::jsonb),
      'attributes',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.attributes x where x.campaign_id = c), '[]'::jsonb),
      'character_attributes',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.character_attributes x), '[]'::jsonb),
      'advantages',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.advantages x where x.campaign_id = c), '[]'::jsonb),
      'character_advantages',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.character_advantages x), '[]'::jsonb),
      'items',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.items x where x.campaign_id = c), '[]'::jsonb),
      'character_items',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.character_items x), '[]'::jsonb),
      'creature_templates',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.creature_templates x where x.campaign_id = c), '[]'::jsonb),
      'combat_rooms',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.combat_rooms x where x.campaign_id = c), '[]'::jsonb),
      'audit_logs', '[]'::jsonb,
      'invites',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.invites x where x.campaign_id = c), '[]'::jsonb),
      'profiles',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.profiles x), '[]'::jsonb),
      'campaign_members',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.campaign_members x where x.campaign_id = c), '[]'::jsonb),
      'campaign_avatars',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.campaign_avatars x where x.campaign_id = c), '[]'::jsonb),
      'dracma_transactions',
        coalesce((
          select jsonb_agg(to_jsonb(x) order by x.created_at desc)
          from (
            select *
            from public.dracma_transactions
            where campaign_id = c
            order by created_at desc
            limit 200
          ) x
        ), '[]'::jsonb),
      'dracma_charges',
        coalesce((
          select jsonb_agg(to_jsonb(x) order by x.created_at desc)
          from (
            select *
            from public.dracma_charges
            where campaign_id = c
            order by created_at desc
            limit 200
          ) x
        ), '[]'::jsonb),
      'activity_sessions',
        coalesce((
          select jsonb_agg(to_jsonb(x) order by x.started_at desc)
          from (
            select *
            from public.activity_sessions
            where campaign_id = c
            order by started_at desc
            limit 200
          ) x
        ), '[]'::jsonb),
      'session_feedback',
        coalesce((
          select jsonb_agg(to_jsonb(x) order by x.created_at desc)
          from (
            select *
            from public.session_feedback
            where campaign_id = c
            order by created_at desc
            limit 200
          ) x
        ), '[]'::jsonb),
      'social_identities',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.social_identities x where x.campaign_id = c), '[]'::jsonb),
      'cosmetics',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.cosmetics x where x.campaign_id = c), '[]'::jsonb),
      'cosmetic_collections',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.cosmetic_collections x where x.campaign_id = c), '[]'::jsonb),
      'cosmetic_grants',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.cosmetic_grants x), '[]'::jsonb),
      'cosmetic_equipment',
        coalesce((select jsonb_agg(to_jsonb(x)) from public.cosmetic_equipment x), '[]'::jsonb),
      'notifications',
        coalesce((
          select jsonb_agg(to_jsonb(x) order by x.created_at desc)
          from (
            select *
            from public.notifications
            where campaign_id = c
            order by created_at desc
            limit 200
          ) x
        ), '[]'::jsonb)
    ),
    'combat_snapshot', public.combat_snapshot(c),
    'transfer_recipients',
      coalesce((select jsonb_agg(to_jsonb(x)) from public.transfer_recipients(c) x), '[]'::jsonb),
    'combat_identities',
      coalesce((select jsonb_agg(to_jsonb(x)) from public.combat_identities(c) x), '[]'::jsonb),
    'avatar_catalog',
      coalesce((select jsonb_agg(to_jsonb(x)) from public.avatar_catalog(c) x), '[]'::jsonb),
    'frame_catalog',
      coalesce((select jsonb_agg(to_jsonb(x)) from public.frame_catalog(c) x), '[]'::jsonb),
    'campaign',
      (select to_jsonb(x) from public.campaigns x where x.id = c)
  );
$$;

revoke all on function public.game_load_bundle(uuid) from public, anon;
grant execute on function public.game_load_bundle(uuid) to authenticated, service_role;
