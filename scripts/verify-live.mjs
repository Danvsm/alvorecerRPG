import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const setup = JSON.parse(fs.readFileSync(".setup-private.json"));
const stateFile = ".live-test-private.json";
const state = fs.existsSync(stateFile)
  ? JSON.parse(fs.readFileSync(stateFile))
  : {
      players: [
        {
          username: "teste_sol",
          password: "Goblin" + crypto.randomBytes(6).toString("hex"),
        },
        {
          username: "teste_lua",
          password: "Mago" + crypto.randomBytes(6).toString("hex"),
        },
      ],
    };
fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
async function api(route, d, session) {
  const r = await fetch(url + "/functions/v1/alvorecer-api/" + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(session ? { Authorization: "Bearer " + session.access_token } : {}),
    },
    body: JSON.stringify(d),
    signal: AbortSignal.timeout(45000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || JSON.stringify(data));
  return data;
}
async function login(u) {
  const s = await api("auth", { action: "login", ...u });
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.setSession(s);
  if (error) throw error;
  return { client, session: s };
}
function ok(r) {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
const master = await login(setup);
console.log("PASS login mestre");
const c = setup.campaign_id;
let profiles = ok(await master.client.from("profiles").select("*"));
if (!profiles.some((p) => p.username === state.players[0].username)) {
  await api(
    "admin",
    {
      action: "create",
      campaign: c,
      ...state.players[0],
      character: {
        name: "Kael · Teste",
        class: "Guerreiro",
        race: "Humano",
        life: 60,
        mana: 80,
        stamina: 30,
        xp: 200,
        money: 100,
      },
    },
    master.session,
  );
  console.log("PASS criação de jogador");
}
if (!profiles.some((p) => p.username === state.players[1].username)) {
  const inv = await api(
    "admin",
    { action: "invite", campaign: c, hours: 24 },
    master.session,
  );
  const token = inv.url.split("/").pop();
  await api("auth", { action: "invite", ...state.players[1], token });
  await assert.rejects(
    api("auth", {
      action: "invite",
      username: "teste_reuso",
      password: "goblin123",
      token,
    }),
  );
  console.log("PASS convite de uso único");
}
const first = await login(state.players[0]),
  second = await login(state.players[1]);
console.log("PASS login dois jogadores");
const chars = ok(
  await master.client.from("characters").select("*").eq("campaign_id", c),
);
const allProfiles = ok(await master.client.from("profiles").select("*"));
const playerId = allProfiles.find(
  (p) => p.username === state.players[0].username,
).id;
const ch = chars.find((ch) => ch.owner_id === playerId);
const other = chars.find((ch) => ch.owner_id !== playerId);
state.character_id = ch.id;
fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
assert.equal(ok(await first.client.from("characters").select("*")).length, 1);
assert.equal(
  ok(await first.client.from("characters").select("*").eq("id", other.id))
    .length,
  0,
);
assert.ok((await first.client.from("credential_vault").select("*")).error);
console.log("PASS isolamento RLS e cofre");
const cmd = async (client, op, d) =>
  ok(await client.rpc("game_command", { c, op, d }));
const action = async (client, op, d) =>
  ok(await client.rpc("game_action", { c, op, d }));
const attributes = ok(
  await master.client.from("attributes").select("*").eq("campaign_id", c),
);
const vigor = attributes.find((a) => a.name === "Vigor").id,
  power = attributes.find((a) => a.name === "Poder").id;
await cmd(master.client, "attribute_value", {
  character_id: ch.id,
  attribute_id: vigor,
  value: 12,
});
await cmd(master.client, "attribute_value", {
  character_id: ch.id,
  attribute_id: power,
  value: 8,
});
await action(master.client, "resource_config", {
  character_id: ch.id,
  key: "life",
  inherit_rule: false,
  automatic: true,
  attribute_id: vigor,
  multiplier: 5,
  manual_maximum: 60,
});
const life = async () =>
  ok(
    await first.client
      .from("character_resources")
      .select("*")
      .eq("character_id", ch.id)
      .eq("key", "life")
      .single(),
  );
await cmd(master.client, "resource", {
  character_id: ch.id,
  key: "life",
  delta: -(await life()).current,
});
await cmd(master.client, "resource", {
  character_id: ch.id,
  key: "life",
  delta: 42,
});
assert.equal((await life()).maximum, 60);
await action(master.client, "resource_config", {
  character_id: ch.id,
  key: "life",
  inherit_rule: false,
  automatic: true,
  attribute_id: vigor,
  multiplier: 4,
  manual_maximum: 60,
});
assert.equal((await life()).maximum, 48);
assert.equal((await life()).current, 42);
await cmd(master.client, "attribute_value", {
  character_id: ch.id,
  attribute_id: vigor,
  value: 8,
});
assert.equal((await life()).current, 32);
await cmd(master.client, "attribute_value", {
  character_id: ch.id,
  attribute_id: vigor,
  value: 12,
});
assert.equal((await life()).current, 32);
await action(master.client, "resource_config", {
  character_id: ch.id,
  key: "life",
  inherit_rule: true,
  automatic: false,
  attribute_id: null,
  multiplier: 1,
  manual_maximum: 60,
});
await cmd(master.client, "resource", {
  character_id: ch.id,
  key: "life",
  delta: 10,
});
console.log("PASS atributos, máximos, multiplicador e limite da vida atual");
await assert.rejects(
  cmd(first.client, "resource", {
    character_id: ch.id,
    key: "life",
    delta: 20,
  }),
);
await assert.rejects(
  cmd(first.client, "balance", {
    character_id: ch.id,
    key: "money",
    delta: 500,
  }),
);
await assert.rejects(
  cmd(first.client, "resource", {
    character_id: other.id,
    key: "life",
    delta: -1,
  }),
);
console.log("PASS jogador não cura nem concede dinheiro nem altera terceiro");
await cmd(master.client, "item", {
  name: "Poção · Teste",
  description: "Recupera 20 Vida",
});
const item = ok(
  await master.client
    .from("items")
    .select("*")
    .eq("name", "Poção · Teste")
    .order("id")
    .limit(1)
    .single(),
);
await action(master.client, "item_config", {
  item_id: item.id,
  kind: "consumable",
  effects: { life: 20 },
});
await cmd(master.client, "inventory", {
  character_id: ch.id,
  item_id: item.id,
  quantity: 3,
});
const inv = ok(
  await master.client
    .from("character_items")
    .select("*")
    .eq("character_id", ch.id)
    .eq("item_id", item.id)
    .limit(1)
    .single(),
);
const consumption = {
  character_id: ch.id,
  inventory_id: inv.id,
  request_id: crypto.randomUUID(),
};
await action(first.client, "consume", consumption);
await action(first.client, "consume", consumption);
assert.equal((await life()).current, 60);
assert.equal(
  ok(
    await first.client
      .from("character_items")
      .select("quantity")
      .eq("id", inv.id)
      .single(),
  ).quantity,
  2,
);
console.log("PASS poção, teto de vida e idempotência");
await action(master.client, "shop", { name: "Boticário · Teste" });
const shop = ok(
  await master.client
    .from("shops")
    .select("*")
    .eq("name", "Boticário · Teste")
    .limit(1)
    .single(),
);
await action(master.client, "product", {
  shop_id: shop.id,
  item_id: item.id,
  name: "Poção · Teste",
  price: 10,
  stock: 1,
});
const product = ok(
  await master.client
    .from("shop_products")
    .select("*")
    .eq("shop_id", shop.id)
    .limit(1)
    .single(),
);
const money = ok(
  await first.client
    .from("characters")
    .select("money")
    .eq("id", ch.id)
    .single(),
).money;
const purchase = {
  character_id: ch.id,
  product_id: product.id,
  request_id: crypto.randomUUID(),
};
await action(first.client, "purchase", purchase);
await action(first.client, "purchase", purchase);
assert.equal(
  ok(
    await first.client
      .from("characters")
      .select("money")
      .eq("id", ch.id)
      .single(),
  ).money,
  money - 10,
);
await assert.rejects(
  action(first.client, "purchase", {
    ...purchase,
    request_id: crypto.randomUUID(),
  }),
);
console.log("PASS compra, estoque e débito único");
console.log("LIVE_CORE_COMPLETE");
await Promise.all([
  master.client.auth.signOut(),
  first.client.auth.signOut(),
  second.client.auth.signOut(),
]);
