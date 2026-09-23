import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { transform } from "esbuild";
import { createClient } from "@supabase/supabase-js";

const migration = readFileSync("supabase/migrations/20260922223008_mobile_gallery_service_bridge.sql", "utf8");

test("service bridge preserves private data, device isolation and request lifecycle", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema alvorecer_private; create schema storage;
      create table auth.users(id uuid primary key); create table public.campaigns(id uuid primary key);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    await db.exec(readFileSync("supabase/migrations/20260922062735_master_mobile_gallery.sql", "utf8"));
    await db.exec(migration);
    const campaign = crypto.randomUUID(), user = crypto.randomUUID();
    await db.query("insert into auth.users values ($1)", [user]);
    await db.query("insert into campaigns values ($1)", [campaign]);
    const rpc = async (name: string, args: object) => (await db.query<Record<string, any>>(
      `select * from public.${name}($1::jsonb)`, [JSON.stringify(args)])).rows;
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.mobile_gallery_read_items()"), /permission denied/);
      await assert.rejects(rpc("mobile_gallery_save_device", {}), /permission denied/);
      await assert.rejects(db.query("select * from alvorecer_private.mobile_gallery_items"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const devicePayload = { campaign_id: campaign, master_user_id: user, installation_id: crypto.randomUUID(), device_name: "Teste", token_hash: "hash-one" };
    const first = (await rpc("mobile_gallery_save_device", devicePayload))[0];
    const again = (await rpc("mobile_gallery_save_device", { ...devicePayload, token_hash: "hash-rotated" }))[0];
    assert.equal(first.id, again.id);
    const second = (await rpc("mobile_gallery_save_device", { ...devicePayload, installation_id: crypto.randomUUID(), token_hash: "hash-two" }))[0];
    assert.notEqual(first.id, second.id);
    const itemPayload = { device_id: first.id, local_media_id: "image:7", display_name: "test.webp", mime_type: "image/webp", byte_size: 20, modified_at: 1, duration_ms: 0, width: 1, height: 1, thumbnail_path: "test.webp" };
    await rpc("mobile_gallery_save_item", itemPayload);
    await rpc("mobile_gallery_save_item", itemPayload);
    await rpc("mobile_gallery_save_item", { ...itemPayload, device_id: second.id });
    const items = (await db.query<{id:string; device_id:string; campaign_id:string}>("select * from public.mobile_gallery_read_items()" )).rows;
    assert.equal(items.length, 2);
    assert.ok(items.every(item => item.campaign_id === campaign));
    const item = items.find(item => item.device_id === first.id)!;
    const requestPayload = { campaign_id: campaign, item_id: item.id, requested_by: user };
    const request = (await rpc("mobile_gallery_create_request", requestPayload))[0];
    assert.equal(request.id, (await rpc("mobile_gallery_create_request", requestPayload))[0].id);
    assert.notEqual(request.id, item.id);
    for (const status of ["uploading", "ready", "expired"]) {
      await db.query("select public.mobile_gallery_update_requests($1::uuid[], $2::jsonb)", [[request.id], JSON.stringify({ status })]);
      assert.equal((await db.query<{status:string}>("select status from public.mobile_gallery_read_requests() where id=$1", [request.id])).rows[0].status, status);
    }
    assert.notEqual(request.id, (await rpc("mobile_gallery_create_request", requestPayload))[0].id);
    await db.exec("reset role");
    const permissions = (await db.query<{allowed:boolean}>(`select has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or p.prosecdef as allowed from pg_proc p where proname like 'mobile_gallery_%'`)).rows;
    assert.equal(permissions.length, 9);
    assert.ok(permissions.every(row => !row.allowed));
  } finally { await db.close(); }
});

test("pending endpoint uses public RPC and keeps request ID distinct from media ID", async () => {
  const calls: string[] = [];
  const client = createClient("https://gallery.invalid", "service-test-key", {
    global: { fetch: async (input) => {
      const url = new URL(String(input)); calls.push(url.pathname);
      assert.equal(url.searchParams.get("device_id"), url.pathname.endsWith("read_requests") ? "eq.device-one" : null);
      const data = url.pathname.endsWith("read_devices") ? { id: "device-one", campaign_id: "campaign" }
        : url.pathname.endsWith("read_requests") ? [{ id: "request-one", item_id: "media-one" }]
        : url.pathname.endsWith("read_items") ? [{ id: "media-one", local_media_id: "image:7", mime_type: "image/webp", byte_size: 20 }]
        : null;
      return Response.json(data);
    } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const key = "__galleryRegressionDependencies";
  (globalThis as any)[key] = { admin: () => client, hash: (value: string) => value, master: () => { throw new Error("Somente Mestre"); }, member: () => { throw new Error("Sessão necessária"); }, originCheck: () => {} };
  try {
    const source = readFileSync("supabase/functions/alvorecer-api/mobile-gallery.ts", "utf8")
      .replace(/^import .* from "\.\/server.ts";/m, `const { admin, hash, master, member, originCheck } = globalThis.${key};`);
    const { code } = await transform(source, { loader: "ts", format: "esm" });
    const { mobileGallery } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const response = await mobileGallery(new Request("https://gallery.invalid", { method: "POST", headers: { "x-device-token": "device-token" }, body: JSON.stringify({ action: "pending" }) }));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).requests, [{ id: "request-one", item_id: "media-one", local_media_id: "image:7", mime_type: "image/webp", byte_size: 20 }]);
    assert.ok(calls.every(path => path.startsWith("/rest/v1/rpc/mobile_gallery_")));
    const denied = await mobileGallery(new Request("https://gallery.invalid", { method: "POST", body: JSON.stringify({ action: "catalog", campaign_id: "campaign" }) }));
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).error, "Somente Mestre");
  } finally { delete (globalThis as any)[key]; }
});
