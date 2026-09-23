import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import {
  IMAGE_CACHE_LIMIT,
  IMAGE_CACHE_NAME,
  IMAGE_CACHE_WORKER_REVISION,
  imageCacheWorkerUrl,
  versionedImageUrl,
} from "../lib/image-cache";

type WorkerListener = (event: Record<string, unknown>) => void;
type CachedResponse = Response;

const workerSource = readFileSync("public/alvorecer-sw.js", "utf8");

function createWorkerHarness(
  initialFetch: (request: { url: string }) => Promise<Response>,
) {
  const listeners = new Map<string, WorkerListener>();
  const stores = new Map<string, Map<string, CachedResponse>>();
  let fetcher = initialFetch;
  let now = 1_800_000_000_000;

  const requestKey = (request: string | { url: string }) =>
    typeof request === "string" ? request : request.url;
  const cacheStorage = {
    async open(name: string) {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      return {
        async match(request: string | { url: string }) {
          return store?.get(requestKey(request))?.clone();
        },
        async put(request: string | { url: string }, response: Response) {
          store?.set(requestKey(request), response.clone());
        },
        async delete(request: string | { url: string }) {
          return store?.delete(requestKey(request)) || false;
        },
        async keys() {
          return [...(store?.keys() || [])].map((url) => ({ url }));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const worker = {
    location: {
      href: "https://alvorecer.test/alvorecer-sw.js",
      origin: "https://alvorecer.test",
    },
    clients: { claim: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type: string, listener: WorkerListener) {
      listeners.set(type, listener);
    },
  };

  vm.runInNewContext(workerSource, {
    self: worker,
    caches: cacheStorage,
    fetch: (request: { url: string }) => fetcher(request),
    URL,
    Request,
    Response,
    Map,
    Promise,
    decodeURIComponent,
    console,
    Date: { now: () => now },
  });

  async function dispatchWithLifetime(
    type: string,
    event: Record<string, unknown> = {},
  ) {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({
      ...event,
      waitUntil(promise: Promise<unknown>) {
        waits.push(Promise.resolve(promise));
      },
    });
    await Promise.all(waits);
  }

  async function dispatchFetch(url: string) {
    const waits: Promise<unknown>[] = [];
    let responsePromise: Promise<Response> | undefined;
    const request = new Request(url, { method: "GET" });
    Object.defineProperty(request, "destination", { value: "image" });
    listeners.get("fetch")?.({
      request,
      respondWith(promise: Promise<Response>) {
        responsePromise = Promise.resolve(promise);
      },
      waitUntil(promise: Promise<unknown>) {
        waits.push(Promise.resolve(promise));
      },
    });
    if (!responsePromise) return undefined;
    const response = await responsePromise;
    await Promise.all(waits);
    return response;
  }

  async function dispatchMessage(data: unknown) {
    await dispatchWithLifetime("message", { data });
  }

  return {
    stores,
    dispatchFetch,
    dispatchMessage,
    dispatchWithLifetime,
    setFetcher(next: typeof initialFetch) {
      fetcher = next;
    },
    advance(milliseconds: number) {
      now += milliseconds;
    },
  };
}

function signedImage(path: string, token: string, version: string) {
  return `https://project.supabase.co/storage/v1/object/sign/portraits/${path}?token=${token}&v=${version}`;
}

test("image URLs keep their authorization token and change only with the asset version", () => {
  const original = "https://project.supabase.co/avatar.webp?token=secret";
  const first = versionedImageUrl(original, "2026-09-15T10:00:00Z");
  const same = versionedImageUrl(original, "2026-09-15T10:00:00Z");
  const changed = versionedImageUrl(original, "2026-09-15T10:01:00Z");

  assert.equal(first, same);
  assert.notEqual(first, changed);
  assert.equal(new URL(first).searchParams.get("token"), "secret");
  assert.equal(new URL(first).searchParams.get("v"), "2026-09-15T10:00:00Z");
  assert.equal(
    versionedImageUrl("/combat/header.webp", 2),
    "/combat/header.webp?v=2",
  );
});

test("the worker revision forces browsers to install the immutable-version cache update", () => {
  assert.equal(IMAGE_CACHE_WORKER_REVISION, "9");
  assert.equal(IMAGE_CACHE_NAME, "alvorecer-images-v2");
  assert.equal(imageCacheWorkerUrl(), "/alvorecer-sw.js?v=9");
  assert.equal(imageCacheWorkerUrl(true), "/alvorecer-sw.js?v=9&debug=1");
  assert.match(workerSource, /alvorecer-images-v2/);
  assert.match(workerSource, /alvorecer-images-meta-v2/);
});

test("first load is a MISS and a repeated signed URL is served from the image cache", async () => {
  let requests = 0;
  const harness = createWorkerHarness(async () => {
    requests += 1;
    return new Response("portrait-v1");
  });
  const firstUrl = signedImage("hero.webp", "token-one", "v1");
  const renewedUrl = signedImage("hero.webp", "token-two", "v1");

  assert.equal(
    await (await harness.dispatchFetch(firstUrl))?.text(),
    "portrait-v1",
  );
  assert.equal(
    await (await harness.dispatchFetch(renewedUrl))?.text(),
    "portrait-v1",
  );
  assert.equal(requests, 1);
  assert.equal(harness.stores.get(IMAGE_CACHE_NAME)?.size, 1);
});

test("concurrent components requesting the same version share one download", async () => {
  let requests = 0;
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const harness = createWorkerHarness(async () => {
    requests += 1;
    return pending;
  });

  const first = harness.dispatchFetch(signedImage("party.webp", "one", "v1"));
  const second = harness.dispatchFetch(signedImage("party.webp", "two", "v1"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 1);
  release(new Response("shared"));
  assert.equal(await (await first)?.text(), "shared");
  assert.equal(await (await second)?.text(), "shared");
});

test("a changed version downloads only the new image", async () => {
  let requests = 0;
  const harness = createWorkerHarness(async () => {
    requests += 1;
    return new Response(`version-${requests}`);
  });

  await harness.dispatchFetch(signedImage("changing.webp", "one", "v1"));
  await harness.dispatchFetch(signedImage("changing.webp", "two", "v2"));

  assert.equal(requests, 2);
  assert.equal(harness.stores.get(IMAGE_CACHE_NAME)?.size, 2);
});

test("versioned signed images do not revalidate while their version is unchanged", async () => {
  let requests = 0;
  const harness = createWorkerHarness(async () => {
    requests += 1;
    return new Response("available");
  });
  const firstUrl = signedImage("persistent.webp", "one", "v1");
  const renewedUrl = signedImage("persistent.webp", "two", "v1");

  await harness.dispatchFetch(firstUrl);
  harness.advance(24 * 60 * 60 * 1000);
  assert.equal(
    await (await harness.dispatchFetch(renewedUrl))?.text(),
    "available",
  );
  assert.equal(requests, 1);
});

test("unversioned cached images still revalidate and removed images are evicted", async () => {
  const url = "https://assets.test/offline.webp";
  const harness = createWorkerHarness(async () => new Response("available"));
  await harness.dispatchFetch(url);

  harness.advance(60 * 60 * 1000 + 1);
  harness.setFetcher(async () => {
    throw new Error("offline");
  });
  assert.equal(await (await harness.dispatchFetch(url))?.text(), "available");

  harness.advance(60 * 60 * 1000 + 1);
  harness.setFetcher(async () => new Response("gone", { status: 404 }));
  assert.equal(await (await harness.dispatchFetch(url))?.text(), "available");
  assert.equal(harness.stores.get(IMAGE_CACHE_NAME)?.size, 0);
});

test("temporary chat media is not intercepted or persisted", async () => {
  let requests = 0;
  const harness = createWorkerHarness(async () => {
    requests += 1;
    return new Response("private");
  });

  const result = await harness.dispatchFetch(
    "https://project.supabase.co/storage/v1/object/sign/chat-media/message.webp?token=secret",
  );
  assert.equal(result, undefined);
  assert.equal(requests, 0);
  assert.equal(harness.stores.get(IMAGE_CACHE_NAME), undefined);
});

test("targeted invalidation removes only the changed storage object", async () => {
  const harness = createWorkerHarness(async ({ url }) => new Response(url));
  await harness.dispatchFetch(signedImage("one.webp", "one", "v1"));
  await harness.dispatchFetch(signedImage("two.webp", "two", "v1"));

  await harness.dispatchMessage({
    type: "IMAGE_CACHE_INVALIDATE",
    path: "one.webp",
  });

  const keys = [...(harness.stores.get(IMAGE_CACHE_NAME)?.keys() || [])];
  assert.equal(keys.length, 1);
  assert.match(keys[0], /two\.webp/);
});

test("the worker keeps the 300 most recent images", async () => {
  const harness = createWorkerHarness(async ({ url }) => new Response(url));
  for (let index = 0; index <= IMAGE_CACHE_LIMIT; index += 1) {
    harness.advance(1);
    await harness.dispatchFetch(`https://assets.test/${index}.webp?v=1`);
  }

  const keys = [...(harness.stores.get(IMAGE_CACHE_NAME)?.keys() || [])];
  assert.equal(keys.length, IMAGE_CACHE_LIMIT);
  assert.equal(
    keys.some((key) => key.includes("/0.webp")),
    false,
  );
  assert.equal(
    keys.some((key) => key.includes("/300.webp")),
    true,
  );
});

test("activation removes only older Alvorecer caches", async () => {
  const harness = createWorkerHarness(async () => new Response("unused"));
  harness.stores.set("alvorecer-images-v0", new Map());
  harness.stores.set("alvorecer-images-meta-v0", new Map());
  harness.stores.set("alvorecer-images-v1", new Map());
  harness.stores.set("alvorecer-images-meta-v1", new Map());
  harness.stores.set(IMAGE_CACHE_NAME, new Map());
  harness.stores.set("other-application-cache", new Map());

  await harness.dispatchWithLifetime("activate");

  assert.equal(harness.stores.has("alvorecer-images-v0"), false);
  assert.equal(harness.stores.has("alvorecer-images-meta-v0"), false);
  assert.equal(harness.stores.has("alvorecer-images-v1"), false);
  assert.equal(harness.stores.has("alvorecer-images-meta-v1"), false);
  assert.equal(harness.stores.has(IMAGE_CACHE_NAME), true);
  assert.equal(harness.stores.has("other-application-cache"), true);
});

test("integration keeps logout isolation, HTTP cache headers and development-only logs", () => {
  const game = readFileSync("components/Game.tsx", "utf8");
  const layout = readFileSync("app/layout.tsx", "utf8");
  const media = readFileSync("lib/media.ts", "utf8");
  const profile = readFileSync("components/CommunityProfile.tsx", "utf8");
  const wallpaperManager = readFileSync(
    "components/WallpaperManager.tsx",
    "utf8",
  );
  const config = readFileSync("next.config.ts", "utf8");

  assert.match(game, /setAvatarUrls\(\{\}\)/);
  assert.match(game, /versionedImageUrl/);
  assert.match(game, /controllerchange/);
  assert.doesNotMatch(game, /cacheNonce/);
  assert.match(layout, /<ImageCache \/>/);
  assert.match(media, /cacheControl: "31536000"/);
  assert.match(profile, /versionedImageUrl/);
  assert.match(profile, /wallpaper\.updated_at \|\| wallpaper\.created_at/);
  assert.match(wallpaperManager, /versionedImageUrl/);
  assert.match(workerSource, /!versioned &&/);
  assert.match(config, /source: "\/alvorecer-sw\\.js"/);
  assert.match(config, /no-cache, no-store, must-revalidate/);
  assert.match(config, /\/jokenpo\/:asset\*/);
  assert.match(config, /\/treasure\/:asset\*/);
  assert.match(config, /\/audio\/:asset\*/);
  assert.match(
    config,
    /connect-src 'self' https:\/\/wsihnbrnqdnmidjvjchn\.supabase\.co/,
  );
  assert.match(config, /stale-while-revalidate=604800/);
  assert.match(workerSource, /\[ImageCache\] \$\{event\}/);
  assert.doesNotMatch(workerSource, /localStorage|base64/i);
});
