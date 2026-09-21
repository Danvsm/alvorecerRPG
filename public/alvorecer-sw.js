const IMAGE_CACHE_NAME = "alvorecer-images-v2";
const IMAGE_META_CACHE_NAME = "alvorecer-images-meta-v2";
const IMAGE_CACHE_PREFIX = "alvorecer-images-";
const MAX_IMAGES = 300;
const REVALIDATE_AFTER_MS = 60 * 60 * 1000;
const inFlight = new Map();
let debug = new URL(self.location.href).searchParams.get("debug") === "1";

function log(event, url) {
  if (debug) console.info(`[ImageCache] ${event}`, url);
}

function isImageRequest(request) {
  if (
    request.method !== "GET" ||
    request.destination !== "image" ||
    !request.url.startsWith("http")
  )
    return false;
  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  return !path.includes("/chat-media/");
}

function imageCacheKey(request) {
  const url = new URL(request.url);
  const signedStorageImage = url.pathname.includes("/storage/v1/object/sign/");
  if (signedStorageImage && url.searchParams.has("v"))
    url.searchParams.delete("token");
  return url.toString();
}

function metadataKey(key) {
  const url = new URL(
    "/__alvorecer_image_cache_metadata__",
    self.location.origin,
  );
  url.searchParams.set("image", key);
  return url.toString();
}

async function readMetadata(cache, key) {
  const response = await cache.match(metadataKey(key));
  if (!response) return undefined;
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function writeMetadata(cache, key, metadata) {
  await cache.put(
    metadataKey(key),
    new Response(JSON.stringify(metadata), {
      headers: { "Content-Type": "application/json" },
    }),
  );
}

async function deleteCachedImage(imageCache, metadataCache, key) {
  await Promise.all([
    imageCache.delete(key),
    metadataCache.delete(metadataKey(key)),
  ]);
}

async function enforceLimit(imageCache, metadataCache) {
  const keys = await imageCache.keys();
  if (keys.length <= MAX_IMAGES) return;
  const ranked = await Promise.all(
    keys.map(async (request) => ({
      key: request.url,
      accessedAt:
        (await readMetadata(metadataCache, request.url))?.accessedAt || 0,
    })),
  );
  ranked.sort((left, right) => left.accessedAt - right.accessedAt);
  await Promise.all(
    ranked.slice(0, ranked.length - MAX_IMAGES).map(async ({ key }) => {
      await deleteCachedImage(imageCache, metadataCache, key);
      log("EVICTED", key);
    }),
  );
}

function cacheable(response) {
  return response.ok || response.type === "opaque";
}

function networkRequest(request) {
  const url = new URL(request.url);
  if (url.searchParams.has("v") || url.pathname.startsWith("/_next/static/"))
    return request;
  return new Request(request, { cache: "no-cache" });
}

function fetchAndCache(request, key, imageCache, metadataCache) {
  const pending = inFlight.get(key);
  if (pending) return pending.then((response) => response.clone());

  const operation = fetch(networkRequest(request))
    .then(async (response) => {
      if (cacheable(response)) {
        const now = Date.now();
        try {
          await imageCache.put(key, response.clone());
          await writeMetadata(metadataCache, key, {
            accessedAt: now,
            validatedAt: now,
          });
          await enforceLimit(imageCache, metadataCache);
          log("UPDATED", key);
        } catch (error) {
          if (debug) console.warn("[ImageCache] armazenamento falhou", error);
        }
      } else if (response.status === 404 || response.status === 410) {
        await deleteCachedImage(imageCache, metadataCache, key);
        log("EVICTED", key);
      }
      return response;
    })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, operation);
  return operation.then((response) => response.clone());
}

async function imageResponse(request) {
  const [imageCache, metadataCache] = await Promise.all([
    caches.open(IMAGE_CACHE_NAME),
    caches.open(IMAGE_META_CACHE_NAME),
  ]);
  const key = imageCacheKey(request);
  const [cached, metadata] = await Promise.all([
    imageCache.match(key),
    readMetadata(metadataCache, key),
  ]);

  if (cached) {
    log("HIT", key);
    const now = Date.now();
    const touch = writeMetadata(metadataCache, key, {
      accessedAt: now,
      validatedAt: metadata?.validatedAt || 0,
    });
    const versioned = new URL(request.url).searchParams.has("v");
    const stale =
      !versioned &&
      (!metadata || now - (metadata.validatedAt || 0) >= REVALIDATE_AFTER_MS);
    const background = stale
      ? Promise.all([
          touch,
          fetchAndCache(request, key, imageCache, metadataCache).catch(() => {
            // A versão local continua disponível quando a rede falha.
          }),
        ]).then(() => undefined)
      : touch;
    return { response: cached, background };
  }

  log("MISS", key);
  try {
    const response = await fetchAndCache(
      request,
      key,
      imageCache,
      metadataCache,
    );
    return { response, background: Promise.resolve() };
  } catch (error) {
    // Uma requisição simultânea pode ter preenchido o cache antes da falha.
    const fallback = await imageCache.match(key);
    if (fallback) return { response: fallback, background: Promise.resolve() };
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(IMAGE_CACHE_NAME).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(IMAGE_CACHE_PREFIX) &&
                name !== IMAGE_CACHE_NAME &&
                name !== IMAGE_META_CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isImageRequest(event.request)) return;
  const operation = imageResponse(event.request);
  event.respondWith(operation.then(({ response }) => response));
  event.waitUntil(
    operation.then(({ background }) => background).catch(() => undefined),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "IMAGE_CACHE_DEBUG") {
    debug = Boolean(event.data.enabled);
    return;
  }
  if (
    event.data?.type !== "IMAGE_CACHE_INVALIDATE" ||
    typeof event.data.path !== "string"
  )
    return;
  const targetPath = event.data.path;
  event.waitUntil(
    Promise.all([
      caches.open(IMAGE_CACHE_NAME),
      caches.open(IMAGE_META_CACHE_NAME),
    ]).then(async ([imageCache, metadataCache]) => {
      const keys = await imageCache.keys();
      await Promise.all(
        keys
          .filter((request) =>
            decodeURIComponent(new URL(request.url).pathname).includes(
              targetPath,
            ),
          )
          .map(async (request) => {
            await deleteCachedImage(imageCache, metadataCache, request.url);
            log("EVICTED", request.url);
          }),
      );
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Alvorecer",
    body: "Você recebeu uma nova notificação.",
    tag: undefined,
    url: "/",
    kind: "announcement",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const notificationTitle = String(payload.title || "Notificação");
  const highPriorityAlert =
    payload.kind === "message" || payload.kind === "call";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const hasVisibleWindow = windows.some(
        (client) => client.visibilityState === "visible",
      );

      await self.registration.showNotification(notificationTitle, {
        body: payload.body || "Você recebeu uma nova notificação.",
        icon: "/alvorecer-mark.svg",
        tag: payload.tag,
        renotify: highPriorityAlert || Boolean(payload.tag),
        data: { url: payload.url || "/" },
        silent: highPriorityAlert ? false : hasVisibleWindow,
        vibrate: highPriorityAlert
          ? [180, 70, 180, 70, 260]
          : hasVisibleWindow
            ? undefined
            : [80, 50, 80],
        requireInteraction: highPriorityAlert && !hasVisibleWindow,
        lang: "pt-BR",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification && event.notification.data
      ? event.notification.data.url || "/"
      : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            if ("navigate" in client) {
              client.navigate(targetUrl);
            }
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }

        return undefined;
      }),
  );
});
