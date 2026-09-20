export const IMAGE_CACHE_WORKER_REVISION = "6";
export const IMAGE_CACHE_NAME = "alvorecer-images-v2";
export const IMAGE_CACHE_LIMIT = 300;
export const IMAGE_CACHE_WORKER_PATH = "/alvorecer-sw.js";

let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;

export function versionedImageUrl(
  url: string | null | undefined,
  version: unknown,
) {
  if (!url) return "";
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(url);
  const parsed = new URL(url, "https://alvorecer.invalid");
  parsed.searchParams.set("v", String(version || "1"));
  return absolute
    ? parsed.toString()
    : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function imageCacheWorkerUrl(development = false) {
  const query = new URLSearchParams({ v: IMAGE_CACHE_WORKER_REVISION });
  if (development) query.set("debug", "1");
  return `${IMAGE_CACHE_WORKER_PATH}?${query.toString()}`;
}

export function registerImageCache() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return Promise.resolve(undefined);
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(imageCacheWorkerUrl(process.env.NODE_ENV === "development"), {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => {
        void registration.update();
        return registration;
      });
  }
  return registrationPromise;
}

export async function invalidateCachedImage(path: string) {
  if (
    !path ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  )
    return;
  const registration = await registerImageCache();
  const worker =
    navigator.serviceWorker.controller ||
    registration?.active ||
    registration?.waiting;
  worker?.postMessage({ type: "IMAGE_CACHE_INVALIDATE", path });
}
