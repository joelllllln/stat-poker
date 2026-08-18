/**
 * The statistics behind every claim the app makes about a player.
 *
 * A trainer's whole value is that it says something true about somebody, and
 * almost everything it says is a comparison on a small sample: this half of
 * your hands against that one, this spot against the rest of your game. The
 * tests those comparisons need are collected here rather than re-derived at
 * each call site, so that "we only say it when the sample supports it" means
 * one thing everywhere.
 *
 * Two rules shaped what is in here. Use the test that matches the data: a rate
 * is a proportion and the normal approximation collapses at its extremes,
 * where a per-hand result is continuous and heavy-tailed and needs its spread
 * measured rather than assumed. And when several questions are asked of the
 * same history, the answer to *any* of them looking surprising is much less
 * surprising than one of them would be alone.
 */

import { Rng } from '../engine/cards'

/** Standard normal cumulative distribution — Abramowitz and Stegun 7.1.26. */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x)
  return 0.5 * (1 + sign * y)
}

/** Two-sided p-value for a z statistic. */
export const twoSidedP = (z: number): number => 2 * (1 - normalCdf(Math.abs(z)))

export interface Comparison {
  /** Mean of the first sample, and of the second. */
  before: number
  after: number
  /** after − before. */
  change: number
  /** 95% interval on that difference. */
  low: number
  high: number
  /** The smaller of the two samples, which is what bounds the claim. */
  sample: number
  /** True when the interval excludes zero. */
  real: boolean
  /** Two-sided p-value, for combining several comparisons. */
  p: number
}

const EMPTY: Comparison = {
  before: 0,
  after: 0,
  change: 0,
  low: 0,
  high: 0,
  sample: 0,
  real: false,
  p: 1,
}

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * Difference between two proportions, by the Agresti-Caffo interval.
 *
 * Adding a success and a failure to each side before taking the interval is
 * not a fudge: it is the standard correction, and its coverage is provably
 * better than the plain normal approximation at every sample size. It also
 * cannot degenerate. Ten hands played and ten hands folded gives the textbook
 * interval a width of zero and a certainty it has not earned; this gives an
 * interval that still contains zero, which is the truth at that sample.
 */
export function compareProportions(
  successesBefore: number,
  totalBefore: number,
  successesAfter: number,
  totalAfter: number,
): Comparison {
  if (totalBefore === 0 || totalAfter === 0) return EMPTY

  const n1 = totalBefore + 2
  const n2 = totalAfter + 2
  const p1 = (successesBefore + 1) / n1
  const p2 = (successesAfter + 1) / n2
  const standardError = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)
  const change = p2 - p1
  const margin = 1.959964 * standardError

  return {
    before: successesBefore / totalBefore,
    after: successesAfter / totalAfter,
    change,
    low: change - margin,
    high: change + margin,
    sample: Math.min(totalBefore, totalAfter),
    real: change - margin > 0 || change + margin < 0,
    p: standardError > 0 ? twoSidedP(change / standardError) : 1,
  }
}

/** Resamples behind a permutation p-value and a bootstrap interval. */
const RESAMPLES = 2_000

/**
 * Difference between two means, by permutation.
 *
 * Chips won per hand are as far from normal as data gets — a long flat middle
 * and rare enormous tails — which is the whole reason a winrate needs tens of
 * thousands of hands to mean anything. A t-test on twenty of them assumes
 * exactly the shape that is missing.
 *
 * A permutation test assumes nothing. If the two halves came from the same
 * player playing the same way, every way of dealing these results into two
 * halves was equally likely, so the question "how often would chance alone
 * separate them this far?" is answered by trying it. It is exact in the small
 * sample, where it matters most: two hands against two cannot produce a
 * significant answer however different they look, because there are only six
 * ways to split four values and one of them is this one.
 *
 * It also handles the case a t-test cannot — halves with no spread inside them
 * at all — for the same reason, rather than by a rule about zero variance.
 *
 * The interval is a percentile bootstrap, from the same principle: resample
 * what was actually seen instead of assuming the shape it was drawn from. It
 * costs more than the test does and a caller that only needs the verdict can
 * turn it off.
 */
export function compareMeans(
  before: readonly number[],
  after: readonly number[],
  options: { resamples?: number; interval?: boolean } = {},
): Comparison {
  if (before.length < 2 || after.length < 2) return EMPTY

  const resamples = options.resamples ?? RESAMPLES
  const meanBefore = mean(before)
  const meanAfter = mean(after)
  const change = meanAfter - meanBefore
  const pooled = [...before, ...after]
  const total = pooled.reduce((a, b) => a + b, 0)
  const rng = new Rng(0x9e3779b9)

  // How often chance alone would separate the halves at least this far.
  //
  // Only the smaller side has to be dealt: the other side is whatever is left,
  // and its mean follows from the total. That keeps the cost proportional to
  // the smaller sample rather than to the history, which is what makes this
  // affordable on a group of twenty decisions inside a history of thousands.
  const draw = Math.min(before.length, after.length)
  const drawIsBefore = draw === before.length
  const others = pooled.length - draw
  let atLeastAsExtreme = 0

  for (let trial = 0; trial < resamples; trial++) {
    let sum = 0
    for (let i = 0; i < draw; i++) {
      const j = i + rng.nextInt(pooled.length - i)
      const swap = pooled[i]!
      pooled[i] = pooled[j]!
      pooled[j] = swap
      sum += pooled[i]!
    }
    const drawnMean = sum / draw
    const restMean = (total - sum) / others
    const difference = drawIsBefore ? restMean - drawnMean : drawnMean - restMean
    if (Math.abs(difference) >= Math.abs(change) - 1e-12) atLeastAsExtreme++
  }
  // The observed split is itself one of the ways it could have fallen, which is
  // what keeps a p-value from ever coming out as an impossible zero.
  const p = (atLeastAsExtreme + 1) / (resamples + 1)

  let low = change
  let high = change
  if (options.interval !== false) {
    // Percentile bootstrap on the difference, resampling each side from itself.
    const differences: number[] = []
    for (let trial = 0; trial < resamples; trial++) {
      let sumBefore = 0
      for (let i = 0; i < before.length; i++) sumBefore += before[rng.nextInt(before.length)]!
      let sumAfter = 0
      for (let i = 0; i < after.length; i++) sumAfter += after[rng.nextInt(after.length)]!
      differences.push(sumAfter / after.length - sumBefore / before.length)
    }
    differences.sort((a, b) => a - b)
    const at = (quantile: number) =>
      differences[Math.min(differences.length - 1, Math.floor(quantile * differences.length))]!
    low = at(0.025)
    high = at(0.975)
  }

  return {
    before: meanBefore,
    after: meanAfter,
    change,
    low,
    high,
    sample: Math.min(before.length, after.length),
    real: p < 0.05,
    p,
  }
}

/**
 * Compare two samples with whichever test fits them.
 *
 * A reading that only ever comes back 0 or 1 is a rate — whether the hand was
 * played, whether it went to showdown — and is compared as one.
 */
export function compare(before: readonly number[], after: readonly number[]): Comparison {
  const isRate = [...before, ...after].every((x) => x === 0 || x === 1)
  if (!isRate) return compareMeans(before, after)
  return compareProportions(
    before.reduce((a, b) => a + b, 0),
    before.length,
    after.reduce((a, b) => a + b, 0),
    after.length,
  )
}

/**
 * Which of several comparisons survive being asked all at once.
 *
 * Holm's step-down: the smallest p-value must clear α/m, the next α/(m−1), and
 * so on, stopping at the first that fails. It controls the chance of making
 * *any* false claim across the set, needs no assumption that the tests are
 * independent — they are not, since the groups overlap — and throws away far
 * less than dividing α by m everywhere would.
 */
export function holm(pValues: readonly number[], alpha = 0.05): boolean[] {
  const order = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p)
  const kept = new Array<boolean>(pValues.length).fill(false)

  for (let rank = 0; rank < order.length; rank++) {
    const entry = order[rank]!
    if (entry.p > alpha / (order.length - rank)) break
    kept[entry.index] = true
  }

  return kept
}
