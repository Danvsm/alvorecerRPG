import type { Row } from "@/lib/types";
import { CosmeticIcon } from "./CosmeticsPanel";
import AvatarFrame from "./AvatarFrame";

export default function IdentityBadge({
  identity,
  cosmetics,
  equipment,
  urls,
  avatarSize = 52,
}: {
  identity: Row;
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  avatarSize?: number | string;
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
      <AvatarFrame
        avatarUrl={urls[identity.avatar_id]}
        avatarAlt={identity.name}
        frame={frame}
        frameUrl={frame?.asset_path ? urls[frame.id] : undefined}
        size={avatarSize}
      />
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
