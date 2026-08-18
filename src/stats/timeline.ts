/**
 * The same statistics, over time.
 *
 * A single VPIP figure describes a player as though they have always been the
 * same one. The point of a trainer is that they are not, so the numbers are
 * cut into blocks of hands and into sittings, and the only claim made about a
 * change is one the sample can actually support.
 *
 * Everything here is derived from the hands themselves, so it applies to a
 * history recorded long before this file existed.
 */

import type { HandRecord } from '../game/session'
import { aggregate, type SeatHandStats } from './hand-stats'

/** Hands per block. Small enough to show movement, large enough to mean something. */
export const BLOCK_SIZE = 25

/** The narrowest and widest a block is allowed to be, and how many to aim for. */
export const MIN_BLOCK = 10
export const MAX_BLOCK = 50
export const TARGET_BLOCKS = 8

/**
 * How wide a block should be for a history of this length.
 *
 * Fixed blocks fail at both ends: at twenty-five hands a new player sees one
 * point and no trend at all, and at ten thousand they get four hundred points
 * of noise. The width is chosen to keep roughly eight blocks on screen, in
 * round numbers, and the chart says which width it settled on — a trend whose
 * unit is unstated is not readable.
 */
export function blockSizeFor(hands: number): number {
  const ideal = Math.round(hands / TARGET_BLOCKS / 5) * 5
  return Math.min(MAX_BLOCK, Math.max(MIN_BLOCK, ideal))
}

/**
 * A gap this long ends a sitting.
 *
 * Somebody who closes the tab and comes back after dinner has played twice,
 * and a session is the unit people actually think in ("I ran badly last
 * night") — so it is worth naming even though the block series does not need
 * it.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000

export interface Block {
  /** Index of the block, oldest first. */
  index: number
  hands: number
  /** Hand numbers this block spans, counting from the first hand ever played. */
  from: number
  to: number
  vpip: number
  pfr: number
  aggressionFactor: number
  wtsd: number
  bbPer100: number
  /**
   * Big blinds of expected value given up per 100 hands, over the graded hands
   * in the block, or null when none of them have been graded yet.
   */
  evLostPer100: number | null
  gradedHands: number
}

const heroStats = (record: HandRecord): SeatHandStats => record.stats[record.heroSeat]!

/**
 * Cut a history into equal blocks of hands, oldest first.
 *
 * A trailing part-block is kept rather than dropped — it is the most recent
 * play, which is the part somebody is most interested in — and it carries its
 * own hand count so nothing has to pretend it is as solid as a full one.
 */
export function blocks(history: readonly HandRecord[], size = BLOCK_SIZE): Block[] {
  const out: Block[] = []

  for (let start = 0; start < history.length; start += size) {
    const slice = history.slice(start, start + size)
    const first = slice[0]!
    const stats = aggregate(slice.map(heroStats), first.bigBlind)
    const graded = slice.filter((record) => record.evLostBB !== undefined)
    const evLost = graded.reduce((sum, record) => sum + (record.evLostBB ?? 0), 0)

    out.push({
      index: out.length,
      hands: slice.length,
      from: start + 1,
      to: start + slice.length,
      vpip: stats.vpip,
      pfr: stats.pfr,
      aggressionFactor: stats.aggressionFactor,
      wtsd: stats.wtsd,
      bbPer100: stats.bbPer100,
      evLostPer100: graded.length === 0 ? null : (evLost / graded.length) * 100,
      gradedHands: graded.length,
    })
  }

  return out
}

export interface Sitting {
  /** When the first hand of the sitting was played. */
  startedAt: number
  endedAt: number
  hands: number
  bbPer100: number
  evLostPer100: number | null
}

/**
 * Group a history into sittings, split wherever play stopped for a while.
 *
 * Hands with no timestamp have not been written down yet, which means they
 * belong to the sitting happening right now.
 */
export function sittings(
  history: readonly HandRecord[],
  gap = SESSION_GAP_MS,
): Sitting[] {
  const out: Sitting[] = []
  let current: HandRecord[] = []
  let last: number | null = null

  const flush = () => {
    if (current.length === 0) return
    const times = current
      .map((record) => record.playedAt)
      .filter((at): at is number => at !== undefined)
    const stats = aggregate(current.map(heroStats), current[0]!.bigBlind)
    const graded = current.filter((record) => record.evLostBB !== undefined)
    const evLost = graded.reduce((sum, record) => sum + (record.evLostBB ?? 0), 0)

    out.push({
      startedAt: times[0] ?? 0,
      endedAt: times[times.length - 1] ?? 0,
      hands: current.length,
      bbPer100: stats.bbPer100,
      evLostPer100: graded.length === 0 ? null : (evLost / graded.length) * 100,
    })
    current = []
  }

  for (const record of history) {
    const at = record.playedAt
    if (at !== undefined && last !== null && at - last > gap) flush()
    current.push(record)
    if (at !== undefined) last = at
  }
  flush()

  return out
}

export interface Movement {
  /** Mean over the older half, and over the newer one. */
  before: number
  after: number
  change: number
  /** Hands behind each half, the smaller of which bounds what can be claimed. */
  sample: number
  /**
   * Whether the difference is larger than the noise in it.
   *
   * A two-sample comparison at 95%: this is the difference between "you have
   * tightened up" and "you have played differently for twenty hands", and
   * saying the first when only the second is true is how trackers mislead.
   */
  real: boolean
}

/**
 * Compare the first half of a history against the second.
 *
 * `valueOf` reads the quantity from each hand — a rate as 0 or 1, chips as a
 * number — and the comparison is made on those per-hand values, so the noise
 * in the answer is measured rather than assumed.
 */
export function movement(
  history: readonly HandRecord[],
  valueOf: (record: HandRecord) => number | null,
): Movement | null {
  const values = history
    .map(valueOf)
    .filter((value): value is number => value !== null && Number.isFinite(value))
  if (values.length < 4) return null

  const half = Math.floor(values.length / 2)
  const before = values.slice(0, half)
  const after = values.slice(values.length - half)

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const variance = (xs: number[], m: number) =>
    xs.length < 2 ? 0 : xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1)

  const meanBefore = mean(before)
  const meanAfter = mean(after)
  const standardError = Math.sqrt(
    variance(before, meanBefore) / before.length + variance(after, meanAfter) / after.length,
  )

  const change = meanAfter - meanBefore
  return {
    before: meanBefore,
    after: meanAfter,
    change,
    sample: half,
    // Zero noise is the most certain case there is, not the least: two halves
    // that never varied and still differ have differed for a reason. Guarding
    // on the noise being positive would throw that away and call it nothing.
    real: change !== 0 && Math.abs(change) > 1.96 * standardError,
  }
}

/** The per-hand readings the trend view compares. */
export const READINGS = {
  vpip: (record: HandRecord) => (heroStats(record).vpip ? 1 : 0),
  pfr: (record: HandRecord) => (heroStats(record).pfr ? 1 : 0),
  net: (record: HandRecord) => heroStats(record).net / record.bigBlind,
  evLost: (record: HandRecord) => record.evLostBB ?? null,
} satisfies Record<string, (record: HandRecord) => number | null>

/**
 * Say what has changed, in a sentence, or nothing at all.
 *
 * Nothing at all is the common and correct answer: over a few hundred hands,
 * most apparent movement is noise, and a trainer that announces a trend every
 * session teaches people to read tea leaves.
 */
export function describeMovement(history: readonly HandRecord[]): string | null {
  const evLost = movement(history, READINGS.evLost)
  if (evLost?.real) {
    const better = evLost.change < 0
    return `Over your last ${evLost.sample} graded hands you are giving up ${Math.abs(
      evLost.change * 100,
    ).toFixed(1)}bb/100 ${better ? 'less' : 'more'} than you were — ${
      better ? 'the decisions are getting better' : 'the decisions are getting worse'
    }.`
  }

  const vpip = movement(history, READINGS.vpip)
  if (vpip?.real) {
    const tighter = vpip.change < 0
    return `You are playing ${Math.abs(vpip.change * 100).toFixed(
      0,
    )}% ${tighter ? 'fewer' : 'more'} hands than you were over your first ${vpip.sample}.`
  }

  return null
}
