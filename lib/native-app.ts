declare global {
  interface Window {
    AlvorecerNative?: {
      registerMasterDevice(campaignId: string, accessToken: string, deviceName: string): void;
      resumeGalleryQueue(): void;
    };
  }
}

export function registerMasterAndroidDevice(campaignId: string, accessToken: string) {
  if (typeof window === "undefined" || !window.AlvorecerNative) return false;
  window.AlvorecerNative.registerMasterDevice(campaignId, accessToken, "Android do Mestre");
  return true;
}
