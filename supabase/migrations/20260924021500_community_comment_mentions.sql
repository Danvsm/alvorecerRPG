create or replace function public.community_feed_action(c uuid, op text, d jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare actor public.social_identities;
declare target_post_record public.community_posts;
declare result_id uuid;
declare target_post uuid;
declare target_comment uuid;
declare requested_parent uuid;
declare active boolean;
declare archived boolean;
declare deleted boolean;
declare media_path text;
declare content text;
declare mentioned_identity public.social_identities;
declare mention_id_text text;
begin
  actor:=alvorecer_private.require_community_actor(c,(d->>'actor_id')::uuid);

  if op='create_post' then
    media_path:=nullif(trim(coalesce(d->>'image_path','')),'');
    content:=trim(coalesce(d->>'caption',''));
    if char_length(content) not between 1 and 2000 then
      raise exception 'Escreva uma publicação de até 2000 caracteres';
    end if;
    if media_path is null and char_length(content)>1000 then
      raise exception 'A publicação de texto aceita até 1000 caracteres';
    end if;
    if media_path is not null then
      if media_path not like c::text||'/'||actor.id::text||'/%'
         or storage.extension(media_path)<>'webp' then
        raise exception 'Imagem da publicação inválida';
      end if;
      if not exists(
        select 1 from storage.objects object
        where object.bucket_id='community-posts' and object.name=media_path
      ) then raise exception 'Envie a foto antes de publicar'; end if;
    end if;

    insert into public.community_posts(campaign_id,author_id,image_path,caption)
    values(c,actor.id,media_path,content)
    returning id into result_id;
    active:=true;

  elsif op='delete_post' then
    select post.* into target_post_record
    from public.community_posts post
    where post.id=(d->>'post_id')::uuid
      and post.campaign_id=c
    for update;
    if target_post_record.id is null then
      raise exception 'Publicação inválida';
    end if;

    if public.is_master(c) then
      delete from public.community_posts where id=target_post_record.id;
      deleted:=true;
      archived:=false;
      media_path:=target_post_record.image_path;
    elsif target_post_record.author_id=actor.id
      and target_post_record.archived_at is null then
      update public.community_posts
      set archived_at=now()
      where id=target_post_record.id;
      deleted:=false;
      archived:=true;
    else
      raise exception 'Sem permissão para excluir esta publicação';
    end if;
    result_id:=target_post_record.id;
    active:=false;

  elsif op='confirm_post_cleanup' then
    if not public.is_master(c) then raise exception 'Sem permissão'; end if;
    media_path:=trim(coalesce(d->>'image_path',''));
    if media_path not like c::text||'/%' then
      raise exception 'Imagem da publicação inválida';
    end if;
    if exists(
      select 1 from storage.objects object
      where object.bucket_id='community-posts' and object.name=media_path
    ) then raise exception 'A imagem ainda não foi removida'; end if;
    delete from public.community_post_cleanup cleanup
    where cleanup.image_path=media_path and cleanup.campaign_id=c;
    active:=false;

  elsif op='post_like' then
    target_post:=(d->>'post_id')::uuid;
    if not exists(
      select 1 from public.community_posts post
      where post.id=target_post and post.campaign_id=c
        and post.archived_at is null
    ) then raise exception 'Publicação inválida'; end if;

    delete from public.community_post_likes
    where post_id=target_post and identity_id=actor.id;
    if found then active:=false;
    else
      insert into public.community_post_likes(post_id,identity_id)
      values(target_post,actor.id);
      active:=true;
    end if;
    result_id:=target_post;

  elsif op='comment' then
    target_post:=(d->>'post_id')::uuid;
    content:=trim(coalesce(d->>'body',''));
    requested_parent:=nullif(d->>'parent_id','')::uuid;
    if char_length(content) not between 1 and 1000 then
      raise exception 'Escreva um comentário de até 1000 caracteres';
    end if;
    if not exists(
      select 1 from public.community_posts post
      where post.id=target_post and post.campaign_id=c
        and post.archived_at is null
    ) then raise exception 'Publicação inválida'; end if;
    if requested_parent is not null and not exists(
      select 1 from public.community_post_comments comment
      where comment.id=requested_parent and comment.post_id=target_post
        and comment.parent_id is null
    ) then raise exception 'Comentário principal inválido'; end if;

    insert into public.community_post_comments(post_id,author_id,parent_id,body)
    values(target_post,actor.id,requested_parent,content)
    returning id into result_id;
    active:=true;

    if jsonb_typeof(d->'mention_ids')='array' then
      for mention_id_text in
        select distinct value
        from jsonb_array_elements_text(d->'mention_ids')
      loop
        begin
          select identity.* into mentioned_identity
          from public.social_identities identity
          join public.campaign_members member
            on member.campaign_id=identity.campaign_id
           and member.user_id=identity.user_id
          where identity.id=mention_id_text::uuid
            and identity.campaign_id=c
            and identity.kind='player'
            and identity.active
            and identity.user_id is not null
            and member.role='player'
            and member.access_active
            and member.archived_at is null
          limit 1;
        exception when invalid_text_representation then
          mentioned_identity:=null;
        end;

        if mentioned_identity.id is not null
           and mentioned_identity.id<>actor.id
           and (
             actor.user_id is null
             or mentioned_identity.user_id<>actor.user_id
           ) then
          insert into public.notifications(
            campaign_id,
            user_id,
            kind,
            title,
            body,
            reference_id
          ) values(
            c,
            mentioned_identity.user_id,
            'mention',
            left(actor.name||' mencionou '||mentioned_identity.name,100),
            'Você recebeu uma menção em um comentário da Comunidade.',
            target_post::text
          );
        end if;
        mentioned_identity:=null;
      end loop;
    end if;

  elsif op='comment_like' then
    target_comment:=(d->>'comment_id')::uuid;
    if not exists(
      select 1
      from public.community_post_comments comment
      join public.community_posts post on post.id=comment.post_id
      where comment.id=target_comment and post.campaign_id=c
        and post.archived_at is null
    ) then raise exception 'Comentário inválido'; end if;

    delete from public.community_comment_likes
    where comment_id=target_comment and identity_id=actor.id;
    if found then active:=false;
    else
      insert into public.community_comment_likes(comment_id,identity_id)
      values(target_comment,actor.id);
      active:=true;
    end if;
    result_id:=target_comment;

  else raise exception 'Ação de feed inválida';
  end if;

  if op in (
    'create_post','delete_post','post_like','comment','comment_like'
  ) then
    perform alvorecer_private.bump_community_event(
      c,
      'feed',
      actor.id,
      op,
      case
        when op in ('comment','post_like') then target_post
        when op='comment_like' then target_comment
        else result_id
      end
    );
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id',result_id,'active',active,'archived',archived,'deleted',deleted,
    'image_path',media_path
  ));
end
$function$;
