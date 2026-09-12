import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const setup = JSON.parse(fs.readFileSync(".setup-private.json")),
  state = JSON.parse(fs.readFileSync(".live-test-private.json"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  c = setup.campaign_id;
const clients = [];
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
    signal: AbortSignal.timeout(45000),
  });
  const s = await r.json();
  if (!r.ok) throw Error(s.error);
  const cl = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ok(await cl.auth.setSession(s));
  clients.push(cl);
  return cl;
}
const cmd = (cl, op, d) => cl.rpc("game_command", { c, op, d }).then(ok);
try {
  const master = await login(setup),
    p1 = await login(state.players[0]),
    p2 = await login(state.players[1]);
  const chars = ok(await master.from("characters").select("*")),
    ch = chars.find((x) => x.id === state.character_id),
    other = chars.find((x) => x.id !== ch.id);
  const suffix = Date.now().toString();
  const room = (await cmd(master, "room", { name: "Verificação " + suffix }))
    .id;
  const creature = (
    await cmd(master, "creature", {
      name: "Goblin " + suffix,
      kind: "creature",
      life: 20,
      mana: 8,
      stamina: 10,
    })
  ).id;
  const npc = (
    await cmd(master, "creature", {
      name: "Guia " + suffix,
      kind: "npc",
      life: 30,
    })
  ).id;
  const minion = (
    await cmd(master, "creature", {
      name: "Lacaio " + suffix,
      kind: "minion",
      life: 10,
    })
  ).id;
  for (const character of [ch, other])
    await cmd(master, "participant", {
      room_id: room,
      character_id: character.id,
      side: "ally",
    });
  for (const name of ["Goblin 1", "Goblin 2"])
    await cmd(master, "participant", {
      room_id: room,
      template_id: creature,
      name,
      side: "enemy",
    });
  await cmd(master, "participant", {
    room_id: room,
    template_id: npc,
    side: "neutral",
  });
  await cmd(master, "participant", {
    room_id: room,
    template_id: minion,
    side: "enemy",
  });
  const snap = (cl) => cl.rpc("combat_snapshot", { c }).then(ok);
  const participants = (await snap(master)).filter((x) => x.room_id === room);
  assert.equal(participants.length, 6);
  const enemy = participants.find((x) => x.name === "Goblin 1");
  let hidden = (await snap(p1)).find((x) => x.id === enemy.id);
  assert.equal(hidden.life, null);
  assert.equal(hidden.mana, null);
  assert.equal(hidden.state, "green");
  assert.equal(ok(await p1.from("combat_participants").select("*")).length, 0);
  assert.equal(ok(await p2.from("creature_templates").select("*")).length, 0);
  await cmd(master, "combat_update", { id: enemy.id, key: "life", delta: -12 });
  hidden = (await snap(p1)).find((x) => x.id === enemy.id);
  assert.equal(hidden.life, null);
  assert.equal(hidden.state, "yellow");
  assert.equal(
    (await snap(master)).find(
      (x) => x.name === "Goblin 2" && x.room_id === room,
    ).life,
    20,
  );
  await cmd(master, "combat_update", { id: enemy.id, reveal: true });
  assert.equal((await snap(p1)).find((x) => x.id === enemy.id).life, 8);
  await assert.rejects(
    cmd(p1, "combat_update", { id: enemy.id, key: "life", delta: 20 }),
  );
  console.log(
    "PASS combate: instâncias, NPC, minion, neutro, vida oculta e revelada",
  );
  const advantage = (
    await cmd(master, "advantage", { name: "Vantagem " + suffix, cost: 15 })
  ).id;
  await cmd(master, "balance", {
    character_id: ch.id,
    key: "xp",
    delta: 20,
    reason: "Teste",
  });
  const xp = ok(
    await p1.from("characters").select("xp").eq("id", ch.id).single(),
  ).xp;
  await cmd(p1, "buy", { character_id: ch.id, advantage_id: advantage });
  assert.equal(
    ok(await p1.from("characters").select("xp").eq("id", ch.id).single()).xp,
    xp - 15,
  );
  await assert.rejects(
    cmd(p1, "buy", { character_id: ch.id, advantage_id: advantage }),
  );
  console.log("PASS XP e vantagem sem compra duplicada");
  async function realtime(receiver, writer, label) {
    let resolveEvent;
    const event = new Promise((resolve) => (resolveEvent = resolve));
    const channel = receiver
      .channel("verify-" + randomUUID())
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaign_events",
          filter: "campaign_id=eq." + c,
        },
        () => resolveEvent(),
      );
    let timer;
    await Promise.race([
      new Promise((resolve, reject) =>
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR")
            reject(Error("Realtime channel error"));
        }),
      ),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Realtime subscribe timeout")),
          15000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    const start = Date.now();
    await cmd(writer, "resource", {
      character_id: ch.id,
      key: "life",
      delta: -1,
    });
    await Promise.race([
      event,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Realtime delivery timeout")),
          15000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    const a = ok(await receiver.rpc("combat_snapshot", { c })).find(
      (x) => x.character_id === ch.id && x.room_id === room,
    );
    const b = ok(
      await master
        .from("character_resources")
        .select("current")
        .eq("character_id", ch.id)
        .eq("key", "life")
        .single(),
    );
    assert.equal(a.life, b.current);
    await receiver.removeChannel(channel);
    console.log("PASS Realtime " + label + " " + (Date.now() - start) + "ms");
  }
  await realtime(p1, master, "mestre → jogador");
  await realtime(master, p1, "jogador → mestre");
  await realtime(p2, master, "mestre → segundo jogador");
  const image = Buffer.from(
    "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
    "base64",
  );
  const path = c + "/" + randomUUID() + ".webp";
  ok(
    await master.storage
      .from("item-media")
      .upload(path, image, { contentType: "image/webp" }),
  );
  assert.ok(
    ok(await p1.storage.from("item-media").createSignedUrl(path, 60)).signedUrl,
  );
  assert.ok(
    (
      await p1.storage
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
    await p1.storage
      .from("portraits")
      .upload(portrait, image, { contentType: "image/webp" }),
  );
  assert.ok(
    (
      await p2.storage
        .from("portraits")
        .upload(ch.id + "/" + randomUUID() + ".webp", image, {
          contentType: "image/webp",
        })
    ).error,
  );
  ok(await p1.storage.from("portraits").remove([portrait]));
  ok(await master.storage.from("item-media").remove([path]));
  console.log("PASS Storage: imagem, MIME, tamanho e propriedade");
  await cmd(master, "combat_update", { id: enemy.id, remove: true });
  assert.ok(!(await snap(p1)).some((x) => x.id === enemy.id));
  await cmd(master, "room", { id: room, active: false });
  assert.ok(!(await snap(p2)).some((x) => x.room_id === room));
  console.log("PASS remover participante e encerrar combate");
  console.log("LIVE_COMBAT_COMPLETE");
} finally {
  for (const cl of clients) {
    await cl.removeAllChannels();
    cl.auth.stopAutoRefresh();
  }
}
process.exit(0);
