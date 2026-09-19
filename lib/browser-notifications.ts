export async function ensureAlvorecerNotificationWorker() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(
      "/alvorecer-sw.js",
      { scope: "/" },
    );
    await navigator.serviceWorker.ready;
    return registration;
  } catch (error) {
    console.warn("Não foi possível registrar o serviço de notificações.", error);
    return null;
  }
}

export async function showAlvorecerNotification({
  title,
  body,
  tag,
}: {
  title: string;
  body: string;
  tag?: string;
}) {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return false;
  }

  const registration = await ensureAlvorecerNotificationWorker();

  if (registration) {
    try {
      await registration.showNotification(title, {
        body,
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        tag,
        renotify: Boolean(tag),
        data: { url: "/" },
      });
      return true;
    } catch (error) {
      console.warn("O navegador não conseguiu exibir a notificação.", error);
    }
  }

  try {
    new Notification(title, {
      body,
      icon: "/favicon.ico",
      tag,
    });
    return true;
  } catch {
    return false;
  }
}
