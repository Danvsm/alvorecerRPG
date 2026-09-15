"use client";

import { useEffect } from "react";
import { registerImageCache } from "@/lib/image-cache";

export default function ImageCache() {
  useEffect(() => {
    registerImageCache().catch((error) => {
      if (process.env.NODE_ENV === "development")
        console.warn("[ImageCache] Service Worker indisponível", error);
    });
  }, []);

  return null;
}
