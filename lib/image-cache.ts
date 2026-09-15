export const IMAGE_CACHE_NAME = "alvorecer-images-v1";
export const IMAGE_CACHE_LIMIT = 300;
export const IMAGE_CACHE_WORKER_PATH = "/image-cache-sw.js";

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

export function registerImageCache() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return Promise.resolve(undefined);
  if (!registrationPromise) {
    const debug = process.env.NODE_ENV === "development" ? "?debug=1" : "";
    registrationPromise = navigator.serviceWorker
      .register(`${IMAGE_CACHE_WORKER_PATH}${debug}`, {
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
