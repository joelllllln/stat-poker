/**
 * Pot odds and expected value.
 *
 * These are the numbers the live overlay puts on screen and the numbers the
 * coach grades against, so they are defined once here rather than recomputed
 * per surface.
 */

/**
 * The share of the pot you must win for a call to break even.
 *
 * `pot` is the pot *before* the call. Calling 25 into 75 risks 25 to win 100,
 * so you need 25%.
 *
 * Where the caller cannot cover the bet, `pot` must be what the call can
 * actually win rather than what is on the table — see `winnablePot`. Chips
 * nobody matched are returned to whoever bet them, so they were never part of
 * the price.
 */
export function requiredEquity(toCall: number, pot: number): number {
  if (toCall <= 0) return 0
  return toCall / (pot + toCall)
}

/** Pot odds as the familiar `3:1` string. */
export function potOddsRatio(toCall: number, pot: number): string {
  if (toCall <= 0) return '—'
  const ratio = pot / toCall
  return `${ratio.toFixed(ratio >= 10 ? 0 : 1)}:1`
}

/**
 * EV of calling, in chips, relative to folding.
 *
 * `pot` carries the same caveat as {@link requiredEquity}: it is what the call
 * can win, which is the whole pot only when the caller covers the table.
 *
 * Folding is the zero point: chips already in the pot are gone either way, so
 * only the call and its outcomes count. This framing is what makes "correct
 * call that lost" a coherent verdict.
 */
export function evOfCall(equity: number, toCall: number, pot: number): number {
  return equity * pot - (1 - equity) * toCall
}

/** Stack-to-pot ratio, the usual shorthand for how much room is left to play. */
export function stackToPotRatio(effectiveStack: number, pot: number): number {
  if (pot <= 0) return Infinity
  return effectiveStack / pot
}

/** Chips expressed in big blinds, for display. */
export const inBigBlinds = (chips: number, bigBlind: number): number => chips / bigBlind
