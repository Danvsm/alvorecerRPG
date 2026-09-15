import type { Row } from "./types";

export const LEGACY_COSMETIC_EQUIP = "cosmetic_equip";

export function cosmeticsActionRequest(
  campaign: string,
  operation: string,
  data: Row,
) {
  const legacyCosmetic = operation === LEGACY_COSMETIC_EQUIP;

  return {
    rpc: legacyCosmetic ? "identity_action" : "frame_action",
    params: {
      c: campaign,
      op: legacyCosmetic ? "equip" : operation,
      d: data,
    },
  } as const;
}
