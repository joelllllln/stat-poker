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
import { handEquity, subsetEquity } from '../equity/equity'
import { modelOpponentRange, perceivedRangeAfterAggression } from '../equity/opponent'
import { removeBlocked, rangeWeight, type Combo, type Range } from '../equity/range'
import { preflopStrength } from '../equity/preflop'
import { normalCdf } from '../stats/inference'
import type { Archetype } from '../bots/archetypes'
import { callDisciplineOf, defendWidthOf, preflopRaises, styleAt } from './opponents'
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
 * The rule is the seat's own, taken from `./opponents`: postflop a hand
 * continues when its equity clears the price by as much as that player insists
 * on, and preflop it continues if it is in the slice of the range that player
 * defends. Where the table says nothing about who is sitting there, a general
 * rule about poker stands in. Whichever applies, it is the same rule the app
 * grades the player by.
 */
export interface RangeSplit {
  /** Weight of combos that fold. */
  folding: number
  /** Weight of combos that continue. */
  continuing: number
  /** The continuing combos, for equity when called. */
  continuingRange: Range
  /** Standard error on the folding share, from the sampling behind it. */
  foldError: number
}

interface PricedCombo {
  combo: Combo
  equity: number
  /** Standard error on that equity; zero where it was enumerated. */
  error: number
  /**
   * Where this holding ranks among all starting hands, 1 being the best.
   *
   * Preflop the opponents do not compare equity with a price at all — they
   * defend the top slice of their range — so this, not `equity`, is what
   * decides whether they fold before the flop.
   */
  strength: number
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
  withEquities: boolean,
): { priced: PricedCombo[]; total: number } {
  const stride = Math.max(1, Math.ceil(range.length / COMBO_SAMPLE))
  const scale = stride // each sampled combo stands in for `stride` of them
  const priced: PricedCombo[] = []
  let total = 0

  for (let i = 0; i < range.length; i += stride) {
    const source = range[i]!
    const combo: Combo = { cards: source.cards, weight: source.weight * scale }
    // A seat that defends by width never consults an equity, so rolling one
    // out for every combination it holds would be work nothing reads.
    let equity = 0.5
    let error = 0
    if (withEquities) {
      try {
        const result = handEquity(combo.cards, [heroRange], board, {
          // Its own seed per combo, so a combo prices the same whatever else was
          // asked first, and one unlucky stream cannot tilt the whole range.
          rng: new Rng(seed * 977 + i),
          iterations: COMBO_ITERATIONS,
          exactBudget: COMBO_EXACT_BUDGET,
        })
        equity = result.equity
        error = result.errorMargin / 2
      } catch {
        // Hero's modelled range can be entirely blocked by this combo; treat
        // the spot as a coin flip rather than dropping the combo.
        equity = 0.5
      }
    }
    priced.push({ combo, equity, error, strength: preflopStrength(combo.cards).percentile })
    total += combo.weight
  }

  return { priced, total }
}

/**
 * Split a priced range at a price, by the rule the seat holding it plays by.
 *
 * **Postflop** a hand continues when its equity clears the price, scaled by
 * how disciplined that seat is about the price: the fish continues on 60% of
 * what the odds demand, the rock wants 135% of it. Those equities are mostly
 * sampled, though, so for a combo sitting near the threshold the honest answer
 * is not which side it falls but how likely it is to fall on each — which is
 * what its own error bar says. That expectation is the split, it converges to
 * the plain comparison as the error goes to zero, and the leftover uncertainty
 * comes back as `foldError` rather than being dropped and later mistaken for a
 * difference in the play.
 *
 * **Preflop** the price does not enter into it, because for these opponents it
 * does not: they defend the top slice of their range and fold the rest,
 * however much is being asked. Pricing them as though a bigger raise folded
 * more of them out is precisely the error the simulation caught.
 */
function splitAtPrice(
  priced: PricedCombo[],
  price: number,
  style: Archetype | null,
  defendWidth: number | null,
): RangeSplit {
  let folding = 0
  let continuing = 0
  let variance = 0
  const continuingRange: Combo[] = []
  const discipline = callDisciplineOf(style)

  for (const entry of priced) {
    let continues: number
    if (defendWidth !== null) {
      // A width, not a price: this is a lookup, so there is nothing uncertain
      // about which side of it a hand falls.
      continues = entry.strength >= 1 - defendWidth ? 1 : 0
    } else {
      const margin = entry.equity - price * discipline
      const spread = entry.error
      continues = spread > 0 ? normalCdf(margin / spread) : margin >= 0 ? 1 : 0
    }

    continuing += entry.combo.weight * continues
    folding += entry.combo.weight * (1 - continues)
    variance += entry.combo.weight ** 2 * continues * (1 - continues)
    if (continues > 0) {
      continuingRange.push({ cards: entry.combo.cards, weight: entry.combo.weight * continues })
    }
  }

  const total = folding + continuing
  return {
    folding,
    continuing,
    continuingRange,
    foldError: total > 0 ? Math.sqrt(variance) / total : 0,
  }
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
  const { state, heroSeat, heroCards, villains, seed, effort } = context
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
  // How wide each seat defends preflop once this bet has gone in. It does not
  // depend on the size — that is the whole point of it — so it is worked out
  // once rather than per sizing. It is null postflop, and null for a seat whose
  // style the table does not record, which is what puts those back on the
  // price-clearing rule.
  const raisesAfter = preflopRaises(state) + 1
  const pricedVillains = villains
    .map((seat) => {
      const style = styleAt(state, seat)
      return {
        seat,
        style,
        defendWidth:
          state.street === 'preflop' && style !== null ? defendWidthOf(style, raisesAfter) : null,
        range: removeBlocked(modelOpponentRange(state, seat), blockers),
      }
    })
    .filter(({ range }) => rangeWeight(range) > 0)
    .map(({ seat, style, defendWidth, range }) => ({
      seat,
      style,
      defendWidth,
      // A seat defending by width never consults an equity, so there is no
      // reason to roll one out for every combination it holds.
      ...priceRange(range, heroRange, state.board, seed, defendWidth === null),
    }))

  for (const to of sizings) {
    const amount = to - hero.committed
    if (amount <= 0 || amount > hero.stack) continue

    // Every villain faces its own price. What it owes is measured from what it
    // has already put in — the small blind owes more than the big blind to see
    // the same raise — and capped by what it has left.
    const facing = pricedVillains.map(({ seat, style, defendWidth, priced, total }) => {
      const villain = state.seats[seat]!
      const contribution = Math.min(villain.stack, Math.max(0, to - villain.committed))
      if (contribution === 0) {
        // Nothing left to put in is nothing left to fold: a seat already all-in
        // is in the pot whatever the hero does now.
        return { fold: 0, foldError: 0, range: priced.map((entry) => entry.combo), contribution }
      }
      const split = splitAtPrice(
        priced,
        requiredEquity(contribution, pot + amount),
        style,
        defendWidth,
      )
      return {
        fold: total > 0 ? split.folding / total : 1,
        foldError: split.foldError,
        range: split.continuingRange,
        contribution,
      }
    })

    // A villain with nothing left in its range folds every time and drops out
    // of the enumeration; everyone else is one bit of it.
    const callers = facing.filter((villain) => villain.range.length > 0)
    let foldEquity = facing.reduce(
      (product, villain) => product * (villain.range.length > 0 ? villain.fold : 1),
      1,
    )

    let ev = pot
    let error = 0

    if (callers.length > 0) {
      // Which of them calls is not knowable in advance, so every way the field
      // can split is priced and weighted by how likely it is. The old model
      // said the villains decide independently and then priced them as though
      // they decided together, which overstated both the pot won and the field
      // faced.
      const priced = subsetEquity(
        heroCards,
        callers.map((villain) => villain.range),
        state.board,
        {
          rng: new Rng(seed),
          iterations: HERO_ITERATIONS,
          targetError,
          maxIterations: MAX_HERO_ITERATIONS * effort,
        },
      )

      /** Expected value of the bet, for a given set of folding frequencies. */
      const valueAt = (folds: number[]): { ev: number; error: number; noCall: number } => {
        let total = 0
        let sampling = 0
        // How often nobody calls is the product of their folding, and it is
        // worked out here rather than read off the enumeration below: a subset
        // with no chance of happening is skipped there, and "everybody folds"
        // is exactly the subset that goes to zero the moment one opponent
        // never folds. Taking it from the loop left the bet credited with
        // every opponent folding precisely when one of them could not.
        const noCall = folds.reduce((product, fold) => product * fold, 1)

        for (let mask = 0; mask < 1 << callers.length; mask++) {
          let probability = 1
          let contributions = 0
          let largest = 0
          for (let i = 0; i < callers.length; i++) {
            const calls = (mask >> i) & 1
            probability *= calls ? 1 - folds[i]! : folds[i]!
            if (calls) {
              // A caller adds only what it still owes, and only as much as it
              // has — shoving into a short stack risks the short stack, not
              // the whole bet.
              contributions += callers[i]!.contribution
              largest = Math.max(largest, callers[i]!.contribution)
            }
          }
          if (probability <= 0) continue

          const share = priced.equity[mask]!
          const won = pot + contributions
          const risked = Math.min(amount, largest)
          total += probability * (share * won - (1 - share) * risked)
          // The subsets are drawn from the same rollouts and move together, so
          // adding their errors is an overstatement rather than an understatement.
          sampling += probability * priced.error[mask]! * (won + risked)
        }
        return { ev: total, error: sampling, noCall }
      }

      const folds = callers.map((villain) => villain.fold)
      const centre = valueAt(folds)
      ev = centre.ev
      foldEquity = centre.noCall

      // How much of a villain's range calls is itself an estimate, and moving
      // one of them by its own error moves the answer by this much. Held apart
      // from the sampling error above and added in quadrature, because they are
      // independent and neither one alone accounts for what a reseeded run does.
      let fromFolds = 0
      for (let i = 0; i < callers.length; i++) {
        const shifted = [...folds]
        shifted[i] = Math.min(1, Math.max(0, folds[i]! + callers[i]!.foldError))
        fromFolds += (valueAt(shifted).ev - centre.ev) ** 2
      }
      error = Math.sqrt(centre.error ** 2 + fromFolds)
    }

    options.push({
      action: { type: 'raise', to },
      label: state.currentBet > 0 ? `Raise to ${to}` : `Bet ${to}`,
      ev,
      error,
      foldEquity,
    })
  }

  return { equity, equityError, options }
}
