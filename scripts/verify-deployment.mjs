import fs from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const origin = "https://alvorecer-rose.vercel.app",
  setup = JSON.parse(fs.readFileSync(".setup-private.json"));
async function post(path, body, token) {
  const r = await fetch(origin + path, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || JSON.stringify(data));
  return data;
}
const page = await fetch(origin + "/?validation=api", {
  signal: AbortSignal.timeout(30000),
});
assert.equal(page.status, 200);
assert.equal(page.headers.get("x-frame-options"), "DENY");
assert.equal(
  (await fetch(origin + "/dev", { signal: AbortSignal.timeout(30000) })).status,
  404,
);
assert.equal(
  (
    await fetch(origin + "/alvorecer-mark.svg", {
      signal: AbortSignal.timeout(30000),
    })
  ).status,
  200,
);
console.log("PASS página pública, cabeçalhos, logo e preview protegido");
const session = await post("/api/auth", {
  action: "login",
  username: setup.username,
  password: setup.password,
});
assert.ok(session.access_token && session.refresh_token);
console.log("PASS login pelo domínio público");
const invite = await post(
  "/api/admin",
  { action: "invite", campaign: setup.campaign_id, hours: 1 },
  session.access_token,
);
assert.ok(invite.url.startsWith(origin + "/convite/"));
const token = invite.url.split("/").pop(),
  hash = createHash("sha256").update(token).digest("hex");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const set = await supabase.auth.setSession(session);
if (set.error) throw set.error;
const row = await supabase
  .from("invites")
  .select("id,cancelled")
  .eq("token_hash", hash)
  .single();
if (row.error) throw row.error;
await post(
  "/api/admin",
  {
    action: "cancel_invite",
    campaign: setup.campaign_id,
    inviteId: row.data.id,
  },
  session.access_token,
);
const cancelled = await supabase
  .from("invites")
  .select("cancelled")
  .eq("id", row.data.id)
  .single();
if (cancelled.error) throw cancelled.error;
assert.equal(cancelled.data.cancelled, true);
console.log("PASS rota administrativa e convite cancelado");
await supabase.auth.signOut();
console.log("DEPLOYMENT_COMPLETE");
