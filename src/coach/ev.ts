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
import { winnablePot } from '../engine/hand'
import { potSize, type Action, type HandState } from '../engine/types'
import { handEquity } from '../equity/equity'
import { modelOpponentRange, perceivedRangeAfterAggression } from '../equity/opponent'
import { removeBlocked, rangeWeight, type Combo, type Range } from '../equity/range'
import { requiredEquity } from './odds'

/** Rollouts when pricing a single villain combo. */
const COMBO_ITERATIONS = 150
const HERO_ITERATIONS = 4_000

/**
 * Ceiling on rollouts for one equity answer.
 *
 * The precision a verdict needs grows with the size of the pot, and on a big
 * flop it would run to millions of rollouts — far past what a review of a
 * whole history can pay. So the budget is capped, and where the cap binds the
 * answer keeps its error bar and the verdict is only as confident as the
 * sample allows. A caller with a verdict hanging in the balance raises the cap
 * for that one decision through `effort`, which is where the rollouts are
 * worth spending and nowhere else.
 */
const MAX_HERO_ITERATIONS = 12_000

/**
 * Expected value the sampler aims to pin down, in big blinds.
 *
 * Comfortably inside the band between a correct action and a mistake, so the
 * noise does not decide which one a player is told they made. Where the pot is
 * large enough that reaching it would cost more rollouts than the cap allows,
 * the shortfall shows up in the error bar and the verdict softens to match.
 */
const TARGET_EV_ERROR_BB = 0.15

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
  /**
   * Standard error on `ev`, in chips.
   *
   * EV is linear in equity, so the error on a sampled equity carries through
   * exactly rather than needing a second experiment to measure it. Zero when
   * every runout behind the number was enumerated.
   */
  error: number
  /** How often the whole field folds to this bet, where it is a bet. */
  foldEquity?: number
}

/**
 * Everything one decision is worth knowing, priced once.
 *
 * The equity comes back with the actions because it is the same number the
 * actions were priced from. Asking for it a second time would sample it again
 * and put a different figure on screen from the one behind the verdict.
 */
export interface DecisionEV {
  /** Hero's equity against the field's modelled ranges. */
  equity: number
  /** Standard error on that equity; zero when it was enumerated exactly. */
  equityError: number
  options: ActionEV[]
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
  seed: number,
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
        // Its own seed per combo, so a combo prices the same whatever else was
        // asked first, and one unlucky stream cannot tilt the whole range.
        rng: new Rng(seed * 977 + i),
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
  /**
   * The seed every sampled answer in this decision is drawn from.
   *
   * A single generator threaded through the decision made each answer depend
   * on what had been asked before it, so the same question gave different
   * numbers depending on the order — and the sampling error in one action was
   * independent of the sampling error in the next, which is the worst case
   * when the only quantity that matters is the difference between them.
   *
   * Seeding every query from the same number instead makes each one
   * reproducible on its own and prices the alternatives against the same draws,
   * so most of the error cancels where they are compared. This is common random
   * numbers, and it is free.
   */
  seed: number
  /** Multiplier on the sampling budget, raised where a verdict is in doubt. */
  effort: number
}

export function evContext(state: HandState, heroSeat: number, seed = 99, effort = 1): EVContext {
  const hero = state.seats[heroSeat]!
  if (!hero.holeCards) throw new Error('Hero has no cards')
  return {
    state,
    heroSeat,
    heroCards: hero.holeCards,
    villains: state.seats
      .filter((s) => s.index !== heroSeat && s.status !== 'folded')
      .map((s) => s.index),
    seed,
    effort,
  }
}

export interface HeroEquity {
  equity: number
  /** Standard error, not a 95% margin: zero when the answer was enumerated. */
  error: number
}

/**
 * Hero's equity against the field's modelled ranges.
 *
 * `targetError` is the precision the caller needs, in share of the pot. Where
 * the answer is enumerated it is exact and the target costs nothing; where it
 * is sampled, asking for more precision is what buys a verdict that does not
 * depend on the seed.
 */
export function heroEquity(
  context: EVContext,
  ranges?: Range[],
  targetError = 0,
): HeroEquity {
  const { state, heroCards, villains, seed, effort } = context
  const against = ranges ?? villains.map((seat) => modelOpponentRange(state, seat))
  if (against.length === 0) return { equity: 1, error: 0 }
  try {
    const result = handEquity(heroCards, against, state.board, {
      rng: new Rng(seed),
      iterations: HERO_ITERATIONS,
      exactBudget: HERO_EXACT_BUDGET,
      targetError,
      maxIterations: MAX_HERO_ITERATIONS * effort,
    })
    // `errorMargin` is a 95% interval; everything downstream composes standard
    // errors, so it is halved once here rather than in every caller.
    return { equity: result.equity, error: result.errorMargin / 2 }
  } catch {
    return { equity: 0.5, error: 0 }
  }
}

/**
 * EV of every action available at this node, in chips relative to folding.
 *
 * Bet sizes are the ones the interface offers, so the verdict is always
 * reachable: it never tells you to make a bet you could not have made.
 */
export function evaluateActions(context: EVContext, sizings: number[]): DecisionEV {
  const { state, heroSeat, heroCards, villains, seed } = context
  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  const toCall = Math.max(0, state.currentBet - hero.committed)

  // How precisely this decision needs to be priced follows from what is at
  // stake in it: an error of a hundredth of the pot is nothing in a three-blind
  // pot and decides the verdict in a fifty-blind one. So the target is stated
  // in big blinds of expected value and converted into equity here, rather than
  // fixing an iteration count that means something different in every pot.
  //
  // The scale is the most chips any action being priced can swing — the pot,
  // everything the field could put in behind the largest bet, and the bet
  // itself — because that is what multiplies the error in the equity.
  const largest = Math.max(hero.committed + toCall, ...sizings)
  const swing =
    pot +
    largest +
    villains.reduce(
      (sum, i) => sum + Math.min(state.seats[i]!.stack, Math.max(0, largest - state.seats[i]!.committed)),
      0,
    )
  const targetError =
    swing > 0 ? (TARGET_EV_ERROR_BB * state.bigBlind) / (swing * Math.sqrt(context.effort)) : 0
  const { equity, error: equityError } = heroEquity(context, undefined, targetError)

  const options: ActionEV[] = []

  // Folding is always legal, so it is always priced. It is the zero point:
  // chips already in the middle are gone whatever happens next. Leaving it out
  // where checking is free is what let a fold with the best hand go ungraded.
  options.push({ action: { type: 'fold' }, label: 'Fold', ev: 0, error: 0 })

  if (toCall > 0) {
    const cost = Math.min(toCall, hero.stack)
    // A call plays for what the bettor matched, not for what they bet: a stack
    // too short to cover the bet leaves the remainder out of the hand.
    const winnable = winnablePot(state, heroSeat, cost)
    options.push({
      action: { type: 'call' },
      label: `Call ${cost}`,
      ev: equity * winnable - (1 - equity) * cost,
      error: equityError * (winnable + cost),
    })
  } else {
    // Checking takes the hand to a showdown for free. Ignoring later betting,
    // that is worth the pot times your share of it.
    options.push({
      action: { type: 'check' },
      label: 'Check',
      ev: equity * pot,
      error: equityError * pot,
    })
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
    .map(({ seat, range }) => ({ seat, ...priceRange(range, heroRange, state.board, seed) }))

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

    const called =
      continuingRanges.length === 0
        ? { equity: 1, error: 0 }
        : heroEquity(context, continuingRanges, targetError)
    const won = pot + calledContributions
    const risked = Math.min(amount, largestContribution)

    options.push({
      action: { type: 'raise', to },
      label: state.currentBet > 0 ? `Raise to ${to}` : `Bet ${to}`,
      ev:
        foldEquity * pot +
        (1 - foldEquity) * (called.equity * won - (1 - called.equity) * risked),
      error: (1 - foldEquity) * called.error * (won + risked),
      foldEquity,
    })
  }

  return { equity, equityError, options }
}
