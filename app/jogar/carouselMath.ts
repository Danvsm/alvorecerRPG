export function circularDistance(index: number, position: number, count: number) {
  const difference = ((index - position) % count + count) % count;
  return difference > count / 2 ? difference - count : difference;
}

export function snapPosition(position: number, velocity: number, origin: number) {
  // A short coast rewards a quick flick; cap it to keep the destination predictable.
  const projected = position + Math.max(-1.4, Math.min(1.4, velocity * 150));
  return Math.max(origin - 3, Math.min(origin + 3, Math.round(projected)));
}
