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
const testState = JSON.parse(
  fs.readFileSync(path.join(stateDirectory, ".live-test-private.json"), "utf8"),
);

async function api(route, body, session) {
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
  if (!response.ok) throw new Error(result.error || "Operação não concluída");
  return result;
}

async function login(credentials) {
  const session = await api("auth", { action: "login", ...credentials });
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.setSession(session);
  if (result.error) throw result.error;
  return { client, session };
}

function ok(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

const action = async (client, campaign, op, data) =>
  ok(await client.rpc("game_action", { c: campaign, op, d: data }));
const master = await login({ username: "Pink", password: setup.password });
const campaign = setup.campaign_id;

const profiles = ok(await master.client.from("profiles").select("id,username"));
const playerCredentials = await Promise.all(
  testState.players.slice(0, 2).map(async ({ username }) => {
    const profile = profiles.find((entry) => entry.username === username);
    assert.ok(profile, `Conta de teste ${username} indisponível`);
    const recovered = await api(
      "admin",
      { action: "show", campaign, userId: profile.id },
      master.session,
    );
    return { username, password: recovered.password };
  }),
);
fs.writeFileSync(
  path.join(stateDirectory, ".live-test-private.json"),
  JSON.stringify({ ...testState, players: playerCredentials }),
  { mode: 0o600 },
);
const players = await Promise.all(playerCredentials.map(login));

const masterProfile = ok(
  await master.client
    .from("profiles")
    .select("username,display_name")
    .eq("id", (await master.client.auth.getUser()).data.user.id)
    .single(),
);
assert.deepEqual(masterProfile, { username: "pink", display_name: "Pink" });
console.log("PASS Mestre entra como Pink e a interface recebe o nome Pink");

const characters = ok(
  await master.client
    .from("characters")
    .select("id,name,owner_id,avatar_id,dracmas_cents")
    .eq("campaign_id", campaign),
);
const playerUsers = await Promise.all(
  players.map(async ({ client }) => (await client.auth.getUser()).data.user.id),
);
const source = characters.find(
  (character) => character.owner_id === playerUsers[0],
);
const target = characters.find(
  (character) => character.owner_id === playerUsers[1],
);
assert.ok(source && target, "Personagens de teste indisponíveis");

const directory = ok(
  await players[0].client.rpc("transfer_recipients", { c: campaign }),
);
assert.ok(directory.some((entry) => entry.recipient_type === "master"));
assert.ok(
  directory.some(
    (entry) =>
      entry.recipient_type === "player" && entry.character_id === target.id,
  ),
);

await action(master.client, campaign, "adjust_dracmas", {
  target_type: "master",
  delta_cents: 500,
  reason: "Validação automatizada",
  request_id: crypto.randomUUID(),
});
await action(master.client, campaign, "adjust_dracmas", {
  target_type: "character",
  target_character_id: source.id,
  delta_cents: 1234,
  reason: "Validação automatizada",
  request_id: crypto.randomUUID(),
});

let realtimeEvent;
const realtimeReceived = new Promise((resolve) => {
  realtimeEvent = resolve;
});
const channel = master.client
  .channel(`verify-dracmas-${crypto.randomUUID()}`)
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "campaign_events",
      filter: `campaign_id=eq.${campaign}`,
    },
    (payload) => {
      realtimeEvent(payload);
    },
  );
await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Canal não conectou")),
    15_000,
  );
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timeout);
      resolve();
    }
  });
});

const beforeSource = BigInt(source.dracmas_cents);
const beforeTarget = BigInt(target.dracmas_cents);
await action(players[0].client, campaign, "transfer_dracmas", {
  source_character_id: source.id,
  recipient_type: "player",
  recipient_character_id: target.id,
  amount_cents: 1050,
  reason: "Teste entre jogadores",
  request_id: crypto.randomUUID(),
});
await Promise.race([
  realtimeReceived,
  new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("Realtime não recebeu a transferência")),
      45_000,
    ),
  ),
]);
await master.client.removeChannel(channel);

const balances = ok(
  await master.client
    .from("characters")
    .select("id,dracmas_cents")
    .in("id", [source.id, target.id]),
);
assert.equal(
  BigInt(balances.find((entry) => entry.id === source.id).dracmas_cents),
  beforeSource + 1234n - 1050n,
);
assert.equal(
  BigInt(balances.find((entry) => entry.id === target.id).dracmas_cents),
  beforeTarget + 1050n,
);

const stable = balances.find((entry) => entry.id === source.id).dracmas_cents;
await assert.rejects(
  action(players[0].client, campaign, "transfer_dracmas", {
    source_character_id: source.id,
    recipient_type: "master",
    amount_cents: Number(stable) + 1,
    request_id: crypto.randomUUID(),
  }),
);
assert.equal(
  BigInt(
    ok(
      await master.client
        .from("characters")
        .select("dracmas_cents")
        .eq("id", source.id)
        .single(),
    ).dracmas_cents,
  ),
  BigInt(stable),
);

await action(players[0].client, campaign, "transfer_dracmas", {
  source_character_id: source.id,
  recipient_type: "master",
  amount_cents: 50,
  reason: "Teste jogador para Mestre",
  request_id: crypto.randomUUID(),
});
await action(master.client, campaign, "transfer_dracmas", {
  recipient_type: "player",
  recipient_character_id: source.id,
  amount_cents: 100,
  reason: "Teste Mestre para jogador",
  request_id: crypto.randomUUID(),
});
assert.ok(
  (
    await players[0].client
      .from("characters")
      .update({ dracmas_cents: 999999 })
      .eq("id", source.id)
  ).error,
);
console.log(
  "PASS transferências atômicas, confirmação de saldo, RLS e Realtime",
);

const webp = Uint8Array.from(
  Buffer.from(
    "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygA",
    "base64",
  ),
);
const avatarPath = `${campaign}/avatars/validacao-${Date.now()}.webp`;
ok(
  await master.client.storage
    .from("portraits")
    .upload(avatarPath, webp, { contentType: "image/webp" }),
);
await action(master.client, campaign, "avatar", {
  name: "Avatar de Validação",
  storage_path: avatarPath,
});
const avatar = ok(
  await master.client
    .from("campaign_avatars")
    .select("id")
    .eq("storage_path", avatarPath)
    .single(),
);
await action(players[0].client, campaign, "avatar_select", {
  character_id: source.id,
  avatar_id: avatar.id,
});
await assert.rejects(
  action(players[0].client, campaign, "avatar", {
    id: avatar.id,
    active: false,
  }),
);
assert.ok(
  (
    await players[0].client.storage
      .from("portraits")
      .upload(`${campaign}/avatars/negado-${Date.now()}.webp`, webp, {
        contentType: "image/webp",
      })
  ).error,
);
const removablePath = `${campaign}/avatars/exclusao-${Date.now()}.webp`;
ok(
  await master.client.storage
    .from("portraits")
    .upload(removablePath, webp, { contentType: "image/webp" }),
);
await action(master.client, campaign, "avatar", {
  name: "Avatar Temporário",
  storage_path: removablePath,
});
const removable = ok(
  await master.client
    .from("campaign_avatars")
    .select("id")
    .eq("storage_path", removablePath)
    .single(),
);
await action(master.client, campaign, "avatar", {
  id: removable.id,
  active: false,
});
await action(master.client, campaign, "avatar", {
  id: removable.id,
  active: true,
});
await api(
  "admin",
  { action: "delete_avatar", campaign, avatarId: removable.id },
  master.session,
);
assert.equal(
  ok(
    await master.client
      .from("campaign_avatars")
      .select("id")
      .eq("id", removable.id),
  ).length,
  0,
);
console.log(
  "PASS galeria usa Storage, seleção, arquivo, reativação, exclusão e gestão exclusiva do Mestre",
);

const transactions = ok(
  await master.client
    .from("dracma_transactions")
    .select("kind,amount_cents,from_label,to_label,reason")
    .eq("campaign_id", campaign)
    .order("created_at", { ascending: false })
    .limit(8),
);
assert.ok(transactions.some((transaction) => transaction.kind === "transfer"));
assert.ok(
  transactions.some((transaction) => transaction.kind === "admin_adjustment"),
);
console.log(
  "PASS histórico financeiro persistido com remetente, destinatário e motivo",
);
