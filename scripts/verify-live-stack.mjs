import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const setup = JSON.parse(fs.readFileSync(".setup-private.json")),
  state = JSON.parse(fs.readFileSync(".live-test-private.json"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  c = setup.campaign_id;
function ok(r) {
  if (r.error) throw Error(r.error.message);
  return r.data;
}
async function login(u) {
  const r = await fetch(url + "/functions/v1/alvorecer-api/auth", {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      username: u.username,
      password: u.password,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const s = await r.json();
  if (!r.ok) throw Error(s.error);
  const cl = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ok(await cl.auth.setSession(s));
  return cl;
}
const clients = [];
try {
  const master = await login(setup);
  clients.push(master);
  const player = await login(state.players[0]);
  clients.push(player);
  const ch = ok(await player.from("characters").select("id,money").single()),
    suffix = Date.now().toString();
  const cmd = (client, op, d) =>
      client.rpc("game_command", { c, op, d }).then(ok),
    action = (client, op, d) =>
      client.rpc("game_action", { c, op, d }).then(ok);
  const item = (await cmd(master, "item", { name: "Elixir " + suffix })).id;
  await action(master, "item_config", {
    item_id: item,
    kind: "consumable",
    effects: { mana: 5 },
  });
  await cmd(master, "inventory", {
    character_id: ch.id,
    item_id: item,
    quantity: 2,
  });
  const shop = (await action(master, "shop", { name: "Loja " + suffix })).id;
  const product = (
    await action(master, "product", {
      shop_id: shop,
      item_id: item,
      name: "Elixir",
      price: 0,
      stock: 2,
    })
  ).id;
  await action(player, "purchase", {
    character_id: ch.id,
    product_id: product,
    request_id: randomUUID(),
  });
  const rows = ok(
    await player
      .from("character_items")
      .select("quantity")
      .eq("character_id", ch.id)
      .eq("item_id", item),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3);
  console.log("PASS compra acumula quantidade sem duplicar item");
  console.log("LIVE_STACK_COMPLETE");
} finally {
  for (const cl of clients) {
    await cl.removeAllChannels();
    cl.auth.stopAutoRefresh();
  }
}
process.exit(0);
