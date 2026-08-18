/**
 * Equity estimation, tracked over time.
 *
 * Predict-then-reveal is the mode that turns the overlay from a crutch into
 * training: the player commits to a number before seeing one. That is only
 * worth doing if the guesses are kept, because the point is not any single
 * estimate but whether the estimates are getting better.
 *
 * The metric is mean absolute error in percentage points. It is the honest one
 * — a player who is twenty points out in both directions is not accurate on
 * average, and averaging the signed error would say they were.
 */

export interface Estimate {
  handNumber: number
  street: string
  /** What the player predicted, in percentage points. */
  guess: number
  /** What it actually was, in percentage points. */
  actual: number
  /** Board cards visible when the guess was made. */
  boardSize: number
}

export interface EstimateSummary {
  count: number
  /** Mean absolute error, in percentage points. */
  meanError: number
  /**
   * Mean signed error: positive means the player consistently overrates their
   * hand, which is a different and more fixable problem than being imprecise.
   */
  bias: number
  /** Share of guesses within five points. */
  withinFive: number
  /** Error over the first half against the second, to show a trend. */
  improvement: number | null
}

export const errorOf = (estimate: Estimate): number =>
  Math.abs(estimate.guess - estimate.actual)

export function summarise(estimates: readonly Estimate[]): EstimateSummary {
  const count = estimates.length
  if (count === 0) {
    return { count: 0, meanError: 0, bias: 0, withinFive: 0, improvement: null }
  }

  const meanError = estimates.reduce((sum, e) => sum + errorOf(e), 0) / count
  const bias = estimates.reduce((sum, e) => sum + (e.guess - e.actual), 0) / count
  const withinFive = estimates.filter((e) => errorOf(e) <= 5).length / count

  // A trend needs enough guesses on each side of the split to mean anything.
  let improvement: number | null = null
  if (count >= 20) {
    const half = Math.floor(count / 2)
    const early = estimates.slice(0, half)
    const late = estimates.slice(half)
    const earlyError = early.reduce((sum, e) => sum + errorOf(e), 0) / early.length
    const lateError = late.reduce((sum, e) => sum + errorOf(e), 0) / late.length
    improvement = earlyError - lateError
  }

  return { count, meanError, bias, withinFive, improvement }
}

/** Estimation error broken down by how much of the board was visible. */
export function byStreet(estimates: readonly Estimate[]): Map<string, EstimateSummary> {
  const groups = new Map<string, Estimate[]>()
  for (const estimate of estimates) {
    const group = groups.get(estimate.street)
    if (group) group.push(estimate)
    else groups.set(estimate.street, [estimate])
  }

  const out = new Map<string, EstimateSummary>()
  for (const [street, group] of groups) out.set(street, summarise(group))
  return out
}

/**
 * How good a given error actually is.
 *
 * Bands exist so the number means something to a player who has no idea
 * whether being eight points out is good. Judging equity to within five points
 * by eye is genuinely strong; within ten is solid.
 */
export function describeAccuracy(meanError: number): string {
  if (meanError <= 5) return 'sharp'
  if (meanError <= 10) return 'solid'
  if (meanError <= 18) return 'rough'
  return 'guessing'
}
