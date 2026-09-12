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
  console.log("PASS duas sessões autenticadas");
  const ch = ok(await player.from("characters").select("*").single());
  const suffix = Date.now().toString();
  const advantageResult = ok(
    await master.rpc("game_command", {
      c,
      op: "advantage",
      d: { name: "Vantagem " + suffix, cost: 15 },
    }),
  );
  const advantage = advantageResult.id;
  ok(
    await master.rpc("game_command", {
      c,
      op: "balance",
      d: { character_id: ch.id, key: "xp", delta: 20, reason: "Teste remoto" },
    }),
  );
  const before = ok(
    await player.from("characters").select("xp").eq("id", ch.id).single(),
  ).xp;
  ok(
    await player.rpc("game_command", {
      c,
      op: "buy",
      d: { character_id: ch.id, advantage_id: advantage },
    }),
  );
  assert.equal(
    ok(await player.from("characters").select("xp").eq("id", ch.id).single())
      .xp,
    before - 15,
  );
  assert.ok(
    (
      await player.rpc("game_command", {
        c,
        op: "buy",
        d: { character_id: ch.id, advantage_id: advantage },
      })
    ).error,
  );
  console.log("PASS XP e vantagem sem compra duplicada");
  let resolveEvent, rejectEvent;
  const event = new Promise((resolve, reject) => {
    resolveEvent = resolve;
    rejectEvent = reject;
  });
  const channel = player
    .channel("verify-" + randomUUID())
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "campaign_events",
        filter: "campaign_id=eq." + c,
      },
      resolveEvent,
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Realtime subscribe timeout")),
      20000,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
      if (status === "CHANNEL_ERROR") {
        clearTimeout(timer);
        reject(Error("Realtime channel error"));
      }
    });
  });
  const began = Date.now();
  ok(
    await master.rpc("game_command", {
      c,
      op: "resource",
      d: { character_id: ch.id, key: "life", delta: -1 },
    }),
  );
  await Promise.race([
    event,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Realtime delivery timeout")), 20000),
    ),
  ]);
  assert.equal(
    ok(
      await player
        .from("character_resources")
        .select("current")
        .eq("character_id", ch.id)
        .eq("key", "life")
        .single(),
    ).current,
    ok(
      await master
        .from("character_resources")
        .select("current")
        .eq("character_id", ch.id)
        .eq("key", "life")
        .single(),
    ).current,
  );
  await player.removeChannel(channel);
  console.log(
    "PASS Realtime mestre para jogador em " + (Date.now() - began) + "ms",
  );
  let resolveBack;
  const backEvent = new Promise((resolve) => (resolveBack = resolve));
  const back = master
    .channel("verify-" + randomUUID())
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "campaign_events",
        filter: "campaign_id=eq." + c,
      },
      resolveBack,
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Realtime subscribe timeout")),
      20000,
    );
    back.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      }
      if (status === "CHANNEL_ERROR") {
        clearTimeout(timer);
        reject(Error("Realtime channel error"));
      }
    });
  });
  const beganBack = Date.now();
  ok(
    await player.rpc("game_command", {
      c,
      op: "resource",
      d: { character_id: ch.id, key: "mana", delta: -1 },
    }),
  );
  await Promise.race([
    backEvent,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Realtime delivery timeout")), 20000),
    ),
  ]);
  await master.removeChannel(back);
  console.log(
    "PASS Realtime jogador para mestre em " + (Date.now() - beganBack) + "ms",
  );
  const image = Buffer.from(
      "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
      "base64",
    ),
    media = c + "/" + randomUUID() + ".webp";
  ok(
    await master.storage
      .from("item-media")
      .upload(media, image, { contentType: "image/webp" }),
  );
  assert.ok(
    ok(await player.storage.from("item-media").createSignedUrl(media, 60))
      .signedUrl,
  );
  assert.ok(
    (
      await player.storage
        .from("item-media")
        .upload(c + "/" + randomUUID() + ".webp", image, {
          contentType: "image/webp",
        })
    ).error,
  );
  assert.ok(
    (
      await master.storage
        .from("item-media")
        .upload(c + "/" + randomUUID() + ".png", image, {
          contentType: "image/png",
        })
    ).error,
  );
  assert.ok(
    (
      await master.storage
        .from("item-media")
        .upload(c + "/" + randomUUID() + ".webp", Buffer.alloc(262145), {
          contentType: "image/webp",
        })
    ).error,
  );
  const portrait = ch.id + "/" + randomUUID() + ".webp";
  ok(
    await player.storage
      .from("portraits")
      .upload(portrait, image, { contentType: "image/webp" }),
  );
  ok(await player.storage.from("portraits").remove([portrait]));
  ok(await master.storage.from("item-media").remove([media]));
  console.log("PASS Storage privado, WebP, tamanho e permissões");
  console.log("LIVE_REMAINDER_COMPLETE");
} finally {
  for (const cl of clients) {
    await cl.removeAllChannels();
    cl.auth.stopAutoRefresh();
  }
}
process.exit(0);
