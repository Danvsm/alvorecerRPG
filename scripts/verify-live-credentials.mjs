import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const setup = JSON.parse(fs.readFileSync(".setup-private.json")),
  file = ".live-test-private.json",
  state = JSON.parse(fs.readFileSync(file));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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
  if (!r.ok) throw Error(data.error || JSON.stringify(data));
  return data;
}
const master = await api("auth", {
  action: "login",
  username: setup.username,
  password: setup.password,
});
const players = await fetch(
  url + "/rest/v1/profiles?username=eq." + state.players[0].username,
  { headers: { apikey: key, Authorization: "Bearer " + master.access_token } },
).then((r) => r.json());
const user = players[0];
const shown = await api(
  "admin",
  { action: "show", campaign: setup.campaign_id, userId: user.id },
  master,
);
assert.equal(shown.password, state.players[0].password);
console.log("PASS mestre recupera credencial protegida");
const password = "Runa" + crypto.randomBytes(8).toString("hex");
await api(
  "admin",
  {
    action: "password",
    campaign: setup.campaign_id,
    userId: user.id,
    password,
  },
  master,
);
state.players[0].password = password;
fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
await api("auth", {
  action: "login",
  username: state.players[0].username,
  password,
});
const shownAfter = await api(
  "admin",
  { action: "show", campaign: setup.campaign_id, userId: user.id },
  master,
);
assert.equal(shownAfter.password, password);
console.log("PASS alteração sincroniza Auth e cofre recuperável");
console.log("LIVE_CREDENTIALS_COMPLETE");
