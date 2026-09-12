import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const stateDirectory = process.env.ALVORECER_STATE_DIR || process.cwd();
if (!url || !key) throw new Error("Supabase não configurado");
const setup = JSON.parse(
  fs.readFileSync(path.join(stateDirectory, ".setup-private.json"), "utf8"),
);
const campaign = setup.campaign_id;

async function apiRaw(route, body, session) {
  const response = await fetch(`${url}/functions/v1/alvorecer-api/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const result = await response.json();
  return { response, result };
}

async function api(route, body, session) {
  const { response, result } = await apiRaw(route, body, session);
  if (!response.ok) throw new Error(result.error || "Operação não concluída");
  return result;
}

function ok(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function sessionClient(session) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ok(await client.auth.setSession(session));
  return client;
}

async function login(credentials) {
  const session = await api("auth", { action: "login", ...credentials });
  return { session, client: await sessionClient(session) };
}

const clients = [];
const username = `pdf_${Date.now().toString(36)}`.slice(0, 32);
const password = "teste1234";
const changedPassword = "teste5678";

try {
  const master = await login({ username: "Pink", password: setup.password });
  clients.push(master.client);

  const invitation = await api(
    "admin",
    { action: "invite", campaign, hours: 2 },
    master.session,
  );
  const token = String(invitation.url).split("/").pop();
  const invitedSession = await api("auth", {
    action: "invite",
    token,
    username,
    password,
    fullName: "Jogador de Validação PDF",
    email: `${username}@example.com`,
    birthDate: "2000-01-02",
    characterName: "Sentinela PDF",
    characterClass: "Guardião",
    characterRace: "Humano",
  });
  let player = await sessionClient(invitedSession);
  clients.push(player);

  const profile = ok(
    await player
      .from("profiles")
      .select("id,username,full_name,personal_email,birth_date")
      .single(),
  );
  assert.equal(profile.full_name, "Jogador de Validação PDF");
  assert.equal(profile.personal_email, `${username}@example.com`);
  assert.equal(profile.birth_date, "2000-01-02");
  assert.equal(
    ok(await player.from("profiles").select("id").neq("id", profile.id)).length,
    0,
  );
  const character = ok(
    await player
      .from("characters")
      .select("id,name,level,xp_total,dracmas_cents,avatar_id")
      .single(),
  );
  assert.equal(character.name, "Sentinela PDF");
  console.log("PASS convite completo, dados pessoais privados e ficha inicial");

  const avatar = ok(
    await player
      .from("campaign_avatars")
      .select("id")
      .eq("active", true)
      .limit(1)
      .single(),
  );
  ok(
    await player.rpc("game_action", {
      c: campaign,
      op: "avatar_select",
      d: { character_id: character.id, avatar_id: avatar.id },
    }),
  );
  assert.equal(
    ok(
      await player
        .from("characters")
        .select("avatar_id")
        .eq("id", character.id)
        .single(),
    ).avatar_id,
    avatar.id,
  );
  console.log("PASS jogador escolhe avatar existente da galeria");

  await api(
    "admin",
    {
      action: "self_password",
      campaign,
      currentPassword: password,
      password: changedPassword,
    },
    invitedSession,
  );
  const changedLogin = await login({ username, password: changedPassword });
  clients.push(changedLogin.client);
  player = changedLogin.client;
  console.log("PASS jogador altera a própria senha e entra novamente");

  ok(
    await master.client.rpc("game_action", {
      c: campaign,
      op: "adjust_dracmas",
      d: {
        target_type: "character",
        target_character_id: character.id,
        delta_cents: 2000,
        reason: "Saldo do teste PDF",
        request_id: crypto.randomUUID(),
      },
    }),
  );
  const requested = ok(
    await player.rpc("wallet_action", {
      c: campaign,
      op: "create_charge",
      d: {
        source_character_id: character.id,
        recipient_type: "master",
        amount_cents: 750,
        reason: "Cobrança de validação",
      },
    }),
  );
  const paidByMaster = ok(
    await master.client.rpc("wallet_action", {
      c: campaign,
      op: "pay_charge",
      d: { charge_id: requested.id, request_id: crypto.randomUUID() },
    }),
  );
  assert.equal(Number(paidByMaster.amount_cents), 750);

  const chargedByMaster = ok(
    await master.client.rpc("wallet_action", {
      c: campaign,
      op: "create_charge",
      d: {
        recipient_type: "player",
        recipient_character_id: character.id,
        amount_cents: 325,
        reason: "Cobrança do Mestre",
      },
    }),
  );
  const paidByPlayer = ok(
    await player.rpc("wallet_action", {
      c: campaign,
      op: "pay_charge",
      d: { charge_id: chargedByMaster.id, request_id: crypto.randomUUID() },
    }),
  );
  assert.equal(Number(paidByPlayer.amount_cents), 325);
  assert.ok(
    (
      await player
        .from("characters")
        .update({ dracmas_cents: 999_999 })
        .eq("id", character.id)
    ).error,
  );
  console.log("PASS cobranças nos dois sentidos, pagamentos atômicos e RLS");

  let resolveEvent;
  const event = new Promise((resolve) => (resolveEvent = resolve));
  const channel = player.channel(`verify-pdf-${crypto.randomUUID()}`).on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "campaign_events",
      filter: `campaign_id=eq.${campaign}`,
    },
    resolveEvent,
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Canal não conectou")),
      20_000,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  const realtimeStarted = Date.now();
  ok(
    await master.client.rpc("wallet_action", {
      c: campaign,
      op: "distribute_reward",
      d: {
        character_ids: [character.id],
        mode: "each",
        amount_cents: 101,
        reason: "Recompensa do teste PDF",
        request_id: crypto.randomUUID(),
      },
    }),
  );
  await Promise.race([
    event,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Realtime da carteira não chegou")),
        30_000,
      ),
    ),
  ]);
  await player.removeChannel(channel);
  console.log(`PASS carteira em Realtime (${Date.now() - realtimeStarted}ms)`);

  const activityId = crypto.randomUUID();
  ok(
    await player.rpc("activity_ping", {
      c: campaign,
      session_id: activityId,
      active: true,
    }),
  );
  ok(
    await player.rpc("submit_session_feedback", {
      c: campaign,
      score: 5,
      note: "Validação automatizada",
    }),
  );
  assert.equal(
    ok(
      await master.client
        .from("activity_sessions")
        .select("id")
        .eq("id", activityId),
    ).length,
    1,
  );
  console.log("PASS atividade por interação e feedback pós-sessão");

  await api(
    "admin",
    { action: "disable_player", campaign, userId: profile.id },
    master.session,
  );
  assert.equal(
    (
      await apiRaw("auth", {
        action: "login",
        username,
        password: changedPassword,
      })
    ).response.ok,
    false,
  );
  await api(
    "admin",
    { action: "enable_player", campaign, userId: profile.id },
    master.session,
  );
  const enabled = await login({ username, password: changedPassword });
  clients.push(enabled.client);
  console.log("PASS desativar e reativar acesso do jogador");

  await api(
    "admin",
    {
      action: "delete_player",
      campaign,
      userId: profile.id,
      deleteCharacters: true,
      confirmation: "EXCLUIR",
    },
    master.session,
  );
  assert.equal(
    (
      await apiRaw("auth", {
        action: "login",
        username,
        password: changedPassword,
      })
    ).response.ok,
    false,
  );
  const historic = ok(
    await master.client
      .from("dracma_transactions")
      .select("from_label,to_label,from_username,to_username")
      .or(`from_username.eq.${username},to_username.eq.${username}`),
  );
  assert.ok(historic.length >= 2);
  assert.ok(
    historic.some(
      (transaction) => transaction.from_label || transaction.to_label,
    ),
  );
  console.log("PASS exclusão segura preserva histórico financeiro legível");

  const cleanup = ok(
    await master.client.rpc("cleanup_preview", { c: campaign }),
  );
  assert.ok(Array.isArray(cleanup.invites));
  assert.ok(Array.isArray(cleanup.characters));
  console.log("PASS prévia nominal da limpeza segura");
  console.log("LIVE_PDF_ROUND_COMPLETE");
} finally {
  for (const client of clients) {
    await client.removeAllChannels();
    client.auth.stopAutoRefresh();
  }
}
process.exit(0);
