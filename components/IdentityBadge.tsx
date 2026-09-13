import type { Row } from "@/lib/types";
import { UserRound } from "lucide-react";
import { CosmeticIcon } from "./CosmeticsPanel";

export default function IdentityBadge({
  identity,
  cosmetics,
  equipment,
  urls,
}: {
  identity: Row;
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
}) {
  const equipped = (kind: string) =>
    cosmetics.find(
      (c) =>
        c.id ===
        equipment.find((e) => e.identity_id === identity.id && e.kind === kind)
          ?.cosmetic_id,
    );
  const frame = equipped("frame"),
    title = equipped("title"),
    medal = equipped("medal");
  return (
    <div className="identity-badge">
      <span
        className="identity-photo"
        style={{ borderColor: frame?.color || "transparent" }}
      >
        {urls[identity.avatar_id] ? (
          <img src={urls[identity.avatar_id]} alt="" loading="lazy" />
        ) : (
          <UserRound />
        )}
      </span>
      <span>
        <strong>{identity.name}</strong>
        {(title || identity.subtitle) && (
          <small>{title?.name || identity.subtitle}</small>
        )}
      </span>
      {medal && (
        <span title={medal.name} aria-label={medal.name}>
          <CosmeticIcon item={medal} />
        </span>
      )}
    </div>
  );
}
