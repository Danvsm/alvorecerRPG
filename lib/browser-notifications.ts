"use client";

import { browserDb } from "@/lib/client";

const VAPID_PUBLIC_KEY =
  "BJBrWPRxiT-G4BR87p377bpqMpPYprbbMKEpCj3_TyOgRZ6rzKgdZZ0qMMv1uBhY97KgSlK_Obn16BGJkLGnGyE";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function ensureAlvorecerNotificationWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
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

export async function ensureAlvorecerPushSubscription(campaign: string) {
  if (
    typeof window === "undefined" ||
    !campaign ||
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    !("serviceWorker" in navigator)
  ) {
    return null;
  }

  const registration = await ensureAlvorecerNotificationWorker();
  if (!registration || !registration.pushManager) return null;

  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const { data } = await browserDb().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Entre novamente para ativar as notificações.");

  const response = await fetch("/api/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "register",
      campaign,
      subscription: subscription.toJSON(),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      payload.error || "Não foi possível registrar este aparelho.",
    );
  }

  return subscription;
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
