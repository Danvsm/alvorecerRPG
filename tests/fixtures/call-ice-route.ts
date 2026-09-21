// Run under Node's react-server condition so server-only is enforced normally.
import assert from "node:assert/strict";
import { POST } from "../../app/api/calls/ice/route";

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  delete process.env.TURN_KEY_ID;
  delete process.env.TURN_KEY_API_TOKEN;
  const callId = "11111111-1111-4111-8111-111111111111";
  let allowCall = true;
  let validUser = true;
  let queries = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer user-token");
    if (url.includes("/auth/v1/user")) {
      return validUser
        ? Response.json({ id: "user-1" })
        : Response.json({ message: "invalid token" }, { status: 401 });
    }
    if (url.includes("/rest/v1/direct_calls")) {
      queries++;
      assert.equal(new URL(url).searchParams.get("id"), `eq.${callId}`);
      assert.equal(new URL(url).searchParams.get("status"), "eq.active");
      return Response.json(allowCall ? { id: callId } : null);
    }
    throw new Error("Unexpected external request");
  };
  function request(token = true, body: unknown = { callId }) {
    return new Request("http://localhost/api/calls/ice", {
      method: "POST",
      headers: token ? { Authorization: "Bearer user-token" } : {},
      body: JSON.stringify(body),
    });
  }
  assert.equal((await POST(request(false))).status, 401);
  assert.equal((await POST(request(true, { callId: "invalid" }))).status, 400);
  assert.equal(queries, 0);
  validUser = false;
  assert.equal((await POST(request())).status, 401);
  assert.equal(queries, 0);
  validUser = true;
  allowCall = false;
  assert.equal((await POST(request())).status, 403);
  allowCall = true;
  const allowed = await POST(request());
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get("cache-control")!, /no-store/);
  assert.equal((await allowed.json()).relayAvailable, false);
  // A cached ICE configuration must not bypass revoked access / ended call.
  allowCall = false;
  assert.equal((await POST(request())).status, 403);
  console.log("Call ICE route authorization passed");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
