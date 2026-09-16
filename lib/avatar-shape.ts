import type { Row } from "./types";

export type AvatarShape = "circle" | "square";

export function avatarShapeFromTheme(theme?: Row): AvatarShape {
  return theme?.avatar_shape === "square" ? "square" : "circle";
}

export function avatarRadius(shape: AvatarShape) {
  return shape === "circle" ? "50%" : "28%";
}
