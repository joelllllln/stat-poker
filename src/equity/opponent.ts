/**
 * Opponent range modelling.
 *
 * Every equity number the app shows is against a *modelled* range, so this is
 * where that model lives — shared by the bots (to decide) and by the HUD and
 * coach (to explain). One model, one place, so what a bot believed and what
 * the review says it believed can never diverge.
 *
 * This is deliberately coarse: a range widens or narrows by how aggressively
 * the seat has acted, nothing more. It is honest about being a heuristic, and
 * the solver phases replace it for heads-up postflop rather than patching it.
 */

import type { HandState, Street } from '../engine/types'
import { topPercentRange, type PreflopStrength } from './preflop'
import { parseRange, type Range } from './range'

/** How wide a seat's range starts, by the strongest preflop action it took. */
const PREFLOP_WIDTH = {
  raised: 0.15,
  called: 0.35,
  /** Checked its option in the big blind: almost anything. */
  checked: 0.7,
  /** Posted a blind and has not acted yet. */
  posted: 0.9,
} as const

/** Multiplier applied per street for the strongest action taken on it. */
const POSTFLOP_NARROWING = {
  raised: 0.5,
  called: 0.8,
  checked: 1.0,
} as const

const MIN_WIDTH = 0.04
const MAX_WIDTH = 1

// Range construction is not free and the same widths recur constantly, so
// widths are bucketed to a percentage point and the result memoised.
const rangeCache = new Map<number, Range>()

function rangeForWidth(width: number): Range {
  const bucket = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)) * 100)
  const cached = rangeCache.get(bucket)
  if (cached) return cached
  const range = parseRange(topPercentRange(bucket / 100))
  rangeCache.set(bucket, range)
  return range
}

type Strength = 'raised' | 'called' | 'checked' | 'posted'

function strongestAction(state: HandState, seat: number, street: Street): Strength | null {
  const actions = state.actions.filter((a) => a.seat === seat && a.street === street)
  if (actions.length === 0) return null
  if (actions.some((a) => a.action.type === 'raise')) return 'raised'
  if (actions.some((a) => a.action.type === 'call')) return 'called'
  return 'checked'
}

/** Fraction of starting hands this seat is estimated to hold. */
export function modelledWidth(state: HandState, seat: number): number {
  const preflop = strongestAction(state, seat, 'preflop')
  let width: number = preflop === null ? PREFLOP_WIDTH.posted : PREFLOP_WIDTH[preflop]

  for (const street of ['flop', 'turn', 'river'] as const) {
    const action = strongestAction(state, seat, street)
    if (action === null || action === 'posted') continue
    width *= POSTFLOP_NARROWING[action]
  }

  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))
}

/** The range this seat is estimated to be holding, given how it has played. */
export function modelOpponentRange(state: HandState, seat: number): Range {
  return rangeForWidth(modelledWidth(state, seat))
}

/** Modelled ranges for every opponent still in the hand. */
export function liveOpponentRanges(state: HandState, heroSeat: number): Range[] {
  return state.seats
    .filter((seat) => seat.index !== heroSeat && seat.status !== 'folded')
    .map((seat) => modelOpponentRange(state, seat.index))
}

export type { PreflopStrength }
