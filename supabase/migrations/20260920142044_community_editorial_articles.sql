create table public.community_articles (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  category text not null check (
    category in (
      'world_legends',
      'players',
      'character_stories',
      'world_history'
    )
  ),
  title text not null check (char_length(btrim(title)) between 3 and 100),
  summary text not null check (char_length(btrim(summary)) between 10 and 240),
  body text not null check (char_length(btrim(body)) between 50 and 20000),
  cover_path text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index community_articles_campaign_category_idx
  on public.community_articles(campaign_id, category, published_at desc)
  where archived_at is null;

create index community_articles_created_by_idx
  on public.community_articles(created_by);

alter table public.community_articles enable row level security;

revoke all on public.community_articles from public, anon, authenticated;
grant select on public.community_articles to authenticated;
grant all on public.community_articles to service_role;

create policy community_articles_read
  on public.community_articles
  for select
  to authenticated
  using (
    public.is_member(campaign_id)
    and (archived_at is null or public.is_master(campaign_id))
  );

insert into storage.buckets(
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values(
  'community-articles',
  'community-articles',
  false,
  1048576,
  array['image/webp']
)
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy community_article_media_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id='community-articles'
    and exists(
      select 1
      from public.campaigns campaign
      where campaign.id::text=(storage.foldername(storage.objects.name))[1]
        and public.is_member(campaign.id)
    )
  );

create policy community_article_media_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id='community-articles'
    and exists(
      select 1
      from public.campaigns campaign
      where campaign.id::text=(storage.foldername(storage.objects.name))[1]
        and public.is_master(campaign.id)
    )
  );

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
        and public.is_master(campaign.id)
    )
  );

create function public.community_article_action(c uuid, op text, d jsonb)
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
begin
  if (select auth.uid()) is null or not public.is_master(c) then
    raise exception 'Somente Pink pode administrar as histórias';
  end if;

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
      (select auth.uid())
    )
    returning * into target;

  elsif op='update' then
    article_id:=(d->>'id')::uuid;
    select * into target
    from public.community_articles article
    where article.id=article_id and article.campaign_id=c
    for update;
    if target.id is null then raise exception 'História não encontrada'; end if;

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
    article_id:=(d->>'id')::uuid;
    update public.community_articles article set
      archived_at=case when op='archive' then now() else null end,
      updated_at=now()
    where article.id=article_id and article.campaign_id=c
    returning * into target;
    if target.id is null then raise exception 'História não encontrada'; end if;

  elsif op='delete' then
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
    (select auth.uid())
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
