import { admin, hash, master, originCheck } from "./server.ts";

const privateDb = () => admin().schema("alvorecer_private");
const bytes = (length: number) => {
  const value = new Uint8Array(length);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function device(req: Request) {
  const token = req.headers.get("x-device-token");
  if (!token) throw new Error("Dispositivo não autorizado");
  const { data } = await privateDb()
    .from("mobile_gallery_devices")
    .select("*")
    .eq("token_hash", hash(token))
    .eq("active", true)
    .maybeSingle();
  if (!data) throw new Error("Dispositivo não autorizado");
  await privateDb().from("mobile_gallery_devices").update({ last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

async function register(req: Request, body: Record<string, unknown>) {
  originCheck(req);
  const campaign = String(body.campaign_id || "");
  const installation = String(body.installation_id || "");
  const name = String(body.device_name || "Android").trim().slice(0, 80);
  if (!/^[0-9a-f-]{36}$/i.test(campaign) || !/^[0-9a-f-]{36}$/i.test(installation) || !name)
    throw new Error("Configuração do dispositivo inválida");
  const { user } = await master(req, campaign);
  const token = bytes(32);
  const now = new Date().toISOString();
  const { data, error } = await privateDb()
    .from("mobile_gallery_devices")
    .upsert(
      {
        campaign_id: campaign,
        master_user_id: user.id,
        installation_id: installation,
        device_name: name,
        token_hash: hash(token),
        fcm_token: typeof body.fcm_token === "string" ? body.fcm_token : null,
        active: true,
        last_seen_at: now,
        updated_at: now,
      },
      { onConflict: "campaign_id,master_user_id,installation_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error("Não foi possível autorizar o dispositivo");
  return json({ device_id: data.id, device_token: token });
}

async function syncItem(req: Request, body: Record<string, unknown>) {
  const current = await device(req);
  const localId = String(body.local_media_id || "").slice(0, 160);
  const mime = String(body.mime_type || "");
  const thumbnail = String(body.thumbnail || "");
  if (!localId || (!mime.startsWith("image/") && !mime.startsWith("video/")) || thumbnail.length > 180000)
    throw new Error("Mídia inválida");
  const binary = Uint8Array.from(atob(thumbnail), (value) => value.charCodeAt(0));
  if (!binary.length || binary.length > 131072) throw new Error("Miniatura inválida");
  const thumbnailPath = `${current.campaign_id}/${current.id}/${hash(localId)}.webp`;
  const uploaded = await admin().storage.from("master-gallery-thumbnails").upload(thumbnailPath, binary, {
    contentType: "image/webp",
    upsert: true,
    cacheControl: "3600",
  });
  if (uploaded.error) throw new Error("Não foi possível salvar a miniatura");
  const row = {
    device_id: current.id,
    campaign_id: current.campaign_id,
    local_media_id: localId,
    display_name: String(body.display_name || "Mídia").slice(0, 255),
    mime_type: mime.slice(0, 100),
    byte_size: Math.max(0, Number(body.byte_size || 0)),
    modified_at: Math.max(0, Number(body.modified_at || 0)),
    duration_ms: Math.max(0, Number(body.duration_ms || 0)),
    width: Math.max(0, Number(body.width || 0)),
    height: Math.max(0, Number(body.height || 0)),
    thumbnail_path: thumbnailPath,
    available: true,
    indexed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const saved = await privateDb().from("mobile_gallery_items").upsert(row, { onConflict: "device_id,local_media_id" });
  if (saved.error) throw new Error("Não foi possível registrar a miniatura");
  return json({ synced: true });
}

async function pending(req: Request) {
  const current = await device(req);
  const { data: requests, error } = await privateDb()
    .from("mobile_gallery_requests")
    .select("id,item_id")
    .eq("device_id", current.id)
    .in("status", ["requested", "uploading"])
    .order("requested_at")
    .limit(10);
  if (error) throw new Error("Não foi possível consultar a fila");
  const ids = (requests || []).map((entry) => entry.item_id);
  const { data: items } = ids.length
    ? await privateDb().from("mobile_gallery_items").select("id,local_media_id,mime_type,byte_size").in("id", ids)
    : { data: [] };
  const byId = new Map((items || []).map((entry) => [entry.id, entry]));
  return json({
    requests: (requests || []).flatMap((entry) => {
      const item = byId.get(entry.item_id);
      return item ? [{ id: entry.id, ...item }] : [];
    }),
  });
}

async function prepareUpload(req: Request, body: Record<string, unknown>) {
  const current = await device(req);
  const requestId = String(body.request_id || "");
  const { data: request } = await privateDb()
    .from("mobile_gallery_requests")
    .select("id,item_id,campaign_id,status")
    .eq("id", requestId)
    .eq("device_id", current.id)
    .in("status", ["requested", "uploading"])
    .maybeSingle();
  if (!request) throw new Error("Solicitação inválida");
  const { data: item } = await privateDb().from("mobile_gallery_items").select("display_name,mime_type").eq("id", request.item_id).single();
  if (!item) throw new Error("Mídia indisponível");
  const safeName = String(item.display_name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "original";
  const path = `${request.campaign_id}/${current.id}/${request.id}/${safeName}`;
  const signed = await admin().storage.from("master-gallery-originals").createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) throw new Error("Não foi possível preparar o envio");
  await privateDb().from("mobile_gallery_requests").update({
    status: "uploading",
    started_at: request.status === "requested" ? new Date().toISOString() : undefined,
    updated_at: new Date().toISOString(),
  }).eq("id", request.id);
  return json({ signed_url: signed.data.signedUrl, path });
}

async function finishDeviceAction(req: Request, body: Record<string, unknown>, action: string) {
  const current = await device(req);
  const requestId = String(body.request_id || "");
  const { data: request } = await privateDb()
    .from("mobile_gallery_requests")
    .select("id,item_id,status")
    .eq("id", requestId)
    .eq("device_id", current.id)
    .in("status", ["requested", "uploading", "ready"])
    .maybeSingle();
  if (!request) throw new Error("Solicitação inválida");
  if (action === "complete") {
    const path = String(body.path || "");
    if (!path.startsWith(`${current.campaign_id}/${current.id}/${request.id}/`)) throw new Error("Arquivo inválido");
    await privateDb().from("mobile_gallery_requests").update({
      status: "ready",
      original_path: path,
      completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", request.id);
  } else {
    await privateDb().from("mobile_gallery_items").update({ available: false, updated_at: new Date().toISOString() }).eq("id", request.item_id);
    await privateDb().from("mobile_gallery_requests").update({ status: "unavailable", error_message: "Original indisponível no dispositivo", updated_at: new Date().toISOString() }).eq("id", request.id);
  }
  return json({ updated: true });
}

async function sendFcm(fcmToken: string | null, requestId: string) {
  const project = Deno.env.get("FIREBASE_PROJECT_ID");
  const email = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const pem = Deno.env.get("FIREBASE_PRIVATE_KEY")?.replaceAll("\\n", "\n");
  if (!fcmToken || !project || !email || !pem) return false;
  const encode = (value: string | Uint8Array) => {
    const raw = typeof value === "string" ? new TextEncoder().encode(value) : value;
    return btoa(String.fromCharCode(...raw)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  };
  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = encode(JSON.stringify({ iss: email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const keyData = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), (value) => value.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const assertion = `${header}.${claim}.${encode(new Uint8Array(signature))}`;
  const authResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const auth = await authResponse.json();
  if (!authResponse.ok || !auth.access_token) return false;
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token: fcmToken, data: { kind: "gallery_original_requested", request_id: requestId }, android: { priority: "normal", ttl: "86400s" } } }),
  });
  return response.ok;
}

async function masterAction(req: Request, body: Record<string, unknown>) {
  originCheck(req);
  const campaign = String(body.campaign_id || "");
  const context = await master(req, campaign);
  const action = String(body.action || "");
  if (action === "catalog") {
    const now = new Date().toISOString();
    const { data: expired } = await privateDb()
      .from("mobile_gallery_requests")
      .select("id,original_path")
      .eq("campaign_id", campaign)
      .eq("status", "ready")
      .lt("expires_at", now);
    const expiredPaths = (expired || []).flatMap((entry) =>
      entry.original_path ? [entry.original_path] : []
    );
    if (expiredPaths.length)
      await admin().storage.from("master-gallery-originals").remove(expiredPaths);
    if (expired?.length)
      await privateDb()
        .from("mobile_gallery_requests")
        .update({ status: "expired", updated_at: now })
        .in("id", expired.map((entry) => entry.id));
    const { data: devices } = await privateDb().from("mobile_gallery_devices").select("id,device_name,last_seen_at,active").eq("campaign_id", campaign).eq("active", true);
    const { data: items, error } = await privateDb().from("mobile_gallery_items").select("*").eq("campaign_id", campaign).eq("available", true).order("modified_at", { ascending: false }).limit(500);
    if (error) throw new Error("Não foi possível carregar a galeria");
    const paths = (items || []).map((item) => item.thumbnail_path);
    const signed = paths.length ? await admin().storage.from("master-gallery-thumbnails").createSignedUrls(paths, 3600) : { data: [] };
    const urls = new Map((signed.data || []).map((entry) => [entry.path, entry.signedUrl]));
    const { data: requests } = await privateDb().from("mobile_gallery_requests").select("id,item_id,status,requested_at,completed_at,expires_at,error_message").eq("campaign_id", campaign).order("requested_at", { ascending: false });
    return json({ devices: devices || [], items: (items || []).map((item) => ({ ...item, thumbnail_url: urls.get(item.thumbnail_path) })), requests: requests || [] });
  }
  if (action === "request_original") {
    const itemId = String(body.item_id || "");
    const { data: item } = await privateDb().from("mobile_gallery_items").select("id,device_id,available").eq("id", itemId).eq("campaign_id", campaign).maybeSingle();
    if (!item?.available) throw new Error("Original indisponível");
    const { data: current } = await privateDb().from("mobile_gallery_requests").select("id,status").eq("item_id", item.id).in("status", ["requested", "uploading", "ready"]).maybeSingle();
    if (current) return json({ request_id: current.id, status: current.status, existing: true });
    const { data: created, error } = await privateDb().from("mobile_gallery_requests").insert({ campaign_id: campaign, device_id: item.device_id, item_id: item.id, requested_by: context.user.id }).select("id,status").single();
    if (error || !created) throw new Error("Não foi possível solicitar o original");
    const { data: target } = await privateDb().from("mobile_gallery_devices").select("fcm_token").eq("id", item.device_id).single();
    const pushSent = await sendFcm(target?.fcm_token || null, created.id).catch(() => false);
    return json({ request_id: created.id, status: created.status, push_sent: pushSent });
  }
  if (action === "download_original") {
    const requestId = String(body.request_id || "");
    const { data: request } = await privateDb().from("mobile_gallery_requests").select("status,original_path,expires_at").eq("id", requestId).eq("campaign_id", campaign).maybeSingle();
    if (!request || request.status !== "ready" || !request.original_path) throw new Error("Original ainda não está pronto");
    if (!request.expires_at || Date.parse(request.expires_at) <= Date.now()) {
      await admin().storage.from("master-gallery-originals").remove([request.original_path]);
      await privateDb().from("mobile_gallery_requests").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", requestId);
      throw new Error("O download expirou. Solicite novamente");
    }
    const signed = await admin().storage.from("master-gallery-originals").createSignedUrl(request.original_path, 300, { download: true });
    if (signed.error || !signed.data) throw new Error("Não foi possível preparar o download");
    return json({ url: signed.data.signedUrl, expires_in: 300 });
  }
  throw new Error("Ação da galeria inválida");
}

export async function mobileGallery(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "register") return register(req, body);
    if (["catalog", "request_original", "download_original"].includes(action)) return masterAction(req, body);
    if (action === "sync_item") return syncItem(req, body);
    if (action === "pending") return pending(req);
    if (action === "prepare_upload") return prepareUpload(req, body);
    if (action === "complete" || action === "unavailable") return finishDeviceAction(req, body, action);
    if (action === "fcm_token") {
      const current = await device(req);
      await privateDb().from("mobile_gallery_devices").update({ fcm_token: String(body.fcm_token || ""), updated_at: new Date().toISOString() }).eq("id", current.id);
      return json({ updated: true });
    }
    throw new Error("Ação da galeria inválida");
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}
