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
    const ping = (active: boolean) => {
      if (active) started.current = true;
      if (!started.current) return;
      void browserDb().rpc("activity_ping", {
        c: campaign,
        session_id: sessionId,
        active,
      });
    };
    const interact = () => {
      const now = Date.now();
      if (now - lastInteraction.current < 15000) return;
      lastInteraction.current = now;
      if (document.visibilityState === "visible") ping(true);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") ping(false);
      else interact();
    };
    for (const event of ["pointerdown", "keydown", "touchstart"] as const)
      window.addEventListener(event, interact, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastInteraction.current < 120000
      )
        ping(true);
      else ping(false);
    }, 45000);
    return () => {
      window.clearInterval(timer);
      if (started.current) ping(false);
      for (const event of ["pointerdown", "keydown", "touchstart"] as const)
        window.removeEventListener(event, interact);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [campaign, userId]);
  return null;
}
