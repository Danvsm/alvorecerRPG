import { test } from "node:test";
import assert from "node:assert/strict";
import { versionedImageUrl } from "../lib/image-cache";
import {
  collectVisualAssets,
  signVisualAssets,
  VISUAL_ASSET_REFRESH_MS,
  VISUAL_ASSET_URL_TTL_SECONDS,
} from "../lib/visual-assets";

test("visual assets include portraits and frame art only", () => {
  assert.deepEqual(
    collectVisualAssets(
      [
        { id: "avatar-a", storage_path: "campaign/avatars/a.webp" },
        { id: "avatar-without-file" },
      ],
      [
        {
          id: "frame-a",
          kind: "frame",
          asset_path: "campaign/frames/a.webp",
        },
        { id: "title-a", kind: "title", asset_path: "ignored.webp" },
      ],
    ),
    [
      {
        id: "avatar-a",
        bucket: "portraits",
        path: "campaign/avatars/a.webp",
        version: "campaign/avatars/a.webp",
      },
      {
        id: "frame-a",
        bucket: "avatar-frames",
        path: "campaign/frames/a.webp",
        version: "campaign/frames/a.webp",
      },
    ],
  );
});

test("visual assets are signed in one batch per private bucket", async () => {
  const calls: Array<{ bucket: string; paths: string[] }> = [];
  const result = await signVisualAssets(
    [
      {
        id: "avatar-a",
        bucket: "portraits",
        path: "avatars/a.webp",
        version: "avatar-v1",
      },
      {
        id: "avatar-b",
        bucket: "portraits",
        path: "avatars/b.webp",
        version: "avatar-v1",
      },
      {
        id: "frame-a",
        bucket: "avatar-frames",
        path: "frames/a.webp",
        version: "frame-v1",
      },
    ],
    async (bucket, paths) => {
      calls.push({ bucket, paths });
      return {
        data: paths.map((path) => ({
          path,
          signedUrl: `https://storage.test/${bucket}/${path}`,
          error: null,
        })),
        error: null,
      };
    },
    (url, asset) => versionedImageUrl(url, asset.version),
  );
  assert.deepEqual(calls, [
    {
      bucket: "portraits",
      paths: ["avatars/a.webp", "avatars/b.webp"],
    },
    { bucket: "avatar-frames", paths: ["frames/a.webp"] },
  ]);
  assert.deepEqual(result, {
    urls: {
      "avatar-a": "https://storage.test/portraits/avatars/a.webp?v=avatar-v1",
      "avatar-b": "https://storage.test/portraits/avatars/b.webp?v=avatar-v1",
      "frame-a": "https://storage.test/avatar-frames/frames/a.webp?v=frame-v1",
    },
    failures: [],
  });
});

test("a failed signed URL is omitted and refresh precedes expiry", async () => {
  const result = await signVisualAssets(
    [
      {
        id: "avatar-a",
        bucket: "portraits",
        path: "avatars/a.webp",
        version: "avatar-v1",
      },
      {
        id: "avatar-b",
        bucket: "portraits",
        path: "avatars/b.webp",
        version: "avatar-v1",
      },
    ],
    async () => ({
      data: [
        {
          path: "avatars/a.webp",
          signedUrl: "https://storage.test/a.webp",
          error: null,
        },
        { path: "avatars/b.webp", signedUrl: null, error: "not found" },
      ],
      error: null,
    }),
  );
  assert.deepEqual(result.urls, {
    "avatar-a": "https://storage.test/a.webp",
  });
  assert.deepEqual(result.failures, ["avatar-b"]);
  assert.ok(
    VISUAL_ASSET_REFRESH_MS < VISUAL_ASSET_URL_TTL_SECONDS * 1000,
    "signed URLs must refresh before they expire",
  );
});
