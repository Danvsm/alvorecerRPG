import { admin } from "./server.ts";

export async function cleanup(req: Request) {
  const token = req.headers.get("x-cleanup-token");
  if (!token)
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  const db = admin();
  const verified = await db.rpc("verify_media_cleanup", { token });
  if (verified.error || verified.data !== true)
    return Response.json({ error: "Não autorizado" }, { status: 401 });

  const now = new Date().toISOString();
  const abandonedChat = await db
    .from("chat_media")
    .select("id,storage_path,media_type")
    .eq("consumed", false)
    .is("deleted_at", null)
    .lte("upload_expires_at", now)
    .order("upload_expires_at")
    .limit(100);
  if (abandonedChat.error)
    throw new Error("Falha ao listar anexos abandonados");

  let removedAbandonedChat = 0;
  for (const media of abandonedChat.data || []) {
    const bucket = media.media_type === "audio" ? "chat-audio" : "chat-media";
    const deletion = await db.storage.from(bucket).remove([media.storage_path]);
    if (deletion.error) continue;
    const saved = await db
      .from("chat_media")
      .update({ deleted_at: now })
      .eq("id", media.id)
      .eq("consumed", false);
    if (!saved.error) removedAbandonedChat++;
  }

  const expiredChat = await db
    .from("chat_media")
    .select("id,storage_path,archive_expires_at,media_type")
    .eq("consumed", true)
    .is("deleted_at", null)
    .lte("archive_expires_at", now)
    .order("archive_expires_at")
    .limit(100);
  if (expiredChat.error) throw new Error("Falha ao listar imagens expiradas");

  let removedChat = 0;
  for (const media of expiredChat.data || []) {
    const bucket = media.media_type === "audio" ? "chat-audio" : "chat-media";
    const deletion = await db.storage
      .from(bucket)
      .remove([media.storage_path]);
    if (deletion.error) continue;
    const saved = await db
      .from("chat_media")
      .update({ deleted_at: now })
      .eq("id", media.id);
    if (!saved.error) removedChat++;
  }

  const expiredStories = await db
    .from("community_stories")
    .select("id,image_path")
    .lte("expires_at", now)
    .order("expires_at")
    .limit(100);
  if (expiredStories.error)
    throw new Error("Falha ao listar Stories expirados");

  let removedStories = 0;
  for (const story of expiredStories.data || []) {
    const deletion = await db.storage
      .from("community-stories")
      .remove([story.image_path]);
    if (deletion.error) continue;
    const saved = await db
      .from("community_stories")
      .delete()
      .eq("id", story.id);
    if (saved.error) continue;
    await db
      .from("community_story_cleanup")
      .delete()
      .eq("image_path", story.image_path);
    removedStories++;
  }

  const queuedStories = await db
    .from("community_story_cleanup")
    .select("image_path")
    .order("queued_at")
    .limit(100);
  if (queuedStories.error)
    throw new Error("Falha ao listar imagens de Stories pendentes");

  let removedQueuedStories = 0;
  for (const queued of queuedStories.data || []) {
    const deletion = await db.storage
      .from("community-stories")
      .remove([queued.image_path]);
    if (deletion.error) continue;
    const saved = await db
      .from("community_story_cleanup")
      .delete()
      .eq("image_path", queued.image_path);
    if (!saved.error) removedQueuedStories++;
  }

  const archivedBefore = new Date(
    Date.now() - 24 * 60 * 60 * 1000,
  ).toISOString();
  const expiredPosts = await db
    .from("community_posts")
    .select("id,image_path")
    .not("archived_at", "is", null)
    .lte("archived_at", archivedBefore)
    .order("archived_at")
    .limit(100);
  if (expiredPosts.error)
    throw new Error("Falha ao listar publicações arquivadas expiradas");

  let removedPosts = 0;
  for (const post of expiredPosts.data || []) {
    const deletion = await db.storage
      .from("community-posts")
      .remove([post.image_path]);
    if (deletion.error) continue;
    const saved = await db.from("community_posts").delete().eq("id", post.id);
    if (saved.error) continue;
    await db
      .from("community_post_cleanup")
      .delete()
      .eq("image_path", post.image_path);
    removedPosts++;
  }

  const queuedPosts = await db
    .from("community_post_cleanup")
    .select("image_path")
    .order("queued_at")
    .limit(100);
  if (queuedPosts.error)
    throw new Error("Falha ao listar imagens de publicações pendentes");

  let removedQueuedPosts = 0;
  for (const queued of queuedPosts.data || []) {
    const deletion = await db.storage
      .from("community-posts")
      .remove([queued.image_path]);
    if (deletion.error) continue;
    const saved = await db
      .from("community_post_cleanup")
      .delete()
      .eq("image_path", queued.image_path);
    if (!saved.error) removedQueuedPosts++;
  }

  const pendingChat =
    (expiredChat.data || []).length -
    removedChat +
    (abandonedChat.data || []).length -
    removedAbandonedChat;
  const pendingStories =
    (expiredStories.data || []).length -
    removedStories +
    (queuedStories.data || []).length -
    removedQueuedStories;
  const pendingPosts =
    (expiredPosts.data || []).length -
    removedPosts +
    (queuedPosts.data || []).length -
    removedQueuedPosts;
  return Response.json({
    removed:
      removedChat +
      removedAbandonedChat +
      removedStories +
      removedQueuedStories +
      removedPosts +
      removedQueuedPosts,
    pending: pendingChat + pendingStories + pendingPosts,
    chat: {
      expired: removedChat,
      abandoned: removedAbandonedChat,
      pending: pendingChat,
    },
    stories: {
      expired: removedStories,
      queued: removedQueuedStories,
      pending: pendingStories,
    },
    posts: {
      expired: removedPosts,
      queued: removedQueuedPosts,
      pending: pendingPosts,
    },
  });
}
