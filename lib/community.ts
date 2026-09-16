import type { Row } from "./types";

export type CommunityOrder = "alphabetical" | "online" | "wealth";

export function orderCommunityIdentities(
  identities: Row[],
  rankByIdentity: ReadonlyMap<string, number>,
  onlineUserIds: ReadonlySet<string>,
  order: CommunityOrder,
) {
  return [...identities].sort((left, right) => {
    if (order === "online" || order === "wealth") {
      const leftOnline = Boolean(
        left.user_id && onlineUserIds.has(left.user_id),
      );
      const rightOnline = Boolean(
        right.user_id && onlineUserIds.has(right.user_id),
      );
      if (leftOnline !== rightOnline) return leftOnline ? -1 : 1;
    }

    if (order === "wealth") {
      const leftRank = rankByIdentity.get(left.id);
      const rightRank = rankByIdentity.get(right.id);
      if (leftRank !== undefined || rightRank !== undefined) {
        if (leftRank === undefined) return 1;
        if (rightRank === undefined) return -1;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
    }

    return left.name.localeCompare(right.name, "pt-BR");
  });
}
