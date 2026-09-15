"use client";

import { memo } from "react";
import { UserRound } from "lucide-react";
import type { Row } from "@/lib/types";

type FrameEffect = {
  type: "glow" | "shine" | "pulse" | "aura" | "particles" | "runes";
  color?: string;
  intensity?: number;
  speed?: number;
  opacity?: number;
  quantity?: number;
  size?: number;
};

function clamp(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

function normalizedEffects(frame?: Row): FrameEffect[] {
  if (!Array.isArray(frame?.effects)) return [];
  return frame.effects
    .slice(0, 2)
    .filter((effect: Row) =>
      ["glow", "shine", "pulse", "aura", "particles", "runes"].includes(
        effect?.type,
      ),
    ) as FrameEffect[];
}

function AvatarFrameView({
  avatarUrl,
  avatarAlt = "",
  frame,
  frameUrl,
  size = 96,
  className = "",
}: {
  avatarUrl?: string;
  avatarAlt?: string;
  frame?: Row;
  frameUrl?: string;
  size?: number | string;
  className?: string;
}) {
  const effects = normalizedEffects(frame);
  const style = {
    "--avatar-frame-size": typeof size === "number" ? `${size}px` : size,
    "--frame-scale": clamp(frame?.scale, 0.25, 3, 1),
    "--frame-x": `${clamp(frame?.offset_x, -100, 100, 0)}%`,
    "--frame-y": `${clamp(frame?.offset_y, -100, 100, 0)}%`,
  } as React.CSSProperties;

  return (
    <span
      className={`avatar-frame${frameUrl ? " has-frame" : ""} ${className}`.trim()}
      style={style}
    >
      <span
        className="avatar-frame-photo"
        style={{
          borderColor: !frameUrl && frame?.color ? frame.color : undefined,
        }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={avatarAlt} loading="lazy" />
        ) : (
          <UserRound aria-hidden="true" />
        )}
      </span>
      {frameUrl && (
        <>
          {effects.map((effect, index) => {
            const quantity = Math.round(clamp(effect.quantity, 1, 12, 6));
            const effectStyle = {
              "--effect-color": effect.color || frame?.color || "#c855ff",
              "--effect-intensity": clamp(effect.intensity, 0.2, 2, 1),
              "--effect-speed": `${clamp(effect.speed, 0.4, 8, 2.4)}s`,
              "--effect-opacity": clamp(effect.opacity, 0.1, 1, 0.75),
              "--effect-size": clamp(effect.size, 0.5, 2, 1),
            } as React.CSSProperties;
            return (
              <span
                key={`${effect.type}-${index}`}
                className={`avatar-frame-effect effect-${effect.type}`}
                style={effectStyle}
                aria-hidden="true"
              >
                {effect.type === "particles" &&
                  Array.from({ length: quantity }, (_, particle) => (
                    <i
                      key={particle}
                      style={{ "--particle": particle } as React.CSSProperties}
                    />
                  ))}
                {effect.type === "runes" && <b>✦ · ✧ · ✦ · ✧</b>}
              </span>
            );
          })}
          <img
            className="avatar-frame-art"
            src={frameUrl}
            alt=""
            loading="lazy"
            aria-hidden="true"
          />
        </>
      )}
    </span>
  );
}

const AvatarFrame = memo(AvatarFrameView);
export default AvatarFrame;
