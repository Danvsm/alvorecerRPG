import fs from "node:fs";
import path from "node:path";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.NEW_MASTER_PASSWORD;
const stateDirectory = process.env.ALVORECER_STATE_DIR || process.cwd();
const statePath = path.join(stateDirectory, ".setup-private.json");

if (!url || !key || !password)
  throw new Error("Defina Supabase e NEW_MASTER_PASSWORD no ambiente");

const setup = JSON.parse(fs.readFileSync(statePath, "utf8"));

async function request(route, body, token) {
  const response = await fetch(`${url}/functions/v1/alvorecer-api/${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Operação não concluída");
  return result;
}

const session = await request("auth", {
  action: "login",
  username: "Pink",
  password: setup.password,
});

await request(
  "admin",
  {
    action: "self_password",
    campaign: setup.campaign_id,
    currentPassword: setup.password,
    password,
  },
  session.access_token,
);

fs.writeFileSync(
  statePath,
  JSON.stringify({ ...setup, username: "Pink", password }),
  { mode: 0o600 },
);

await request("auth", { action: "login", username: "Pink", password });
console.log("PASS conta do Mestre configurada e novo login validado");
