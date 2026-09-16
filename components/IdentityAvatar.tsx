import type { Row } from "@/lib/types";
import { equippedFrameForIdentity } from "@/lib/identity-visual";
import AvatarFrame from "./AvatarFrame";

export default function IdentityAvatar({
  identity,
  identityId,
  avatarId,
  avatarAlt,
  cosmetics,
  equipment,
  urls,
  size = 52,
  className = "",
}: {
  identity?: Row;
  identityId?: string;
  avatarId?: string;
  avatarAlt?: string;
  cosmetics: Row[];
  equipment: Row[];
  urls: Record<string, string>;
  size?: number | string;
  className?: string;
}) {
  const resolvedIdentityId = identity?.id || identityId;
  const resolvedAvatarId = identity?.avatar_id || avatarId;
  const frame = equippedFrameForIdentity(
    resolvedIdentityId,
    cosmetics,
    equipment,
  );

  return (
    <AvatarFrame
      avatarUrl={resolvedAvatarId ? urls[resolvedAvatarId] : undefined}
      avatarAlt={avatarAlt ?? identity?.name ?? ""}
      frame={frame}
      frameUrl={frame?.asset_path ? urls[frame.id] : undefined}
      size={size}
      className={className}
    />
  );
}
