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
  const expiredChat = await db
    .from("chat_media")
    .select("id,storage_path")
    .is("deleted_at", null)
    .lte("expires_at", now)
    .order("expires_at")
    .limit(100);
  if (expiredChat.error) throw new Error("Falha ao listar imagens expiradas");

  let removedChat = 0;
  for (const media of expiredChat.data || []) {
    const deletion = await db.storage
      .from("chat-media")
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

  const pendingChat = (expiredChat.data || []).length - removedChat;
  const pendingStories =
    (expiredStories.data || []).length -
    removedStories +
    (queuedStories.data || []).length -
    removedQueuedStories;
  return Response.json({
    removed: removedChat + removedStories + removedQueuedStories,
    pending: pendingChat + pendingStories,
    chat: { removed: removedChat, pending: pendingChat },
    stories: {
      expired: removedStories,
      queued: removedQueuedStories,
      pending: pendingStories,
    },
  });
}
