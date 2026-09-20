import { admin, member } from "./server.ts";
import { inspectAudioDuration } from "./audio-duration.ts";

const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 5 * 60 * 1000;
const ALLOWED_MIME_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4"]);

type AudioFinalizeBody = {
  campaign?: unknown;
  actorId?: unknown;
  mediaId?: unknown;
  durationMs?: unknown;
  waveform?: unknown;
};

function uuid(value: unknown, field: string) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${field} inválido.`);
  }
  return value;
}

function normalizedWaveform(value: unknown) {
  if (value == null) return null;
  if (!Array.isArray(value) || !value.length || value.length > 64) {
    throw new Error("Forma de onda inválida.");
  }
  return value.map((point) => {
    const number = Number(point);
    if (!Number.isFinite(number) || number < 0 || number > 100) {
      throw new Error("Forma de onda inválida.");
    }
    return Math.round(number);
  });
}

async function rejectUpload(mediaId: string, storagePath: string) {
  const db = admin();
  await db.storage.from("chat-audio").remove([storagePath]);
  await db
    .from("chat_media")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", mediaId)
    .eq("consumed", false);
}

export async function finalizeAudio(req: Request) {
  const body = (await req.json()) as AudioFinalizeBody;
  const campaignId = uuid(body.campaign, "Campanha");
  const actorId = uuid(body.actorId, "Identidade");
  const mediaId = uuid(body.mediaId, "Áudio");
  const waveform = normalizedWaveform(body.waveform);
  const claimedDurationMs = Math.round(Number(body.durationMs));
  if (
    !Number.isFinite(claimedDurationMs) ||
    claimedDurationMs < 250 ||
    claimedDurationMs > MAX_AUDIO_DURATION_MS
  ) {
    throw new Error("Duração de áudio inválida.");
  }
  const context = await member(req, campaignId);

  const { data: media, error: mediaError } = await context.db
    .from("chat_media")
    .select(
      "id,conversation_id,sender_id,uploader_id,storage_path,media_type,mime_type,consumed,deleted_at,upload_expires_at",
    )
    .eq("id", mediaId)
    .maybeSingle();

  if (mediaError || !media) throw new Error("Áudio não encontrado.");
  if (media.consumed) {
    const { data: existing } = await context.db
      .from("direct_messages")
      .select("id")
      .eq("media_id", mediaId)
      .maybeSingle();
    if (existing) return Response.json({ id: existing.id, media_id: mediaId });
  }

  const mimeType = String(media.mime_type || "").toLowerCase();
  if (
    media.media_type !== "audio" ||
    media.sender_id !== actorId ||
    media.uploader_id !== context.user.id ||
    media.deleted_at ||
    Date.parse(media.upload_expires_at) <= Date.now() ||
    !ALLOWED_MIME_TYPES.has(mimeType)
  ) {
    throw new Error("Reserva de áudio inválida ou expirada.");
  }

  const { data: object, error: downloadError } = await context.db.storage
    .from("chat-audio")
    .download(media.storage_path);
  if (downloadError || !object) throw new Error("Envio do áudio incompleto.");
  if (object.size < 1 || object.size > MAX_AUDIO_BYTES) {
    await rejectUpload(mediaId, media.storage_path);
    throw new Error("O áudio ultrapassa o limite de 3 MB.");
  }

  let durationMs = 0;
  try {
    const bytes = new Uint8Array(await object.arrayBuffer());
    durationMs = inspectAudioDuration(
      bytes,
      mimeType as "audio/webm" | "audio/ogg" | "audio/mp4",
    );
  } catch {
    await rejectUpload(mediaId, media.storage_path);
    throw new Error("O arquivo enviado não é um áudio válido.");
  }

  if (Math.abs(durationMs - claimedDurationMs) > 5000) {
    await rejectUpload(mediaId, media.storage_path);
    throw new Error("A duração informada não corresponde ao arquivo enviado.");
  }

  durationMs = Math.min(durationMs, MAX_AUDIO_DURATION_MS);

  if (durationMs < 250 || durationMs > MAX_AUDIO_DURATION_MS) {
    await rejectUpload(mediaId, media.storage_path);
    throw new Error(
      durationMs > MAX_AUDIO_DURATION_MS
        ? "O áudio ultrapassa o limite de 5 minutos."
        : "O áudio é curto demais.",
    );
  }

  const { data, error } = await context.db.rpc("finalize_chat_audio", {
    p_campaign_id: campaignId,
    p_user_id: context.user.id,
    p_actor_id: actorId,
    p_media_id: mediaId,
    p_mime_type: mimeType,
    p_byte_size: object.size,
    p_duration_ms: durationMs,
    p_waveform: waveform,
  });
  if (error)
    throw new Error(error.message || "Não foi possível enviar o áudio.");

  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
