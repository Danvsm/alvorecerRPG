import type { Row } from "./types";

export const LEGACY_COSMETIC_EQUIP = "cosmetic_equip";
export const FORCE_DELETE_FRAME = "delete";

export function cosmeticsActionRequest(
  campaign: string,
  operation: string,
  data: Row,
) {
  if (operation === FORCE_DELETE_FRAME) {
    return {
      rpc: "delete_avatar_frame",
      params: {
        c: campaign,
        target_id: data.frame_id,
      },
    } as const;
  }

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
