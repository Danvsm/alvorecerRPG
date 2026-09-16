import type { Row } from "@/lib/types";

export function equippedFrameForIdentity(
  identityId: string | undefined,
  cosmetics: Row[],
  equipment: Row[],
) {
  if (!identityId) return undefined;
  const equippedFrameId = equipment.find(
    (entry) => entry.identity_id === identityId && entry.kind === "frame",
  )?.cosmetic_id;
  if (!equippedFrameId) return undefined;
  return cosmetics.find(
    (cosmetic) => cosmetic.id === equippedFrameId && cosmetic.kind === "frame",
  );
}

export function identityForUser(userId: string | undefined, identities: Row[]) {
  if (!userId) return undefined;
  return identities.find((identity) => identity.user_id === userId);
}
