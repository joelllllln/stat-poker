/**
 * The expected-value model behind every verdict.
 *
 * Scope, stated plainly because a coach that hides its assumptions is worse
 * than no coach: this is a **one-street model**. It prices the decision in
 * front of you — what folding, calling, checking or betting is worth right now
 * — and does not model the betting that follows on later streets. That makes
 * it exact where the hand ends here (a river call is fully priced) and an
 * approximation where it does not (implied odds on a flop draw are not
 * captured).
 *
 * Everything is measured relative to folding, which is worth zero: chips
 * already in the pot are gone whatever you do. That framing is what makes
 * "correct call that lost" a coherent verdict rather than a consolation.
 */

import { Rng, type Card } from '../engine/cards'
import { potSize, type Action, type HandState } from '../engine/types'
import { handEquity } from '../equity/equity'
import { modelOpponentRange, perceivedRangeAfterAggression } from '../equity/opponent'
import { removeBlocked, rangeWeight, type Combo, type Range } from '../equity/range'
import { requiredEquity } from './odds'

/** Rollouts when pricing a single villain combo. */
const COMBO_ITERATIONS = 150
const HERO_ITERATIONS = 4_000

/**
 * Enumeration budgets for grading.
 *
 * Left to its own defaults, `handEquity` enumerates whenever the work looks
 * affordable for a single query — but grading issues thousands of them, and a
 * turn spot that enumerates 44,000 runouts per combo turns a hand review into
 * a multi-second stall. These caps keep enumeration for the river, where it is
 * nearly free and exactly right, and sample everything earlier.
 */
const COMBO_EXACT_BUDGET = 2_000
const HERO_EXACT_BUDGET = 50_000

/**
 * How much of its raw equity a calling hand actually gets to keep.
 *
 * Pot odds alone say to continue whenever equity beats the price, but a hand
 * that calls still has to play the rest of the hand — often out of position,
 * often facing more bets, and rarely able to see every card it was counting
 * on. Requiring a hand to clear the price with room to spare is what stops the
 * model concluding that nobody ever folds to anything.
 */
const EQUITY_REALIZATION = 0.82

/**
 * Villain combos priced per decision.
 *
 * A range can hold over a thousand combinations, and pricing all of them for
 * every candidate bet size is what makes a naive grader take minutes per hand.
 * A stride sample of this size tracks the full range's fold fraction closely
 * enough for a verdict, and every combo it keeps carries the weight of the
 * ones it stands in for.
 */
const COMBO_SAMPLE = 80

export interface ActionEV {
  action: Action
  label: string
  /** Chips, relative to folding. */
  ev: number
  /** How often the whole field folds to this bet, where it is a bet. */
  foldEquity?: number
}

/**
 * How a villain's range splits against a bet.
 *
 * A combo continues when its equity beats the price the bet lays it. That is a
 * simplification — real players fold hands with the odds and call without them
 * — but it is a defensible, explainable rule, and it is the same rule the app
 * grades the player by.
 */
export interface RangeSplit {
  /** Weight of combos that fold. */
  folding: number
  /** Weight of combos that continue. */
  continuing: number
  /** The continuing combos, for equity when called. */
  continuingRange: Range
}

interface PricedCombo {
  combo: Combo
  equity: number
}

/**
 * Price each combo in a range once, against the hero's perceived range.
 *
 * Candidate bet sizes differ only in the price they lay, so this is computed
 * once per villain and every sizing re-thresholds the same numbers instead of
 * resampling them.
 */
function priceRange(
  range: Range,
  heroRange: Range,
  board: readonly Card[],
  rng: Rng,
): { priced: PricedCombo[]; total: number } {
  const stride = Math.max(1, Math.ceil(range.length / COMBO_SAMPLE))
  const scale = stride // each sampled combo stands in for `stride` of them
  const priced: PricedCombo[] = []
  let total = 0

  for (let i = 0; i < range.length; i += stride) {
    const source = range[i]!
    const combo: Combo = { cards: source.cards, weight: source.weight * scale }
    let equity: number
    try {
      equity = handEquity(combo.cards, [heroRange], board, {
        rng,
        iterations: COMBO_ITERATIONS,
        exactBudget: COMBO_EXACT_BUDGET,
      }).equity
    } catch {
      // Hero's modelled range can be entirely blocked by this combo; treat the
      // spot as a coin flip rather than dropping the combo.
      equity = 0.5
    }
    priced.push({ combo, equity })
    total += combo.weight
  }

  return { priced, total }
}

function splitAtPrice(priced: PricedCombo[], price: number): RangeSplit {
  let folding = 0
  let continuing = 0
  const continuingRange: Combo[] = []

  for (const entry of priced) {
    if (entry.equity * EQUITY_REALIZATION >= price) {
      continuing += entry.combo.weight
      continuingRange.push(entry.combo)
    } else {
      folding += entry.combo.weight
    }
  }

  return { folding, continuing, continuingRange }
}

export interface EVContext {
  state: HandState
  heroSeat: number
  heroCards: readonly [Card, Card]
  /** Villain seats still live. */
  villains: number[]
  rng: Rng
}

export function evContext(state: HandState, heroSeat: number, rng = new Rng(99)): EVContext {
  const hero = state.seats[heroSeat]!
  if (!hero.holeCards) throw new Error('Hero has no cards')
  return {
    state,
    heroSeat,
    heroCards: hero.holeCards,
    villains: state.seats
      .filter((s) => s.index !== heroSeat && s.status !== 'folded')
      .map((s) => s.index),
    rng,
  }
}

/** Hero's equity against the field's modelled ranges. */
export function heroEquity(context: EVContext, ranges?: Range[]): number {
  const { state, heroCards, villains, rng } = context
  const against = ranges ?? villains.map((seat) => modelOpponentRange(state, seat))
  if (against.length === 0) return 1
  try {
    return handEquity(heroCards, against, state.board, {
      rng,
      iterations: HERO_ITERATIONS,
      exactBudget: HERO_EXACT_BUDGET,
    }).equity
  } catch {
    return 0.5
  }
}

/**
 * EV of every action available at this node, in chips relative to folding.
 *
 * Bet sizes are the ones the interface offers, so the verdict is always
 * reachable: it never tells you to make a bet you could not have made.
 */
export function evaluateActions(context: EVContext, sizings: number[]): ActionEV[] {
  const { state, heroSeat, heroCards, villains, rng } = context
  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  const toCall = Math.max(0, state.currentBet - hero.committed)
  const equity = heroEquity(context)

  const results: ActionEV[] = []

  if (toCall > 0) {
    results.push({ action: { type: 'fold' }, label: 'Fold', ev: 0 })
    const cost = Math.min(toCall, hero.stack)
    results.push({
      action: { type: 'call' },
      label: `Call ${cost}`,
      ev: equity * pot - (1 - equity) * cost,
    })
  } else {
    // Checking takes the hand to a showdown for free. Ignoring later betting,
    // that is worth the pot times your share of it.
    results.push({ action: { type: 'check' }, label: 'Check', ev: equity * pot })
  }

  // Villains are priced against the range they would put the hero on *after*
  // this bet, not the wider one they see before it.
  const blockers = [...heroCards, ...state.board]
  const heroRange = removeBlocked(perceivedRangeAfterAggression(state, heroSeat), blockers)
  const pricedVillains = villains
    .map((seat) => ({
      seat,
      range: removeBlocked(modelOpponentRange(state, seat), blockers),
    }))
    .filter(({ range }) => rangeWeight(range) > 0)
    .map(({ seat, range }) => ({ seat, ...priceRange(range, heroRange, state.board, rng) }))

  for (const to of sizings) {
    const amount = to - hero.committed
    if (amount <= 0 || amount > hero.stack) continue

    // Each villain independently decides whether the price is worth paying.
    const villainToCall = to - state.currentBet
    const price = requiredEquity(villainToCall, pot + amount)
    let foldEquity = 1
    const continuingRanges: Range[] = []
    let calledContributions = 0
    let largestContribution = 0

    for (const { seat, priced, total } of pricedVillains) {
      const split = splitAtPrice(priced, price)
      foldEquity *= split.folding / total
      if (split.continuingRange.length === 0) continue
      continuingRanges.push(split.continuingRange)

      // A caller adds only what it still owes, and only as much as it has —
      // shoving into a short stack risks the short stack, not the whole bet.
      const villain = state.seats[seat]!
      const contribution = Math.min(villain.stack, to - villain.committed)
      calledContributions += contribution
      largestContribution = Math.max(largestContribution, contribution)
    }

    const equityWhenCalled =
      continuingRanges.length === 0 ? 1 : heroEquity(context, continuingRanges)
    const won = pot + calledContributions
    const risked = Math.min(amount, largestContribution)

    results.push({
      action: { type: 'raise', to },
      label: state.currentBet > 0 ? `Raise to ${to}` : `Bet ${to}`,
      ev:
        foldEquity * pot +
        (1 - foldEquity) * (equityWhenCalled * won - (1 - equityWhenCalled) * risked),
      foldEquity,
    })
  }

  return results
}
