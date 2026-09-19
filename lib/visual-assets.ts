import type { Row } from "./types";

export const VISUAL_ASSET_URL_TTL_SECONDS = 60 * 60;
export const VISUAL_ASSET_REFRESH_MS = 45 * 60 * 1000;
export const VISUAL_ASSET_RETRY_MS = 15 * 1000;

export type VisualAsset = {
  id: string;
  bucket: "portraits" | "avatar-frames";
  path: string;
  version: unknown;
};

type SignedUrlEntry = {
  error: string | null;
  path: string | null;
  signedUrl: string | null;
};

type SignedUrlBatch = {
  data: SignedUrlEntry[] | null;
  error: { message: string } | null;
};

export function collectVisualAssets(
  avatars: Row[],
  cosmetics: Row[],
): VisualAsset[] {
  const portraits = avatars
    .filter((avatar) => avatar.id && avatar.storage_path)
    .map((avatar) => ({
      id: String(avatar.id),
      bucket: "portraits" as const,
      path: String(avatar.storage_path),
      version: avatar.updated_at || avatar.created_at || avatar.storage_path,
    }));
  const cosmeticAssets = cosmetics
    .filter(
      (cosmetic) =>
        cosmetic.id &&
        ["frame", "medal"].includes(String(cosmetic.kind)) &&
        cosmetic.asset_path,
    )
    .map((cosmetic) => ({
      id: String(cosmetic.id),
      bucket: "avatar-frames" as const,
      path: String(cosmetic.asset_path),
      version:
        cosmetic.updated_at || cosmetic.created_at || cosmetic.asset_path,
    }));
  return [...portraits, ...cosmeticAssets];
}

export async function signVisualAssets(
  assets: VisualAsset[],
  sign: (
    bucket: VisualAsset["bucket"],
    paths: string[],
  ) => Promise<SignedUrlBatch>,
  prepareUrl: (url: string, asset: VisualAsset) => string = (url) => url,
) {
  const groups = new Map<VisualAsset["bucket"], VisualAsset[]>();
  for (const asset of assets) {
    const current = groups.get(asset.bucket) || [];
    current.push(asset);
    groups.set(asset.bucket, current);
  }

  const urls: Record<string, string> = {};
  const failures: string[] = [];
  await Promise.all(
    [...groups.entries()].map(async ([bucket, bucketAssets]) => {
      const paths = [...new Set(bucketAssets.map((asset) => asset.path))];
      try {
        const result = await sign(bucket, paths);
        if (result.error || !result.data) {
          failures.push(...bucketAssets.map((asset) => asset.id));
          return;
        }
        const signedByPath = new Map(
          result.data
            .filter(
              (entry) =>
                !entry.error && Boolean(entry.path) && Boolean(entry.signedUrl),
            )
            .map((entry) => [entry.path as string, entry.signedUrl as string]),
        );
        for (const asset of bucketAssets) {
          const signedUrl = signedByPath.get(asset.path);
          if (signedUrl) urls[asset.id] = prepareUrl(signedUrl, asset);
          else failures.push(asset.id);
        }
      } catch {
        failures.push(...bucketAssets.map((asset) => asset.id));
      }
    }),
  );
  return { urls, failures };
}
