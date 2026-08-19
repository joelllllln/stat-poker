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

import { ARCHETYPES, positionalOpenWidth, type Archetype } from '../bots/archetypes'
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

/**
 * Preflop width for a seat whose style the table knows.
 *
 * The widths above are one guess for everybody, and replaying a few hundred
 * hands showed what that costs: a maniac's raise was being put on the top 15%
 * of hands when it really meant the top 47%, and two thirds of the hands it
 * held were not even inside the range it had been assigned. A seat that raises
 * with anything and a seat that raises with aces are not holding the same
 * range, and the app knows which is which.
 *
 * So where the style is on the hand, the width comes from that player's own
 * thresholds — the same numbers the policy opens, defends and reraises by.
 * Returns null where nothing better than the general guess can be said.
 */
function styledPreflopWidth(state: HandState, seat: number, style: Archetype): number | null {
  const preflop = state.actions.filter((entry) => entry.street === 'preflop')
  const mine = preflop.filter((entry) => entry.seat === seat)
  // Posted a blind and not acted: it has done nothing to narrow anything.
  if (mine.length === 0) return 1

  // The strongest thing it did is what its range is read from, and the price
  // it faced is the price at the moment it did it.
  const strongest =
    mine.find((entry) => entry.action.type === 'raise') ??
    mine.find((entry) => entry.action.type === 'call') ??
    mine[0]!
  const at = preflop.indexOf(strongest)
  const before = preflop.slice(0, at)
  const raisesBefore = before.filter((entry) => entry.action.type === 'raise').length

  if (strongest.action.type === 'raise') {
    if (raisesBefore > 0) return style.reraiseWidth / raisesBefore
    // Opening. A seat that has to get through more players opens tighter, and
    // the players it had to get through are the ones that had not yet acted.
    const behind = state.seats.filter(
      (other) =>
        other.index !== seat && !before.some((entry) => entry.seat === other.index),
    ).length
    return positionalOpenWidth(style.openWidth, behind)
  }

  if (strongest.action.type === 'call') {
    // A width of zero is the style saying this never happens — the rock does
    // not limp. It just did, so the style does not explain the seat here, and
    // the honest reading is the general one rather than "it must have aces".
    const width = raisesBefore > 0 ? style.defendWidth / raisesBefore : style.limpWidth
    return width > 0 ? width : null
  }

  // Checked its option in the big blind: it declined to open, which rules out
  // almost nothing. The ranges here are always "the top w%", so there is no
  // way to say "everything but the best hands" — and claiming to know more
  // than that would be worse than admitting it does not.
  return 1
}

/** Fraction of starting hands this seat is estimated to hold. */
export function modelledWidth(state: HandState, seat: number): number {
  const style = state.seats[seat]?.style
  const known = style ? ARCHETYPES[style] : undefined
  const styled = known ? styledPreflopWidth(state, seat, known) : null

  const preflop = strongestAction(state, seat, 'preflop')
  let width: number =
    styled ?? (preflop === null ? PREFLOP_WIDTH.posted : PREFLOP_WIDTH[preflop])

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

/**
 * The range a seat would be *perceived* to hold if it bet or raised now.
 *
 * When pricing a bet, what matters is not the range the opponent currently
 * puts you on but the one they would put you on after seeing the bet. Using
 * the pre-bet range makes every bluff look hopeless, because the model has the
 * villain defending against a range far wider than the one actually
 * threatening them.
 */
export function perceivedRangeAfterAggression(state: HandState, seat: number): Range {
  const width =
    state.street === 'preflop'
      ? PREFLOP_WIDTH.raised
      : modelledWidth(state, seat) * POSTFLOP_NARROWING.raised
  return rangeForWidth(width)
}

/** Modelled ranges for every opponent still in the hand. */
export function liveOpponentRanges(state: HandState, heroSeat: number): Range[] {
  return state.seats
    .filter((seat) => seat.index !== heroSeat && seat.status !== 'folded')
    .map((seat) => modelOpponentRange(state, seat.index))
}

export type { PreflopStrength }
