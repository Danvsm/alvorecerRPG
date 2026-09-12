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
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ok(await client.auth.setSession(s));
  return client;
}
const clients = [];
try {
  const master = await login(setup);
  clients.push(master);
  const player = await login(state.players[0]);
  clients.push(player);
  const other = await login(state.players[1]);
  clients.push(other);
  const ch = ok(await player.from("characters").select("id").single());
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
  console.log("PASS mestre enviou miniatura WebP");
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
  console.log("PASS miniaturas respeitam função, MIME e 256 KiB");
  const portrait = ch.id + "/" + randomUUID() + ".webp";
  assert.ok(
    (
      await player.storage
        .from("portraits")
        .upload(portrait, image, { contentType: "image/webp" })
    ).error,
  );
  assert.ok(
    (
      await other.storage
        .from("portraits")
        .upload(ch.id + "/" + randomUUID() + ".webp", image, {
          contentType: "image/webp",
        })
    ).error,
  );
  const galleryAvatar = ok(
    await player
      .from("campaign_avatars")
      .select("storage_path")
      .eq("active", true)
      .limit(1)
      .single(),
  );
  assert.ok(
    ok(
      await player.storage
        .from("portraits")
        .createSignedUrl(galleryAvatar.storage_path, 60),
    ).signedUrl,
  );
  ok(await master.storage.from("item-media").remove([media]));
  console.log("PASS jogador escolhe a galeria e não envia retrato próprio");
  console.log("LIVE_STORAGE_COMPLETE");
} finally {
  for (const cl of clients) {
    await cl.removeAllChannels();
    cl.auth.stopAutoRefresh();
  }
}
process.exit(0);
