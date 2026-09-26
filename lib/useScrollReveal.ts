"use client";

import { useEffect, useRef } from "react";

/** Progressive enhancement: markup is always readable before JS and on failure. */
export function useScrollReveal<T extends HTMLElement>() {
  const root = useRef<T>(null);
  useEffect(() => {
    const container = root.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const animations = new Set<Animation>();
    let observer: IntersectionObserver | undefined;
    const stop = () => {
      observer?.disconnect();
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    };
    const start = () => {
      stop();
      if (preference.matches) return;
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const element = entry.target as HTMLElement;
            observer?.unobserve(element);
            if (element.dataset.revealed || !element.animate) return;
            element.dataset.revealed = "true";
            const delay = Math.min(
              240,
              Number(element.dataset.revealDelay) || 0,
            );
            const animation = element.animate(
              [
                { opacity: 0.15, translate: "0 24px" },
                { opacity: 1, translate: "0 0" },
              ],
              {
                duration: 650,
                delay,
                easing: "cubic-bezier(.22,1,.36,1)",
                fill: "backwards",
              },
            );
            animations.add(animation);
            animation.onfinish = () => animations.delete(animation);
          });
        },
        { threshold: 0.12 },
      );
      container
        .querySelectorAll<HTMLElement>("[data-reveal]")
        .forEach((element) => observer?.observe(element));
    };
    start();
    preference.addEventListener("change", start);
    return () => {
      stop();
      preference.removeEventListener("change", start);
    };
  }, []);
  return root;
}
