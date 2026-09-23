import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY =
  "BJBrWPRxiT-G4BR87p377bpqMpPYprbbMKEpCj3_TyOgRZ6rzKgdZZ0qMMv1uBhY97KgSlK_Obn16BGJkLGnGyE";
const VAPID_SUBJECT = "https://alvorecer-rpg-vsm.vercel.app";
const VALID_KINDS = new Set([
  "announcement",
  "message",
  "event",
  "reward",
  "warning",
  "call",
]);

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Servidor de push não configurado.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type ServiceDb = ReturnType<typeof serviceClient>;

async function currentUser(req: Request, db: ServiceDb) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Entre novamente.");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("Entre novamente.");
  return data.user;
}

async function membership(db: ServiceDb, campaign: string, userId: string) {
  const { data } = await db
    .from("campaign_members")
    .select("role,access_active,archived_at")
    .eq("campaign_id", campaign)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data || !data.access_active || data.archived_at) {
    throw new Error("Acesso à campanha desativado.");
  }
  return data;
}

function cleanText(value: unknown, max: number) {
  return String(value || "").trim().slice(0, max);
}

async function conversationContext(
  db: ServiceDb,
  campaign: string,
  userId: string,
  memberRole: string,
  conversationId: string,
  actorId: string,
) {
  if (!conversationId || !actorId) {
    throw new Error("Conversa inválida.");
  }

  const { data: conversation, error: conversationError } = await db
    .from("direct_conversations")
    .select("id,campaign_id,first_id,second_id")
    .eq("id", conversationId)
    .eq("campaign_id", campaign)
    .maybeSingle();

  if (conversationError || !conversation) {
    throw new Error("Conversa não encontrada.");
  }

  if (
    actorId !== String(conversation.first_id) &&
    actorId !== String(conversation.second_id)
  ) {
    throw new Error("Conversa não autorizada.");
  }

  const { data: actor, error: actorError } = await db
    .from("social_identities")
    .select("id,user_id,kind,active,name")
    .eq("id", actorId)
    .eq("campaign_id", campaign)
    .maybeSingle();

  if (actorError || !actor || !actor.active) {
    throw new Error("Identidade não autorizada.");
  }

  const actorOwnedByUser = String(actor.user_id || "") === userId;
  const masterNpc =
    memberRole === "master" && String(actor.kind || "") === "npc";

  if (!actorOwnedByUser && !masterNpc) {
    throw new Error("Identidade não autorizada.");
  }

  const recipientIdentityId =
    actorId === String(conversation.first_id)
      ? String(conversation.second_id)
      : String(conversation.first_id);

  const { data: recipient, error: recipientError } = await db
    .from("social_identities")
    .select("id,user_id,active")
    .eq("id", recipientIdentityId)
    .eq("campaign_id", campaign)
    .maybeSingle();

  if (recipientError || !recipient || !recipient.active) {
    throw new Error("Destinatário indisponível.");
  }

  return {
    conversation,
    actor,
    recipient,
    recipientIdentityId,
  };
}

async function pushToUsers(
  db: ServiceDb,
  campaign: string,
  userIds: string[],
  payload: {
    title: string;
    body: string;
    tag: string;
    url?: string;
    kind?: string;
  },
) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (!uniqueIds.length) {
    return { pushDelivered: 0, pushFailed: 0, subscribedDevices: 0 };
  }

  const { data: subscriptions, error: subscriptionError } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_secret,failure_count")
    .eq("campaign_id", campaign)
    .in("user_id", uniqueIds);

  if (subscriptionError) {
    throw new Error("Não foi possível consultar os aparelhos registrados.");
  }

  if (!subscriptions?.length) {
    return { pushDelivered: 0, pushFailed: 0, subscribedDevices: 0 };
  }

  const { data: privateKey, error: keyError } = await db.rpc(
    "server_push_vapid_private",
  );

  if (keyError || !privateKey) {
    throw new Error("O servidor de push está sem chave.");
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    String(privateKey),
  );

  let pushDelivered = 0;
  let pushFailed = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: String(subscription.endpoint),
            keys: {
              p256dh: String(subscription.p256dh),
              auth: String(subscription.auth_secret),
            },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.body,
            tag: payload.tag,
            url: payload.url || "/",
            kind: payload.kind || "announcement",
          }),
          {
            TTL:
              payload.kind === "call"
                ? 60
                : payload.kind === "message"
                  ? 86400
                  : 259200,
            urgency:
              payload.kind === "message" || payload.kind === "call"
                ? "high"
                : "normal",
          },
        );

        pushDelivered += 1;
        await db
          .from("push_subscriptions")
          .update({
            last_success_at: new Date().toISOString(),
            failure_count: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscription.id);
      } catch (caught) {
        pushFailed += 1;
        const statusCode = Number(
          (caught as { statusCode?: number })?.statusCode || 0,
        );

        if (statusCode === 404 || statusCode === 410) {
          await db
            .from("push_subscriptions")
            .delete()
            .eq("id", subscription.id);
        } else {
          await db
            .from("push_subscriptions")
            .update({
              failure_count: Number(subscription.failure_count || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscription.id);
        }
      }
    }),
  );

  return {
    pushDelivered,
    pushFailed,
    subscribedDevices: subscriptions.length,
  };
}


let firebaseAccessTokenCache = { token: "", expiresAt: 0 };

function base64Url(value: string | Uint8Array) {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function firebaseAccessToken() {
  const nowMs = Date.now();
  if (
    firebaseAccessTokenCache.token &&
    firebaseAccessTokenCache.expiresAt - nowMs > 60_000
  ) {
    return firebaseAccessTokenCache.token;
  }

  const project = Deno.env.get("FIREBASE_PROJECT_ID");
  const email = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const pem = Deno.env.get("FIREBASE_PRIVATE_KEY")?.replaceAll("\\n", "\n");
  if (!project || !email || !pem) return null;

  const now = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const keyData = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
    (value) => value.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${header}.${claim}`),
  );
  const assertion = `${header}.${claim}.${base64Url(
    new Uint8Array(signature),
  )}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const auth = await response.json();
  if (!response.ok || !auth.access_token) return null;

  firebaseAccessTokenCache = {
    token: String(auth.access_token),
    expiresAt: nowMs + Number(auth.expires_in || 3600) * 1000,
  };
  return firebaseAccessTokenCache.token;
}

type NativeNotification = {
  id: string;
  campaign_id: string;
  user_id: string;
  kind?: string | null;
  reference_id?: string | null;
};

async function nativeNotificationMuted(
  db: ServiceDb,
  notification: NativeNotification,
) {
  if (
    notification.kind !== "message" ||
    !notification.reference_id ||
    !notification.user_id
  ) {
    return false;
  }

  const { data } = await db
    .from("conversation_mutes")
    .select("conversation_id")
    .eq("campaign_id", notification.campaign_id)
    .eq("conversation_id", notification.reference_id)
    .eq("user_id", notification.user_id)
    .maybeSingle();
  return Boolean(data);
}

async function pushNativeNotification(
  db: ServiceDb,
  notification: NativeNotification,
) {
  if (await nativeNotificationMuted(db, notification)) {
    return { delivered: 0, failed: 0, devices: 0, muted: true };
  }

  const { data: devices, error } = await db.rpc(
    "notification_android_devices",
    {
      p_campaign_id: notification.campaign_id,
      p_user_ids: [notification.user_id],
    },
  );
  if (error || !devices?.length) {
    return { delivered: 0, failed: 0, devices: 0, muted: false };
  }

  const project = Deno.env.get("FIREBASE_PROJECT_ID");
  const accessToken = await firebaseAccessToken();
  if (!project || !accessToken) {
    return {
      delivered: 0,
      failed: devices.length,
      devices: devices.length,
      muted: false,
    };
  }

  let delivered = 0;
  let failed = 0;

  await Promise.all(
    devices.map(async (device: Record<string, unknown>) => {
      const fcmToken = String(device.fcm_token || "");
      if (!fcmToken) return;

      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${project}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: fcmToken,
              notification: {
                title: "Alvorecer",
                body: "Você recebeu uma nova notificação.",
              },
              data: {
                kind: "app_notification",
                notification_id: notification.id,
                campaign_id: notification.campaign_id,
              },
              android: {
                priority: "high",
                ttl: "86400s",
                notification: {
                  channel_id: "alvorecer_general",
                  visibility: "PRIVATE",
                  sound: "default",
                },
              },
            },
          }),
        },
      );

      if (response.ok) {
        delivered += 1;
        return;
      }

      failed += 1;
      const detail = await response.text().catch(() => "");
      if (
        response.status === 404 ||
        detail.includes("UNREGISTERED") ||
        detail.includes("registration-token-not-registered")
      ) {
        await db
          .rpc("mobile_gallery_update_device", {
            p_id: device.device_id,
            p_patch: { fcm_token: null },
          })
          .catch(() => {});
      }
    }),
  );

  return {
    delivered,
    failed,
    devices: devices.length,
    muted: false,
  };
}

async function validNotificationHook(req: Request, db: ServiceDb) {
  const token = req.headers.get("x-notification-hook-token") || "";
  if (!token) return false;
  const { data, error } = await db.rpc("verify_notification_push_hook", {
    token,
  });
  return !error && data === true;
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Método não permitido" }, { status: 405 });
    }

    const db = serviceClient();
    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "notifications_created") {
      if (!(await validNotificationHook(req, db))) {
        return Response.json(
          { error: "Hook não autorizado." },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }

      const notifications = Array.isArray(body?.notifications)
        ? body.notifications
            .map((entry: Record<string, unknown>) => ({
              id: cleanText(entry?.id, 80),
              campaign_id: cleanText(entry?.campaign_id, 80),
              user_id: cleanText(entry?.user_id, 80),
              kind: cleanText(entry?.kind, 40) || null,
              reference_id: cleanText(entry?.reference_id, 160) || null,
            }))
            .filter(
              (entry: NativeNotification) =>
                entry.id && entry.campaign_id && entry.user_id,
            )
            .slice(0, 100)
        : [];

      let delivered = 0;
      let failed = 0;
      let devices = 0;
      let muted = 0;

      for (const notification of notifications) {
        const result = await pushNativeNotification(db, notification);
        delivered += result.delivered;
        failed += result.failed;
        devices += result.devices;
        if (result.muted) muted += 1;
      }

      return Response.json(
        {
          ok: true,
          notifications: notifications.length,
          nativeDelivered: delivered,
          nativeFailed: failed,
          nativeDevices: devices,
          muted,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const user = await currentUser(req, db);
    const campaign = String(body?.campaign || "");

    if (!campaign) throw new Error("Campanha inválida.");

    const member = await membership(db, campaign, user.id);

    if (action === "register") {
      const subscription = body?.subscription;
      const endpoint = cleanText(subscription?.endpoint, 4000);
      const p256dh = cleanText(subscription?.keys?.p256dh, 1000);
      const authSecret = cleanText(subscription?.keys?.auth, 1000);

      if (!endpoint.startsWith("https://") || !p256dh || !authSecret) {
        throw new Error("Assinatura de notificação inválida.");
      }

      const { error } = await db.from("push_subscriptions").upsert(
        {
          campaign_id: campaign,
          user_id: user.id,
          endpoint,
          p256dh,
          auth_secret: authSecret,
          user_agent: cleanText(req.headers.get("user-agent"), 500),
          updated_at: new Date().toISOString(),
          failure_count: 0,
        },
        { onConflict: "endpoint" },
      );

      if (error) throw new Error("Não foi possível registrar este aparelho.");

      return Response.json(
        { ok: true, publicKey: VAPID_PUBLIC_KEY },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action === "unregister") {
      const endpoint = cleanText(body?.endpoint, 4000);
      if (!endpoint) throw new Error("Assinatura inválida.");

      await db
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", endpoint)
        .eq("user_id", user.id);

      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action === "chat_state") {
      const { data, error } = await db
        .from("conversation_mutes")
        .select("conversation_id")
        .eq("campaign_id", campaign)
        .eq("user_id", user.id);

      if (error) throw new Error("Não foi possível carregar as preferências.");

      return Response.json(
        {
          ok: true,
          mutedConversationIds: (data || []).map((entry) =>
            String(entry.conversation_id)
          ),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (
      action === "chat_mute" ||
      action === "chat_clear" ||
      action === "chat_report" ||
      action === "chat_message_report" ||
      action === "chat_message_delete" ||
      action === "chat_message" ||
      action === "chat_call"
    ) {
      const conversationId = cleanText(body?.conversationId, 80);
      const actorId = cleanText(body?.actorId, 80);
      const context = await conversationContext(
        db,
        campaign,
        user.id,
        String(member.role || ""),
        conversationId,
        actorId,
      );

      if (action === "chat_mute") {
        const muted = Boolean(body?.muted);

        if (muted) {
          const { error } = await db.from("conversation_mutes").upsert(
            {
              conversation_id: conversationId,
              campaign_id: campaign,
              user_id: user.id,
            },
            { onConflict: "conversation_id,user_id" },
          );
          if (error) throw new Error("Não foi possível silenciar a conversa.");
        } else {
          const { error } = await db
            .from("conversation_mutes")
            .delete()
            .eq("conversation_id", conversationId)
            .eq("user_id", user.id);
          if (error) throw new Error("Não foi possível reativar a conversa.");
        }

        return Response.json(
          { ok: true, muted },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (action === "chat_clear") {
        const clearedAt = new Date().toISOString();

        const { error: clearError } = await db
          .from("direct_messages")
          .update({ cleared_at: clearedAt })
          .eq("conversation_id", conversationId)
          .is("cleared_at", null);

        if (clearError) {
          throw new Error("Não foi possível limpar a conversa.");
        }

        await db
          .from("notifications")
          .delete()
          .eq("kind", "message")
          .eq("reference_id", conversationId);

        await db.rpc("record_event", {
          c: campaign,
          ch: null,
          action: "chat_cleared",
          detail: { conversation_id: conversationId },
          actor: user.id,
        });

        return Response.json(
          { ok: true, clearedAt },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (action === "chat_report") {
        const reason = cleanText(body?.reason, 500);
        if (reason.length < 3) {
          throw new Error("Explique o motivo da denúncia.");
        }

        const { error } = await db.from("conversation_reports").insert({
          campaign_id: campaign,
          conversation_id: conversationId,
          reporter_user_id: user.id,
          reporter_identity_id: actorId,
          reported_identity_id: context.recipientIdentityId,
          reason,
        });

        if (error) throw new Error("Não foi possível enviar a denúncia.");

        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (action === "chat_message_report") {
        const messageId = cleanText(body?.messageId, 80);
        const reason = cleanText(body?.reason, 500);

        if (!messageId) {
          throw new Error("Mensagem inválida.");
        }
        if (reason.length < 3) {
          throw new Error("Explique o motivo da denúncia.");
        }

        const { data: message, error: messageError } = await db
          .from("direct_messages")
          .select("id,conversation_id,sender_id,body,media_id,created_at,deleted_at")
          .eq("id", messageId)
          .eq("conversation_id", conversationId)
          .maybeSingle();

        if (messageError || !message) {
          throw new Error("Mensagem não encontrada.");
        }
        if (String(message.sender_id) === actorId) {
          throw new Error("Você não pode denunciar sua própria mensagem.");
        }

        const { error } = await db.from("conversation_reports").insert({
          campaign_id: campaign,
          conversation_id: conversationId,
          reporter_user_id: user.id,
          reporter_identity_id: actorId,
          reported_identity_id: String(message.sender_id),
          reason,
          report_kind: "message",
          message_id: message.id,
          message_body_snapshot: String(message.body || "").slice(0, 4000),
          message_media_id: message.media_id,
          message_created_at: message.created_at,
        });

        if (error) {
          throw new Error("Não foi possível enviar a denúncia.");
        }

        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (action === "chat_message_delete") {
        const messageId = cleanText(body?.messageId, 80);
        if (!messageId) {
          throw new Error("Mensagem inválida.");
        }

        const { data: message, error: messageError } = await db
          .from("direct_messages")
          .select("id,conversation_id,sender_id,media_id,deleted_at")
          .eq("id", messageId)
          .eq("conversation_id", conversationId)
          .maybeSingle();

        if (messageError || !message) {
          throw new Error("Mensagem não encontrada.");
        }
        if (String(message.sender_id) !== actorId) {
          throw new Error("Você só pode excluir suas próprias mensagens.");
        }

        if (!message.deleted_at) {
          const deletedAt = new Date().toISOString();

          const { error: deleteError } = await db
            .from("direct_messages")
            .update({
              deleted_at: deletedAt,
              deleted_by_identity_id: actorId,
            })
            .eq("id", messageId)
            .eq("sender_id", actorId);

          if (deleteError) {
            throw new Error("Não foi possível excluir a mensagem.");
          }

          if (message.media_id) {
            await db
              .from("chat_media")
              .update({ removed_from_chat_at: deletedAt })
              .eq("id", message.media_id);
          }

          await db.rpc("record_event", {
            c: campaign,
            ch: null,
            action: "chat_message_deleted",
            detail: {
              conversation_id: conversationId,
              message_id: messageId,
            },
            actor: user.id,
          });
        }

        return Response.json(
          { ok: true },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      if (action === "chat_call") {
        const callId = cleanText(body?.callId, 80);
        if (!callId) {
          throw new Error("Chamada inválida.");
        }

        const { data: call, error: callError } = await db
          .from("direct_calls")
          .select("id,conversation_id,caller_id,callee_id,status")
          .eq("id", callId)
          .eq("conversation_id", conversationId)
          .eq("campaign_id", campaign)
          .maybeSingle();

        if (
          callError ||
          !call ||
          String(call.caller_id) !== actorId ||
          String(call.callee_id) !== context.recipientIdentityId ||
          String(call.status) !== "ringing"
        ) {
          throw new Error("Chamada indisponível.");
        }
      }

      if (!context.recipient.user_id) {
        return Response.json(
          {
            ok: true,
            pushDelivered: 0,
            pushFailed: 0,
            subscribedDevices: 0,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const { data: mute } = await db
        .from("conversation_mutes")
        .select("conversation_id")
        .eq("conversation_id", conversationId)
        .eq("user_id", String(context.recipient.user_id))
        .maybeSingle();

      if (mute) {
        return Response.json(
          {
            ok: true,
            muted: true,
            pushDelivered: 0,
            pushFailed: 0,
            subscribedDevices: 0,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const isCall = action === "chat_call";
      const callId = isCall ? cleanText(body?.callId, 80) : "";

      const delivery = await pushToUsers(
        db,
        campaign,
        [String(context.recipient.user_id)],
        isCall
          ? {
              title: `${String(context.actor.name || "Alguém")} está ligando`,
              body: "Toque para abrir a chamada de voz.",
              tag: `alvorecer-call-${callId}`,
              url: "/",
              kind: "call",
            }
          : {
              title: "Olha quem te mandou mensagem 👀",
              body: "Entre no Alvorecer para ver quem foi.",
              tag: `alvorecer-chat-${context.conversation.id}`,
              url: "/",
              kind: "message",
            },
      );

      return Response.json(
        { ok: true, ...delivery },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (action !== "send") {
      throw new Error("Ação de push inválida.");
    }

    if (member.role !== "master") {
      throw new Error("Somente o mestre.");
    }

    const recipientIds = Array.isArray(body?.recipientIds)
      ? [...new Set(body.recipientIds.map(String))].slice(0, 50)
      : [];
    const title = cleanText(body?.title, 100);
    const message = cleanText(body?.body, 500);
    const kind = VALID_KINDS.has(String(body?.kind))
      ? String(body.kind)
      : "announcement";

    if (!recipientIds.length) {
      throw new Error("Selecione pelo menos um jogador.");
    }
    if (!title) {
      throw new Error("Informe o título da notificação.");
    }
    if (!message) {
      throw new Error("Escreva a mensagem da notificação.");
    }

    const { data: players, error: playerError } = await db
      .from("campaign_members")
      .select("user_id")
      .eq("campaign_id", campaign)
      .eq("role", "player")
      .eq("access_active", true)
      .is("archived_at", null)
      .in("user_id", recipientIds);

    if (playerError) {
      throw new Error("Não foi possível validar os jogadores.");
    }
    if (!players?.length) {
      throw new Error("Nenhum jogador válido foi selecionado.");
    }

    const activeIds = players.map((player) => String(player.user_id));
    const rows = activeIds.map((userId) => ({
      campaign_id: campaign,
      user_id: userId,
      kind,
      title,
      body: message,
    }));

    const { data: inserted, error: insertError } = await db
      .from("notifications")
      .insert(rows)
      .select("id,user_id");

    if (insertError) {
      throw new Error("Não foi possível criar as notificações.");
    }

    const delivery = await pushToUsers(db, campaign, activeIds, {
      title,
      body: message,
      tag:
        inserted?.length === 1
          ? `alvorecer-${String(inserted[0].id)}`
          : `alvorecer-${crypto.randomUUID()}`,
      url: "/",
      kind,
    });

    return Response.json(
      {
        sent: activeIds.length,
        ...delivery,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    return Response.json(
      { error: (caught as Error).message || "Falha no servidor." },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
});
