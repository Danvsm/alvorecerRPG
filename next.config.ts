import type { NextConfig } from "next";

const STATIC_ASSET_CACHE =
  "public, max-age=86400, stale-while-revalidate=604800";

const config: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wsihnbrnqdnmidjvjchn.supabase.co",
        pathname: "/storage/v1/object/sign/community-articles/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/alvorecer-sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'; connect-src 'self' https://wsihnbrnqdnmidjvjchn.supabase.co",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      ...[
        "/combat/:asset*",
        "/community/:asset*",
        "/jokenpo/:asset*",
        "/treasure/:asset*",
        "/audio/:asset*",
      ].map((source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value: STATIC_ASSET_CACHE,
          },
        ],
      })),
      ...["/alvorecer-mark.svg", "/favicon.svg"].map((source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value: STATIC_ASSET_CACHE,
          },
        ],
      })),
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
