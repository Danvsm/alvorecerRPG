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


type DeliveryPayload = {
  title: string;
  body: string;
  tag: string;
  url?: string;
  kind?: string;
  notificationId?: string;
  referenceId?: string;
  conversationId?: string;
  senderId?: string;
};

let firebaseTokenCache:
  | { token: string; expiresAt: number }
  | undefined;

async function firebaseAccessToken() {
  if (
    firebaseTokenCache &&
    firebaseTokenCache.expiresAt > Date.now() + 60_000
  ) {
    return firebaseTokenCache.token;
  }

  const project = Deno.env.get("FIREBASE_PROJECT_ID");
  const email = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const pem = Deno.env.get("FIREBASE_PRIVATE_KEY")?.replaceAll("\\n", "\n");
  if (!project || !email || !pem) return null;

  const encode = (value: string | Uint8Array) => {
    const raw =
      typeof value === "string" ? new TextEncoder().encode(value) : value;
    return btoa(String.fromCharCode(...raw))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
  };

  const now = Math.floor(Date.now() / 1000);
  const header = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = encode(
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
  const assertion =
    `${header}.${claim}.${encode(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) return null;

  firebaseTokenCache = {
    token: String(body.access_token),
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600) - 120) * 1000,
  };
  return firebaseTokenCache.token;
}

function notificationRoute(kind: string, referenceId: string) {
  if (referenceId.startsWith("chat:")) {
    const [, conversationId = "", senderId = ""] = referenceId.split(":");
    return {
      url: senderId ? `/?chat=${encodeURIComponent(senderId)}` : "/",
      conversationId,
      senderId,
      nativeKind: "chat_message",
      tag: `alvorecer-chat-${conversationId || referenceId}`,
    };
  }

  if (referenceId.startsWith("group:")) {
    const [, conversationId = "", senderId = ""] = referenceId.split(":");
    return {
      url: "/?group=1",
      conversationId,
      senderId,
      nativeKind: "group_message",
      tag: `alvorecer-group-${conversationId || referenceId}`,
    };
  }

  if (kind === "mention") {
    return {
      url: referenceId
        ? `/?community=1&ref=${encodeURIComponent(referenceId)}`
        : "/?community=1",
      conversationId: "",
      senderId: "",
      nativeKind: "mention",
      tag: `alvorecer-mention-${referenceId || crypto.randomUUID()}`,
    };
  }

  return {
    url: "/?notifications=1",
    conversationId: "",
    senderId: "",
    nativeKind: kind || "announcement",
    tag: `alvorecer-${referenceId || crypto.randomUUID()}`,
  };
}

async function pushNativeToUsers(
  db: ServiceDb,
  campaign: string,
  userIds: string[],
  payload: DeliveryPayload,
) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (!uniqueIds.length) {
    return { nativeDelivered: 0, nativeFailed: 0, nativeDevices: 0 };
  }

  const project = Deno.env.get("FIREBASE_PROJECT_ID");
  const accessToken = await firebaseAccessToken().catch(() => null);
  if (!project || !accessToken) {
    return { nativeDelivered: 0, nativeFailed: 0, nativeDevices: 0 };
  }

  const { data: devices, error } = await db.rpc(
    "notification_android_devices",
    {
      p_campaign_id: campaign,
      p_user_ids: uniqueIds,
    },
  );
  if (error || !devices?.length) {
    return { nativeDelivered: 0, nativeFailed: 0, nativeDevices: 0 };
  }

  let nativeDelivered = 0;
  let nativeFailed = 0;

  await Promise.all(
    devices.map(async (device: { fcm_token?: string }) => {
      const fcmToken = String(device.fcm_token || "");
      if (!fcmToken) return;

      try {
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
                data: {
                  kind: String(payload.kind || "announcement"),
                  title: payload.title,
                  body: payload.body,
                  tag: payload.tag,
                  url: payload.url || "/",
                  notification_id: payload.notificationId || "",
                  reference_id: payload.referenceId || "",
                  conversation_id: payload.conversationId || "",
                  sender_id: payload.senderId || "",
                },
                android: {
                  priority:
                    payload.kind === "chat_message" ||
                    payload.kind === "group_message" ||
                    payload.kind === "call"
                      ? "high"
                      : "normal",
                  ttl:
                    payload.kind === "call"
                      ? "60s"
                      : payload.kind === "chat_message" ||
                          payload.kind === "group_message"
                        ? "86400s"
                        : "259200s",
                },
              },
            }),
          },
        );

        if (response.ok) nativeDelivered += 1;
        else nativeFailed += 1;
      } catch {
        nativeFailed += 1;
      }
    }),
  );

  return {
    nativeDelivered,
    nativeFailed,
    nativeDevices: devices.length,
  };
}

async function pushToUsers(
  db: ServiceDb,
  campaign: string,
  userIds: string[],
  payload: DeliveryPayload,
) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (!uniqueIds.length) {
    return {
      pushDelivered: 0,
      pushFailed: 0,
      subscribedDevices: 0,
      nativeDelivered: 0,
      nativeFailed: 0,
      nativeDevices: 0,
    };
  }

  const { data: subscriptions, error: subscriptionError } = await db
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_secret,failure_count")
    .eq("campaign_id", campaign)
    .in("user_id", uniqueIds);

  if (subscriptionError) {
    throw new Error("Não foi possível consultar os aparelhos registrados.");
  }

  let pushDelivered = 0;
  let pushFailed = 0;

  if (subscriptions?.length) {
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
              notification_id: payload.notificationId || "",
              reference_id: payload.referenceId || "",
              conversation_id: payload.conversationId || "",
              sender_id: payload.senderId || "",
            }),
            {
              TTL:
                payload.kind === "call"
                  ? 60
                  : payload.kind === "chat_message" ||
                      payload.kind === "group_message" ||
                      payload.kind === "message"
                    ? 86400
                    : 259200,
              urgency:
                payload.kind === "chat_message" ||
                payload.kind === "group_message" ||
                payload.kind === "message" ||
                payload.kind === "call"
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
  }

  const native = await pushNativeToUsers(
    db,
    campaign,
    uniqueIds,
    payload,
  );

  return {
    pushDelivered,
    pushFailed,
    subscribedDevices: subscriptions?.length || 0,
    ...native,
  };
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
      const hookToken = req.headers.get("x-notification-hook-token") || "";
      const { data: allowed, error: hookError } = await db.rpc(
        "verify_notification_push_hook",
        { token: hookToken },
      );
      if (hookError || allowed !== true) {
        return Response.json({ error: "Webhook não autorizado" }, { status: 403 });
      }

      const rows = Array.isArray(body?.notifications)
        ? body.notifications.slice(0, 100)
        : [];
      let delivered = 0;
      let failed = 0;
      let nativeDelivered = 0;
      let nativeFailed = 0;

      for (const row of rows) {
        const campaign = cleanText(row?.campaign_id, 80);
        const userId = cleanText(row?.user_id, 80);
        const kind = cleanText(row?.kind, 40) || "announcement";
        const title = cleanText(row?.title, 100) || "Alvorecer";
        const message = cleanText(row?.body, 500) || "Você recebeu uma nova notificação.";
        const referenceId = cleanText(row?.reference_id, 220);
        const notificationId = cleanText(row?.id, 40);
        if (!campaign || !userId) continue;

        const route = notificationRoute(kind, referenceId);
        const result = await pushToUsers(db, campaign, [userId], {
          title,
          body: message,
          tag: route.tag,
          url: route.url,
          kind: route.nativeKind,
          notificationId,
          referenceId,
          conversationId: route.conversationId,
          senderId: route.senderId,
        });

        delivered += result.pushDelivered;
        failed += result.pushFailed;
        nativeDelivered += result.nativeDelivered;
        nativeFailed += result.nativeFailed;
      }

      return Response.json(
        {
          ok: true,
          notifications: rows.length,
          pushDelivered: delivered,
          pushFailed: failed,
          nativeDelivered,
          nativeFailed,
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
          .eq("campaign_id", campaign)
          .eq("user_id", user.id)
          .eq("kind", "message")
          .eq("reference_id", conversationId);

        await db
          .from("notifications")
          .delete()
          .eq("campaign_id", campaign)
          .eq("user_id", user.id)
          .eq("kind", "message")
          .like("reference_id", `chat:${conversationId}:%`);

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
      if (!isCall) {
        return Response.json(
          { ok: true, delivery: "notification_hook" },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const callId = cleanText(body?.callId, 80);
      const delivery = await pushToUsers(
        db,
        campaign,
        [String(context.recipient.user_id)],
        {
          title: `Ligação Arcana de ${String(context.actor.name || "Alguém")}`,
          body: "Chamada de voz recebida",
          tag: `alvorecer-call-${callId}`,
          url: `/?chat=${encodeURIComponent(String(context.actor.id))}`,
          kind: "call",
          referenceId: `chat:${context.conversation.id}:${context.actor.id}`,
          conversationId: String(context.conversation.id),
          senderId: String(context.actor.id),
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

    return Response.json(
      {
        sent: activeIds.length,
        queued: inserted?.length || 0,
        delivery: "notification_hook",
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
