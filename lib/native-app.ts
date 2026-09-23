declare global {
  interface Window {
    AlvorecerNative?: {
      registerMasterDevice(campaignId: string, accessToken: string, deviceName: string): void;
      resumeGalleryQueue(): void;
      registerGalleryDevice?(campaignId: string, userId: string, accessToken: string, deviceName: string): void;
      isGalleryDeviceRegistered?(campaignId: string, userId: string): boolean;
      setWebSessionUser?(userId: string): void;
      clearWebSession?(): void;
    };
  }
}

export function startAndroidGalleryRegistration(campaignId: string, userId: string, accessToken: string) {
  if (typeof window === "undefined" || !window.AlvorecerNative) return;
  const bridge = window.AlvorecerNative;
  bridge.setWebSessionUser?.(userId);
  let legacyAttempted = false;
  const attempt = () => {
    try {
      if (bridge.registerGalleryDevice && bridge.isGalleryDeviceRegistered) {
        if (!bridge.isGalleryDeviceRegistered(campaignId, userId))
          bridge.registerGalleryDevice(campaignId, userId, accessToken, "Android");
      } else if (!legacyAttempted) {
        // Old APKs cannot acknowledge registration. Retry on resume or token refresh.
        bridge.registerMasterDevice(campaignId, accessToken, "Android");
        legacyAttempted = true;
      }
    } catch {
      // WorkManager and the next foreground attempt recover without interrupting the UI.
    }
  };
  const resume = () => {
    if (document.visibilityState === "hidden") return;
    legacyAttempted = false;
    attempt();
  };
  attempt();
  const timer = window.setInterval(attempt, 60_000);
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}


export function clearAndroidWebSession() {
  if (typeof window === "undefined" || !window.AlvorecerNative) return;
  try {
    window.AlvorecerNative.clearWebSession?.();
  } catch {
    // The Android shell stays protected when the web session is unknown.
  }
}
