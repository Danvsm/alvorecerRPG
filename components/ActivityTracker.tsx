"use client";

import { useEffect, useRef } from "react";
import { browserDb } from "@/lib/client";

export default function ActivityTracker({
  campaign,
  userId,
}: {
  campaign: string;
  userId: string;
}) {
  const lastInteraction = useRef(0);
  const started = useRef(false);
  useEffect(() => {
    if (!campaign || !userId) return;
    const key = `alvorecer-activity-${campaign}-${userId}`;
    let sessionId = sessionStorage.getItem(key);
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem(key, sessionId);
    }
    const pingActivity = (active: boolean) => {
      if (active) started.current = true;
      if (!started.current) return;
      void browserDb().rpc("activity_ping", {
        c: campaign,
        session_id: sessionId,
        active,
      });
    };
    const pingPresence = async (online: boolean, announce = false) => {
      try {
        const response = await browserDb().rpc("presence_ping", {
          c: campaign,
          session_id: sessionId,
          online,
        });
        if (!response.error && online && announce) {
          window.dispatchEvent(
            new CustomEvent("alvorecer:presence-updated", {
              detail: { campaign },
            }),
          );
        }
      } catch {
        // A próxima batida restaura a presença após uma falha transitória.
      }
    };
    const interact = () => {
      const now = Date.now();
      if (now - lastInteraction.current < 15000) return;
      lastInteraction.current = now;
      if (document.visibilityState === "visible") pingActivity(true);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") pingActivity(false);
      else {
        interact();
        void pingPresence(true, true);
      }
    };
    const leave = () => void pingPresence(false);
    void pingPresence(true, true);
    for (const event of ["pointerdown", "keydown", "touchstart"] as const)
      window.addEventListener(event, interact, { passive: true });
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", visibility);
    const activityTimer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastInteraction.current < 120000
      )
        pingActivity(true);
      else pingActivity(false);
    }, 45000);
    const presenceTimer = window.setInterval(
      () => void pingPresence(true),
      30000,
    );
    return () => {
      window.clearInterval(activityTimer);
      window.clearInterval(presenceTimer);
      if (started.current) pingActivity(false);
      void pingPresence(false);
      for (const event of ["pointerdown", "keydown", "touchstart"] as const)
        window.removeEventListener(event, interact);
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [campaign, userId]);
  return null;
}
