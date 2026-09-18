-- Character deletion should never be blocked by active combat usage.
-- The master can delete a character in one click; character-owned RPG data is
-- removed by existing ON DELETE CASCADE constraints, financial/audit history is
-- preserved through SET NULL/labels, and combat participation is removed first.

create or replace function public.lifecycle_action(c uuid, op text, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  entity text:=d->>'entity';
  target uuid:=(d->>'id')::uuid;
  info jsonb;
  name text;
begin
  if not is_master(c) then raise exception 'Somente o mestre'; end if;

  info:=lifecycle_preview(c,entity,target);
  name:=info->>'name';

  if op in ('archive','restore') then
    case entity
      when 'character' then
        update characters
        set archived=(op='archive'),
            archived_at=case when op='archive' then now() else null end
        where id=target and campaign_id=c;
      when 'creature' then
        update creature_templates
        set active=(op='restore'),
            archived_at=case when op='archive' then now() else null end
        where id=target and campaign_id=c;
      when 'item' then
        update items
        set active=(op='restore'),
            archived_at=case when op='archive' then now() else null end
        where id=target and campaign_id=c;
      when 'advantage' then
        update advantages
        set active=(op='restore'),
            archived_at=case when op='archive' then now() else null end
        where id=target and campaign_id=c;
      when 'shop' then
        update shops
        set active=(op='restore'),
            archived_at=case when op='archive' then now() else null end
        where id=target and campaign_id=c;
      when 'product' then
        update shop_products sp
        set active=(op='restore'),
            archived_at=case when op='archive' then now() else null end
        from shops s
        where sp.id=target and s.id=sp.shop_id and s.campaign_id=c;
      when 'attribute' then
        update attributes
        set active=(op='restore'),
            archived_at=case when op='archive' then now() else null end
        where id=target and campaign_id=c;
      else
        raise exception 'Tipo inválido';
    end case;

    perform record_event(
      c,
      case when entity='character' then target else null end,
      entity||case when op='archive' then '_archived' else '_restored' end,
      jsonb_build_object('name',name)
    );

  elsif op='delete' then
    if entity='character' then
      update audit_logs
      set character_label=coalesce(character_label,name)
      where character_id=target;

      delete from combat_participants
      where character_id=target;

      delete from characters
      where id=target and campaign_id=c;

    elsif entity='creature' then
      if (info->>'active_combats')::integer>0 then
        raise exception 'Esta criatura está sendo usada em um combate ativo. Retire-a antes de excluir.';
      end if;
      delete from creature_templates where id=target and campaign_id=c;

    elsif entity='item' then
      if (info->>'inventories')::integer>0 or (info->>'products')::integer>0 then
        raise exception 'O item ainda está em inventários ou lojas';
      end if;
      delete from items where id=target and campaign_id=c;

    elsif entity='advantage' then
      if (info->>'characters')::integer>0 then
        raise exception 'A vantagem ainda está atribuída a personagens';
      end if;
      delete from advantages where id=target and campaign_id=c;

    elsif entity='shop' then
      if (info->>'products')::integer>0 then
        raise exception 'Remova os produtos antes de excluir a loja';
      end if;
      delete from shops where id=target and campaign_id=c;

    elsif entity='product' then
      delete from shop_products sp
      using shops s
      where sp.id=target and s.id=sp.shop_id and s.campaign_id=c;

    elsif entity='attribute' then
      if (info->>'values')::integer>0
         or (info->>'resources')::integer>0
         or (info->>'campaign_rules')::integer>0 then
        raise exception 'O atributo ainda possui valores ou regras vinculadas';
      end if;
      delete from attributes where id=target and campaign_id=c;

    else
      raise exception 'Tipo inválido';
    end if;

    perform record_event(
      c,
      null,
      entity||'_deleted',
      jsonb_build_object('name',name,'id',target)
    );
  else
    raise exception 'Ação inválida';
  end if;

  return info;
end
$function$;
