-- Players may publish at most three articles in the Players collection and
-- edit only their own work. Pink keeps full editorial control everywhere.

drop policy if exists community_article_media_insert on storage.objects;
create policy community_article_media_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id='community-articles'
    and storage.extension(storage.objects.name)='webp'
    and (storage.foldername(storage.objects.name))[2]='editorial'
    and exists(
      select 1
      from public.campaigns campaign
      where campaign.id::text=(storage.foldername(storage.objects.name))[1]
        and (
          public.is_master(campaign.id)
          or (
            public.is_member(campaign.id)
            and (select auth.uid()) is not null
            and (storage.foldername(storage.objects.name))[3]
              =(select auth.uid())::text
          )
        )
    )
  );

drop policy if exists community_article_media_delete on storage.objects;
create policy community_article_media_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id='community-articles'
    and exists(
      select 1
      from public.campaigns campaign
      where campaign.id::text=(storage.foldername(storage.objects.name))[1]
        and (
          public.is_master(campaign.id)
          or (
            public.is_member(campaign.id)
            and (select auth.uid()) is not null
            and (storage.foldername(storage.objects.name))[3]
              =(select auth.uid())::text
            and not exists(
              select 1
              from public.community_articles article
              where article.cover_path=storage.objects.name
            )
          )
        )
    )
  );

create or replace function public.community_article_player_status(c uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  article_count integer;
begin
  if (select auth.uid()) is null or not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;

  select count(*)::integer into article_count
  from public.community_articles article
  where article.campaign_id=c
    and article.category='players'
    and article.created_by=(select auth.uid());

  return jsonb_build_object(
    'count',article_count,
    'limit',3,
    'can_create',public.is_master(c) or article_count<3
  );
end;
$$;

revoke all on function public.community_article_player_status(uuid)
  from public,anon,authenticated;
grant execute on function public.community_article_player_status(uuid)
  to authenticated,service_role;

create or replace function public.community_article_action(c uuid, op text, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.community_articles;
  article_id uuid;
  article_category text;
  article_title text;
  article_summary text;
  article_body text;
  article_cover_path text;
  previous_cover_path text;
  caller_id uuid:=(select auth.uid());
  caller_is_master boolean;
begin
  if caller_id is null or not public.is_member(c) then
    raise exception 'Sem permissão';
  end if;
  caller_is_master:=public.is_master(c);

  if op='create' then
    article_category:=btrim(coalesce(d->>'category',''));
    article_title:=btrim(coalesce(d->>'title',''));
    article_summary:=btrim(coalesce(d->>'summary',''));
    article_body:=btrim(coalesce(d->>'body',''));
    article_cover_path:=btrim(coalesce(d->>'cover_path',''));

    if article_category not in (
      'world_legends',
      'players',
      'character_stories',
      'world_history'
    ) then
      raise exception 'Categoria inválida';
    end if;
    if not caller_is_master and article_category<>'players' then
      raise exception 'Jogadores só podem publicar no card Jogadores';
    end if;
    if not caller_is_master then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(c::text || ':' || caller_id::text,0)
      );
      if (
        select count(*)
        from public.community_articles article
        where article.campaign_id=c
          and article.category='players'
          and article.created_by=caller_id
      )>=3 then
        raise exception 'Você já publicou o limite de 3 histórias';
      end if;
    end if;
    if char_length(article_title) not between 3 and 100 then
      raise exception 'O título deve ter entre 3 e 100 caracteres';
    end if;
    if char_length(article_summary) not between 10 and 240 then
      raise exception 'A descrição deve ter entre 10 e 240 caracteres';
    end if;
    if char_length(article_body) not between 50 and 20000 then
      raise exception 'A história deve ter entre 50 e 20.000 caracteres';
    end if;
    if not exists(
      select 1
      from storage.objects object
      where object.bucket_id='community-articles'
        and object.name=article_cover_path
        and (storage.foldername(object.name))[1]=c::text
        and (
          caller_is_master
          or (storage.foldername(object.name))[3]=caller_id::text
        )
    ) then
      raise exception 'A capa enviada não foi encontrada';
    end if;

    insert into public.community_articles(
      campaign_id,
      category,
      title,
      summary,
      body,
      cover_path,
      created_by
    ) values (
      c,
      article_category,
      article_title,
      article_summary,
      article_body,
      article_cover_path,
      caller_id
    )
    returning * into target;

  elsif op='update' then
    article_id:=(d->>'id')::uuid;
    select * into target
    from public.community_articles article
    where article.id=article_id and article.campaign_id=c
    for update;
    if target.id is null then raise exception 'História não encontrada'; end if;
    if not caller_is_master and not (
      target.category='players' and target.created_by=caller_id
    ) then
      raise exception 'Você só pode editar suas histórias do card Jogadores';
    end if;

    article_title:=btrim(coalesce(d->>'title',target.title));
    article_summary:=btrim(coalesce(d->>'summary',target.summary));
    article_body:=btrim(coalesce(d->>'body',target.body));
    article_cover_path:=btrim(coalesce(d->>'cover_path',target.cover_path));
    previous_cover_path:=target.cover_path;

    if char_length(article_title) not between 3 and 100 then
      raise exception 'O título deve ter entre 3 e 100 caracteres';
    end if;
    if char_length(article_summary) not between 10 and 240 then
      raise exception 'A descrição deve ter entre 10 e 240 caracteres';
    end if;
    if char_length(article_body) not between 50 and 20000 then
      raise exception 'A história deve ter entre 50 e 20.000 caracteres';
    end if;
    if article_cover_path<>target.cover_path and not exists(
      select 1
      from storage.objects object
      where object.bucket_id='community-articles'
        and object.name=article_cover_path
        and (storage.foldername(object.name))[1]=c::text
        and (
          caller_is_master
          or (storage.foldername(object.name))[3]=caller_id::text
        )
    ) then
      raise exception 'A capa enviada não foi encontrada';
    end if;

    update public.community_articles article set
      title=article_title,
      summary=article_summary,
      body=article_body,
      cover_path=article_cover_path,
      updated_at=now()
    where article.id=target.id
    returning * into target;

  elsif op in ('archive','restore') then
    if not caller_is_master then
      raise exception 'Somente Pink pode arquivar histórias';
    end if;
    article_id:=(d->>'id')::uuid;
    update public.community_articles article set
      archived_at=case when op='archive' then now() else null end,
      updated_at=now()
    where article.id=article_id and article.campaign_id=c
    returning * into target;
    if target.id is null then raise exception 'História não encontrada'; end if;

  elsif op='delete' then
    if not caller_is_master then
      raise exception 'Somente Pink pode excluir histórias';
    end if;
    article_id:=(d->>'id')::uuid;
    select * into target
    from public.community_articles article
    where article.id=article_id and article.campaign_id=c
    for update;
    if target.id is null then raise exception 'História não encontrada'; end if;
    previous_cover_path:=target.cover_path;
    delete from public.community_articles article where article.id=target.id;

  else
    raise exception 'Operação inválida';
  end if;

  perform public.record_event(
    c,
    null,
    'community_article_' || op,
    jsonb_build_object(
      'article_id',target.id,
      'category',target.category,
      'title',target.title
    ),
    caller_id
  );

  return jsonb_build_object(
    'article_id',target.id,
    'cover_path',target.cover_path,
    'previous_cover_path',previous_cover_path
  );
end;
$$;

revoke all on function public.community_article_action(uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.community_article_action(uuid,text,jsonb)
  to authenticated,service_role;
