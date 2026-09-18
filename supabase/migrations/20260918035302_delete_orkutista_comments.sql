-- Comment authors may delete their own comments; the campaign master may
-- delete any comment. Replies and likes are removed by existing cascades.

create function public.community_comment_action(c uuid,op text,d jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.social_identities;
declare target public.community_post_comments;
begin
  actor:=alvorecer_private.require_community_actor(
    c,
    (d->>'actor_id')::uuid
  );

  if op<>'delete_comment' then
    raise exception 'Ação de comentário inválida';
  end if;

  select comment.* into target
  from public.community_post_comments comment
  join public.community_posts post on post.id=comment.post_id
  where comment.id=(d->>'comment_id')::uuid
    and post.campaign_id=c
    and post.archived_at is null
  for update of comment;

  if target.id is null then raise exception 'Comentário inválido'; end if;
  if target.author_id<>actor.id and not public.is_master(c) then
    raise exception 'Sem permissão para excluir este comentário';
  end if;

  delete from public.community_post_comments where id=target.id;
  update public.campaign_events
  set revision=revision+1 where campaign_id=c;

  return jsonb_build_object('id',target.id,'deleted',true);
end$$;

revoke all on function public.community_comment_action(uuid,text,jsonb)
  from public,anon;
grant execute on function public.community_comment_action(uuid,text,jsonb)
  to authenticated;
