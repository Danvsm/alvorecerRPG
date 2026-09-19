self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Alvorecer",
    body: "Você recebeu uma nova notificação.",
    tag: undefined,
    url: "/",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }

  const rawTitle = String(payload.title || "Notificação");
  const brandedTitle = rawTitle.toLocaleLowerCase().startsWith("alvorecer")
    ? rawTitle
    : `Alvorecer • ${rawTitle}`;

  event.waitUntil(
    self.registration.showNotification(brandedTitle, {
      body: payload.body || "Você recebeu uma nova notificação.",
      icon: "/alvorecer-mark.svg",
      tag: payload.tag,
      renotify: Boolean(payload.tag),
      data: { url: payload.url || "/" },
      vibrate: [180, 90, 180],
      lang: "pt-BR",
    }),
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
