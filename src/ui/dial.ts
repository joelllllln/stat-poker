/**
 * The geometry of the dial.
 *
 * Separate from the component that draws it so it can be checked. An arc path
 * is four numbers and two flags, and getting a flag wrong does not throw, does
 * not warn, and does not look wrong until the value it is drawing crosses the
 * point where the flag changes — which is exactly the kind of fault that ships.
 */

export interface Point {
  x: number
  y: number
}

/**
 * Where a fraction of the way round the dial lands.
 *
 * The dial is the top half of a circle, read left to right: 0 is due west, 1
 * is due east, and a half is straight up.
 */
export function dialPoint(cx: number, cy: number, r: number, fraction: number): Point {
  const angle = Math.PI * (1 - Math.max(0, Math.min(1, fraction)))
  return { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) }
}

/**
 * The arc from the left of the dial to `fraction` of the way round it.
 *
 * The large-arc flag is always zero. The dial spans a half turn at most, so
 * every arc it can draw is the short way round; setting the flag from the
 * fraction sends everything past halfway the long way instead, which draws
 * the complement of the arc that was asked for.
 */
export function dialArc(cx: number, cy: number, r: number, fraction: number): string {
  const start = dialPoint(cx, cy, r, 0)
  const end = dialPoint(cx, cy, r, fraction)
  return `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`
}
