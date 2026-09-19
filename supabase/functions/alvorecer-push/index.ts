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
    .select("id,user_id,kind,active")
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
            TTL: 259200,
            urgency: "high",
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

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Método não permitido" }, { status: 405 });
    }

    const db = serviceClient();
    const user = await currentUser(req, db);
    const body = await req.json();
    const action = String(body?.action || "");
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
      action === "chat_message"
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

      const delivery = await pushToUsers(
        db,
        campaign,
        [String(context.recipient.user_id)],
        {
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
