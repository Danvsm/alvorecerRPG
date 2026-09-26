import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/interesse/contagem/route";

test("public count combines live totals with the ten offline players, without leaking extra fields", async (t) => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  t.after(() => {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  });
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ registeredPlayers: 7, applications: 3, privateNotes: "never expose" }));
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { players: 17, applications: 3, total: 20 });

  mock.mock.mockImplementation(async () => Response.json({ registeredPlayers: 8, applications: 4 }));
  assert.equal((await (await GET()).json()).total, 22);

  mock.mock.mockImplementation(async () => Response.json({ registeredPlayers: -1, applications: 4 }));
  const invalid = await GET();
  assert.equal(invalid.status, 503);
  assert.equal("total" in await invalid.json(), false);

  mock.mock.mockImplementation(async () => new Response("unavailable", { status: 503 }));
  assert.equal((await GET()).status, 503);
});
