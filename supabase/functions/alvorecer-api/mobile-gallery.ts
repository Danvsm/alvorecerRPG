import { admin, hash, master, member, originCheck } from "./server.ts";

// The private schema stays unexposed. Only service_role can execute these RPCs.
const galleryRead = (table: "devices" | "items" | "requests") =>
  admin().rpc(`mobile_gallery_read_${table}`).throwOnError();
const galleryWrite = (operation: string, args: Record<string, unknown>) =>
  admin().rpc(`mobile_gallery_${operation}`, args).throwOnError();
const captureRpc = (operation: string, args: Record<string, unknown>) =>
  admin().rpc(`mobile_capture_${operation}`, args).throwOnError();
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
  const { data } = await galleryRead("devices")
    .select("*")
    .eq("token_hash", hash(token))
    .eq("active", true)
    .maybeSingle();
  if (!data) throw new Error("Dispositivo não autorizado");
  await galleryWrite("update_device", { p_id: data.id, p_patch: { last_seen_at: new Date().toISOString() } });
  return data;
}

async function register(req: Request, body: Record<string, unknown>) {
  originCheck(req);
  const campaign = String(body.campaign_id || "");
  const installation = String(body.installation_id || "");
  const name = String(body.device_name || "Android").trim().slice(0, 80);
  if (!/^[0-9a-f-]{36}$/i.test(campaign) || !/^[0-9a-f-]{36}$/i.test(installation) || !name)
    throw new Error("Configuração do dispositivo inválida");
  const { user } = await member(req, campaign);
  const token = bytes(32);
  const now = new Date().toISOString();
  const { data, error } = await galleryWrite("save_device", { p_row: {
        campaign_id: campaign,
        master_user_id: user.id,
        installation_id: installation,
        device_name: name,
        token_hash: hash(token),
        fcm_token: typeof body.fcm_token === "string" ? body.fcm_token : null,
        active: true,
        last_seen_at: now,
        updated_at: now,
      } })
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
  const saved = await galleryWrite("save_item", { p_row: row });
  if (saved.error) throw new Error("Não foi possível registrar a miniatura");

  // Reinstalling a debug APK can create a new logical installation ID.
  // Reconcile only when a strong MediaStore overlap proves it is the same phone.
  await galleryWrite("reconcile_device", { p_device_id: current.id });
  return json({ synced: true });
}

async function pending(req: Request) {
  const current = await device(req);
  const { data: requests, error } = await galleryRead("requests")
    // PostgREST can only order RPC rows by columns kept in its source CTE.
    // Keep requested_at in the projection even though the Android payload
    // does not need to expose it.
    .select("id,item_id,requested_at")
    .eq("device_id", current.id)
    .in("status", ["requested", "uploading"])
    .order("requested_at")
    .limit(10);
  if (error) throw new Error("Não foi possível consultar a fila");
  const requestIds = (requests || []).map((entry) => entry.id);
  if (requestIds.length)
    await galleryWrite("mark_polled", { p_ids: requestIds });
  const ids = (requests || []).map((entry) => entry.item_id);
  const { data: items } = ids.length
    ? await galleryRead("items").select("id,local_media_id,mime_type,byte_size").in("id", ids)
    : { data: [] };
  const byId = new Map((items || []).map((entry) => [entry.id, entry]));
  return json({
    requests: (requests || []).flatMap((entry) => {
      const item = byId.get(entry.item_id);
      return item ? [{ ...item, id: entry.id, item_id: entry.item_id }] : [];
    }),
  });
}

async function notificationPoll(req: Request, body: Record<string, unknown>) {
  const current = await device(req);
  const afterRaw = Number(body.after_id || 0);
  const afterId =
    Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;

  const latestResult = await admin()
    .from("notifications")
    .select("id,kind,title,body,reference_id,created_at")
    .eq("campaign_id", current.campaign_id)
    .eq("user_id", current.master_user_id)
    .is("dismissed_at", null)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestResult.error) {
    throw new Error("Não foi possível consultar as notificações");
  }

  const latestId = Number(latestResult.data?.id || 0);

  if (afterId <= 0) {
    return json({ latest_id: latestId, new_count: 0, notifications: [] });
  }

  const { data: rows, error } = await admin()
    .from("notifications")
    .select("id,kind,title,body,reference_id,created_at")
    .eq("campaign_id", current.campaign_id)
    .eq("user_id", current.master_user_id)
    .is("dismissed_at", null)
    .is("read_at", null)
    .gt("id", afterId)
    .order("id", { ascending: true })
    .limit(100);

  if (error) throw new Error("Não foi possível consultar as notificações");

  const newest = rows?.length ? rows[rows.length - 1] : null;
  return json({
    latest_id: Math.max(latestId, afterId),
    new_count: (rows || []).length,
    latest_kind: newest?.kind || null,
    latest_title: newest?.title || null,
    latest_body: newest?.body || null,
    latest_reference_id: newest?.reference_id || null,
    notifications: rows || [],
  });
}

async function notificationAction(req: Request, body: Record<string, unknown>) {
  const current = await device(req);
  const operation = String(body.operation || "");
  const conversationId = String(body.conversation_id || "");
  const message = String(body.message || "").trim();

  if (!["read", "reply"].includes(operation)) {
    throw new Error("Ação de notificação inválida");
  }
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
    throw new Error("Conversa inválida");
  }
  if (operation === "reply" && (message.length < 1 || message.length > 4000)) {
    throw new Error("Mensagem inválida");
  }

  const db = admin();
  const { data: conversation, error: conversationError } = await db
    .from("direct_conversations")
    .select("id,campaign_id,first_id,second_id")
    .eq("id", conversationId)
    .eq("campaign_id", current.campaign_id)
    .maybeSingle();

  if (conversationError || !conversation) {
    throw new Error("Conversa não encontrada");
  }

  const identityIds = [String(conversation.first_id), String(conversation.second_id)];
  const { data: identities, error: identityError } = await db
    .from("social_identities")
    .select("id,user_id,active,name")
    .in("id", identityIds)
    .eq("campaign_id", current.campaign_id);

  if (identityError) {
    throw new Error("Não foi possível validar a conversa");
  }

  const ownIdentity = (identities || []).find(
    (identity) =>
      identity.active && String(identity.user_id || "") === String(current.master_user_id),
  );
  if (!ownIdentity) {
    throw new Error("Resposta rápida indisponível para esta identidade");
  }

  const peerIdentity = (identities || []).find(
    (identity) => String(identity.id) !== String(ownIdentity.id),
  );

  const readAt = new Date().toISOString();
  const { error: receiptError } = await db
    .from("conversation_reads")
    .upsert(
      {
        conversation_id: conversationId,
        identity_id: ownIdentity.id,
        read_at: readAt,
      },
      { onConflict: "conversation_id,identity_id" },
    );
  if (receiptError) {
    throw new Error("Não foi possível marcar a conversa como lida");
  }

  await db
    .from("notifications")
    .update({ read_at: readAt })
    .eq("campaign_id", current.campaign_id)
    .eq("user_id", current.master_user_id)
    .eq("kind", "message")
    .eq("reference_id", conversationId);

  await db
    .from("notifications")
    .update({ read_at: readAt })
    .eq("campaign_id", current.campaign_id)
    .eq("user_id", current.master_user_id)
    .eq("kind", "message")
    .like("reference_id", `chat:${conversationId}:%`);

  if (operation === "read") {
    return json({ updated: true, read_at: readAt });
  }

  const { data: sent, error: sendError } = await db
    .from("direct_messages")
    .insert({
      conversation_id: conversationId,
      sender_id: ownIdentity.id,
      body: message,
    })
    .select("id")
    .single();

  if (sendError || !sent) {
    throw new Error("Não foi possível responder");
  }

  if (peerIdentity?.user_id && peerIdentity.active) {
    const { data: mute } = await db
      .from("conversation_mutes")
      .select("conversation_id")
      .eq("conversation_id", conversationId)
      .eq("user_id", peerIdentity.user_id)
      .maybeSingle();

    if (!mute) {
      await db.from("notifications").insert({
        campaign_id: current.campaign_id,
        user_id: peerIdentity.user_id,
        kind: "message",
        title: "Nova mensagem",
        body: message,
        reference_id: conversationId,
      });
    }
  }

  await db.rpc("record_event", {
    c: current.campaign_id,
    ch: null,
    action: "social_message",
    detail: { id: sent.id, source: "notification_reply" },
    actor: current.master_user_id,
  });

  return json({ sent: true, id: sent.id });
}

async function prepareUpload(req: Request, body: Record<string, unknown>) {
  const current = await device(req);
  const requestId = String(body.request_id || "");
  const { data: request } = await galleryRead("requests")
    .select("id,item_id,campaign_id,status")
    .eq("id", requestId)
    .eq("device_id", current.id)
    .in("status", ["requested", "uploading"])
    .maybeSingle();
  if (!request) throw new Error("Solicitação inválida");
  const { data: item } = await galleryRead("items").select("display_name,mime_type").eq("id", request.item_id).single();
  if (!item) throw new Error("Mídia indisponível");
  const safeName = String(item.display_name).replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "original";
  const path = `${request.campaign_id}/${current.id}/${request.id}/${safeName}`;
  const signed = await admin().storage.from("master-gallery-originals").createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) throw new Error("Não foi possível preparar o envio");
  await galleryWrite("update_requests", { p_ids: [request.id], p_patch: {
    status: "uploading",
    original_path: path,
    error_message: null,
    started_at: request.status === "requested" ? new Date().toISOString() : undefined,
    updated_at: new Date().toISOString(),
  } });
  return json({ signed_url: signed.data.signedUrl, path });
}

async function finishDeviceAction(req: Request, body: Record<string, unknown>, action: string) {
  const current = await device(req);
  const requestId = String(body.request_id || "");
  const { data: request } = await galleryRead("requests")
    .select("id,item_id,status,original_path")
    .eq("id", requestId)
    .eq("device_id", current.id)
    .maybeSingle();
  if (!request) throw new Error("Solicitação inválida");

  if (action === "complete") {
    const path = String(body.path || "");
    if (!path.startsWith(`${current.campaign_id}/${current.id}/${request.id}/`))
      throw new Error("Arquivo inválido");

    if (request.status === "cancelled") {
      await admin().storage.from("master-gallery-originals").remove([path]).catch(() => {});
      return json({ updated: false, cancelled: true });
    }
    if (!["requested", "uploading", "ready"].includes(request.status))
      throw new Error("Solicitação não está mais ativa");

    await galleryWrite("update_requests", { p_ids: [request.id], p_patch: {
      status: "ready",
      original_path: path,
      error_message: null,
      completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    } });
    return json({ updated: true });
  }

  if (request.status === "cancelled")
    return json({ updated: false, cancelled: true });
  if (!["requested", "uploading"].includes(request.status))
    throw new Error("Solicitação não está mais ativa");

  if (action === "unavailable") {
    await galleryWrite("update_item", {
      p_id: request.item_id,
      p_patch: { available: false },
    });
    await galleryWrite("update_requests", { p_ids: [request.id], p_patch: {
      status: "unavailable",
      original_path: null,
      error_message: "Original indisponível no dispositivo",
      completed_at: new Date().toISOString(),
      expires_at: null,
      updated_at: new Date().toISOString(),
    } });
    return json({ updated: true });
  }

  const code = String(body.error_code || "processing_failed");
  const messages: Record<string, string> = {
    permission_denied:
      "O Android bloqueou o acesso ao arquivo. Revise a permissão de fotos e vídeos no celular.",
    read_failed:
      "O celular encontrou a foto, mas não conseguiu ler o arquivo original.",
    upload_failed:
      "O celular encontrou a foto, mas o envio do original falhou. Tente novamente.",
    processing_failed:
      "O celular recebeu a solicitação, mas não conseguiu preparar o original.",
  };
  await galleryWrite("update_requests", { p_ids: [request.id], p_patch: {
    status: "failed",
    original_path: null,
    error_message: messages[code] || messages.processing_failed,
    completed_at: new Date().toISOString(),
    expires_at: null,
    updated_at: new Date().toISOString(),
  } });
  return json({ updated: true });
}

async function capturePolicy(req: Request) {
  const current = await device(req);
  const { data, error } = await captureRpc("resolve", {
    p_campaign_id: current.campaign_id,
    p_user_id: current.master_user_id,
  });
  return json({ flag_secure_enabled: error ? true : data !== false });
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

  if (action === "capture_settings") {
    const db = admin();
    const [{ data: policy, error: policyError }, { data: memberships, error: membersError }] =
      await Promise.all([
        captureRpc("read", { p_campaign_id: campaign }),
        db
          .from("campaign_members")
          .select("user_id,role")
          .eq("campaign_id", campaign)
          .eq("access_active", true)
          .is("archived_at", null),
      ]);
    if (policyError || membersError)
      throw new Error("Não foi possível carregar a proteção do aplicativo");

    const userIds = (memberships || []).map((entry) => entry.user_id);
    const { data: profiles, error: profilesError } = userIds.length
      ? await db.from("profiles").select("id,username,display_name").in("id", userIds)
      : { data: [], error: null };
    if (profilesError) throw new Error("Não foi possível carregar as contas");

    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const overrides = (policy?.overrides || {}) as Record<string, boolean>;
    const defaultEnabled = policy?.default_enabled !== false;

    const accounts = (memberships || [])
      .map((membership) => {
        const profile = profileById.get(membership.user_id);
        const override =
          typeof overrides[membership.user_id] === "boolean"
            ? overrides[membership.user_id]
            : null;
        return {
          user_id: membership.user_id,
          role: membership.role,
          username: profile?.username || "conta",
          name: profile?.display_name || profile?.username || "Conta",
          override_enabled: override,
          effective_enabled: override ?? defaultEnabled,
        };
      })
      .sort((left, right) => {
        if (left.role !== right.role) return left.role === "master" ? -1 : 1;
        return left.name.localeCompare(right.name, "pt-BR");
      });

    return json({ default_enabled: defaultEnabled, accounts });
  }

  if (action === "set_capture_default") {
    if (typeof body.enabled !== "boolean") throw new Error("Configuração inválida");
    await captureRpc("set_default", {
      p_campaign_id: campaign,
      p_enabled: body.enabled,
      p_updated_by: context.user.id,
    });
    return json({ updated: true });
  }

  if (action === "set_capture_account" || action === "clear_capture_account") {
    const userId = String(body.user_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Conta inválida");
    const { data: target } = await admin()
      .from("campaign_members")
      .select("user_id")
      .eq("campaign_id", campaign)
      .eq("user_id", userId)
      .eq("access_active", true)
      .is("archived_at", null)
      .maybeSingle();
    if (!target) throw new Error("Conta ativa não encontrada");

    if (action === "clear_capture_account") {
      await captureRpc("clear_account", {
        p_campaign_id: campaign,
        p_user_id: userId,
      });
    } else {
      if (typeof body.enabled !== "boolean") throw new Error("Configuração inválida");
      await captureRpc("set_account", {
        p_campaign_id: campaign,
        p_user_id: userId,
        p_enabled: body.enabled,
        p_updated_by: context.user.id,
      });
    }
    return json({ updated: true });
  }

  if (action === "catalog") {
    const metadataOnly = body.metadata_only === true;
    const now = new Date().toISOString();
    const { data: expired } = await galleryRead("requests")
      .select("id,original_path")
      .eq("campaign_id", campaign)
      .eq("status", "ready")
      .lt("expires_at", now);
    const expiredPaths = (expired || []).flatMap((entry) =>
      entry.original_path ? [entry.original_path] : []
    );
    if (expiredPaths.length) {
      const removed = await admin().storage.from("master-gallery-originals").remove(expiredPaths);
      if (removed.error) throw new Error("Não foi possível limpar os originais expirados");
    }
    if (expired?.length)
      await galleryWrite("update_requests", { p_ids: expired.map((entry) => entry.id), p_patch: { status: "expired" } });

    const { data: devices } = await galleryRead("devices")
      .select("id,device_name,last_seen_at,active,master_user_id")
      .eq("campaign_id", campaign)
      .eq("active", true);
    const accountIds = [...new Set((devices || []).map((entry) => entry.master_user_id))];
    const { data: profiles } = accountIds.length
      ? await admin().from("profiles").select("id,username,display_name").in("id", accountIds)
      : { data: [] };
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
    const activeDeviceIds = (devices || []).map((device) => device.id);

    const countResult = activeDeviceIds.length
      ? await galleryRead("items")
          .select("device_id")
          .eq("campaign_id", campaign)
          .eq("available", true)
          .in("device_id", activeDeviceIds)
      : { data: [], error: null };
    if (countResult.error) throw new Error("Não foi possível contar a galeria");
    const itemCounts = new Map<string, number>();
    (countResult.data || []).forEach((item) => {
      itemCounts.set(item.device_id, (itemCounts.get(item.device_id) || 0) + 1);
    });

    let items: Record<string, any>[] = [];
    if (!metadataOnly && activeDeviceIds.length) {
      const itemResult = await galleryRead("items")
        .select("*")
        .eq("campaign_id", campaign)
        .eq("available", true)
        .in("device_id", activeDeviceIds)
        .order("modified_at", { ascending: false })
        .limit(500);
      if (itemResult.error) throw new Error("Não foi possível carregar a galeria");
      const paths = (itemResult.data || []).map((item) => item.thumbnail_path);
      const signed = paths.length
        ? await admin().storage.from("master-gallery-thumbnails").createSignedUrls(paths, 3600)
        : { data: [] };
      const urls = new Map((signed.data || []).map((entry) => [entry.path, entry.signedUrl]));
      items = (itemResult.data || []).map((item) => ({
        ...item,
        thumbnail_url: urls.get(item.thumbnail_path),
      }));
    }

    const { data: requests } = await galleryRead("requests")
      .select("id,item_id,status,requested_at,started_at,completed_at,expires_at,error_message,device_polled_at,attempt_count")
      .eq("campaign_id", campaign)
      .order("requested_at", { ascending: false });

    return json({
      devices: (devices || []).map((device) => {
        const profile = profileById.get(device.master_user_id);
        return {
          ...device,
          item_count: itemCounts.get(device.id) || 0,
          account_user_id: device.master_user_id,
          account_username: profile?.username || "conta",
          account_name: profile?.display_name || profile?.username || "Conta",
        };
      }),
      items,
      requests: requests || [],
    });
  }

  if (action === "catalog_items") {
    const deviceId = String(body.device_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw new Error("Aparelho inválido");

    const requestedLimit = Number(body.limit || 40);
    const requestedOffset = Number(body.offset || 0);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(40, Math.max(1, Math.floor(requestedLimit)))
      : 40;
    const offset = Number.isFinite(requestedOffset)
      ? Math.max(0, Math.floor(requestedOffset))
      : 0;

    const { data: device } = await galleryRead("devices")
      .select("id")
      .eq("id", deviceId)
      .eq("campaign_id", campaign)
      .eq("active", true)
      .maybeSingle();
    if (!device) throw new Error("Aparelho não encontrado");

    const itemResult = await galleryRead("items")
      .select("*")
      .eq("campaign_id", campaign)
      .eq("device_id", deviceId)
      .eq("available", true)
      .order("modified_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (itemResult.error) throw new Error("Não foi possível carregar a galeria");

    const paths = (itemResult.data || []).map((item) => item.thumbnail_path);
    const signed = paths.length
      ? await admin().storage.from("master-gallery-thumbnails").createSignedUrls(paths, 3600)
      : { data: [] };
    const urls = new Map((signed.data || []).map((entry) => [entry.path, entry.signedUrl]));
    const items = (itemResult.data || []).map((item) => ({
      ...item,
      thumbnail_url: urls.get(item.thumbnail_path),
    }));

    return json({
      items,
      offset,
      next_offset: offset + items.length,
      has_more: items.length === limit,
    });
  }
  if (action === "request_original") {
    const itemId = String(body.item_id || "");
    const { data: item } = await galleryRead("items").select("id,device_id,available").eq("id", itemId).eq("campaign_id", campaign).maybeSingle();
    if (!item?.available) throw new Error("Original indisponível");
    const { data: current } = await galleryRead("requests").select("id,status").eq("item_id", item.id).in("status", ["requested", "uploading", "ready"]).maybeSingle();
    if (current) return json({ request_id: current.id, status: current.status, existing: true });
    const { data: created, error } = await galleryWrite("create_request", { p_row: { campaign_id: campaign, item_id: item.id, requested_by: context.user.id } }).select("id,status").single();
    if (error || !created) throw new Error("Não foi possível solicitar o original");
    const { data: target } = await galleryRead("devices").select("fcm_token").eq("id", item.device_id).single();
    const pushSent = await sendFcm(target?.fcm_token || null, created.id).catch(() => false);
    return json({ request_id: created.id, status: created.status, push_sent: pushSent });
  }
  if (action === "cancel_request") {
    const requestId = String(body.request_id || "");
    const { data: request } = await galleryRead("requests")
      .select("id,status,original_path")
      .eq("id", requestId)
      .eq("campaign_id", campaign)
      .maybeSingle();
    if (!request) throw new Error("Solicitação não encontrada");
    if (!["requested", "uploading"].includes(request.status))
      return json({ cancelled: false, status: request.status });

    if (request.original_path) {
      await admin()
        .storage.from("master-gallery-originals")
        .remove([request.original_path])
        .catch(() => {});
    }
    await galleryWrite("update_requests", { p_ids: [request.id], p_patch: {
      status: "cancelled",
      original_path: null,
      error_message: null,
      completed_at: new Date().toISOString(),
      expires_at: null,
      updated_at: new Date().toISOString(),
    } });
    return json({ cancelled: true, status: "cancelled" });
  }

  if (action === "download_original") {
    const requestId = String(body.request_id || "");
    const { data: request } = await galleryRead("requests").select("status,original_path,expires_at").eq("id", requestId).eq("campaign_id", campaign).maybeSingle();
    if (!request || request.status !== "ready" || !request.original_path) throw new Error("Original ainda não está pronto");
    if (!request.expires_at || Date.parse(request.expires_at) <= Date.now()) {
      await admin().storage.from("master-gallery-originals").remove([request.original_path]);
      await galleryWrite("update_requests", { p_ids: [requestId], p_patch: { status: "expired" } });
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
    if (action === "register") return await register(req, body);
    if (
      [
        "catalog",
        "catalog_items",
        "request_original",
        "download_original",
        "cancel_request",
        "capture_settings",
        "set_capture_default",
        "set_capture_account",
        "clear_capture_account",
      ].includes(action)
    )
      return await masterAction(req, body);
    if (action === "capture_policy") return await capturePolicy(req);
    if (action === "sync_item") return await syncItem(req, body);
    if (action === "pending") return await pending(req);
    if (action === "notification_poll") return await notificationPoll(req, body);
    if (action === "notification_action") return await notificationAction(req, body);
    if (action === "prepare_upload") return await prepareUpload(req, body);
    if (["complete", "unavailable", "fail"].includes(action))
      return await finishDeviceAction(req, body, action);
    if (action === "fcm_token") {
      const current = await device(req);
      await galleryWrite("update_device", { p_id: current.id, p_patch: { fcm_token: String(body.fcm_token || "") } });
      return json({ updated: true });
    }
    throw new Error("Ação da galeria inválida");
  } catch (error) {
    const databaseError = error as { code?: string };
    if (databaseError?.code) {
      // Do not log tokens, SQL details, file names or personal media metadata.
      console.error("mobile_gallery_database_error", { code: databaseError.code });
      return json({ error: "Falha ao acessar a galeria. Tente novamente.", code: "GALLERY_DATABASE_ERROR" }, 503);
    }
    return json({ error: (error as Error).message }, 400);
  }
}
