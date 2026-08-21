/**
 * Grading a played hand.
 *
 * Two rules govern everything here.
 *
 * **Grade the decision, never the outcome.** A call that was correct and lost
 * is a correct call, and it is reported as one. Grading on results teaches
 * people to fold winners and chase losers.
 *
 * **Grade against the range, never the cards.** Every verdict is computed from
 * what was knowable at the moment of the decision — the opponents' modelled
 * ranges, the board, the stacks. Villain hole cards never enter the maths,
 * even though the replay knows them.
 */

import { applyAction, legalActions, startHandWithDeck, winnablePot } from '../engine/hand'
import { potSize, type Action, type HandState, type Street } from '../engine/types'
import type { HandRecord } from '../game/session'
import { requiredEquity } from './odds'
import { evaluateActions, evContext, type ActionEV } from './ev'
import { lookupPreflop, type BlueprintAdvice } from '../solver/blueprint'

/**
 * What the coach's verdicts are worth remembering as.
 *
 * A graded hand is cached rather than regraded on every load, which would
 * otherwise freeze today's coach into a player's record forever. Raise this
 * whenever a change here would give a hand a different verdict: every cached
 * verdict below it is discarded and worked out again.
 */
export const GRADER_VERSION = 5

export type Verdict = 'optimal' | 'fine' | 'mistake' | 'blunder'

/**
 * Verdict bands in big blinds of expected value given up.
 *
 * The bands, not a frequency match, are what decides a verdict. At equilibrium
 * the actions inside a mixed strategy have nearly identical EV — which is why
 * they are mixed — so an action played only 20% of the time is not a mistake.
 * Grading on "did you match the frequency" would mark correct play wrong.
 */
export const VERDICT_BANDS: { verdict: Verdict; upTo: number }[] = [
  { verdict: 'optimal', upTo: 0.1 },
  { verdict: 'fine', upTo: 0.5 },
  { verdict: 'mistake', upTo: 2 },
  { verdict: 'blunder', upTo: Infinity },
]

export function verdictFor(evLossInBB: number): Verdict {
  return VERDICT_BANDS.find((band) => evLossInBB <= band.upTo)!.verdict
}

/**
 * How sure a verdict has to be before it is delivered.
 *
 * Most spots are priced by sampling, so the expected value given up carries an
 * error bar. A verdict is a claim about a player, and a claim is only made when
 * the sample supports it: the band comes from the *conservative* end of that
 * bar, so noise can lose a blunder but can never invent one. That is the same
 * standard the trend view is held to, applied to the coach.
 */
const VERDICT_CONFIDENCE = 1.96

/**
 * How much harder a decision is priced when its verdict is in the balance.
 *
 * Almost every decision is clear-cut and needs nothing; buying precision
 * everywhere would slow a review of a whole history down for no change in what
 * it says.
 */
const REFINE_EFFORT = 12

/** The most a decision can be shown to have cost, and so the verdict it earns. */
export function verdictWithin(evLossBB: number, errorBB: number): Verdict {
  return verdictFor(Math.max(0, evLossBB - VERDICT_CONFIDENCE * errorBB))
}

/**
 * The part of a verdict worth keeping forever.
 *
 * A full grade carries every priced alternative and the sentences explaining
 * them, which is what the review panel shows and far more than a history needs
 * to remember. This is the part the leak finder and the dashboard read, small
 * enough to store for every hand a player has ever played.
 */
export interface GradedDecision {
  street: Street
  /** What it cost to continue, which is what makes a spot "facing a bet". */
  toCall: number
  evLossBB: number
  verdict: Verdict
  chosen: Action
  /**
   * The action the arithmetic preferred.
   *
   * Kept beside the one taken because the pair is what says *what kind* of
   * mistake it was. "You give up most on the turn" tells somebody where to
   * look; "you fold too much on the turn" tells them what to change, and the
   * difference between those two is this field.
   */
  best: Action
}

export interface DecisionGrade extends GradedDecision {
  street: Street
  potBefore: number
  toCall: number
  /** Hero's equity against the field's modelled ranges at this moment. */
  equity: number
  /** Share of the pot a call needed to break even, or 0 when not facing a bet. */
  requiredEquity: number
  options: ActionEV[]
  chosen: Action
  chosenLabel: string
  bestLabel: string
  /** Chips of expected value given up, never below zero. */
  evLoss: number
  evLossBB: number
  /**
   * Standard error on that figure, in big blinds.
   *
   * Zero where the answer was enumerated — every river call, and most turns.
   * The verdict is taken from the conservative end of it, while the figure
   * itself stays the best estimate, because a total that is shrunk towards
   * zero every time it is added up would understate a real leak.
   */
  evLossErrorBB: number
  verdict: Verdict
  explanation: string
  /**
   * The solved strategy for this spot, where one exists.
   *
   * Shown as context, never as the grade. An action a solution plays a fifth
   * of the time is not a mistake — actions inside a mix have nearly equal
   * value, which is precisely why they are mixed.
   */
  blueprint?: BlueprintAdvice
}

export interface HandGrade {
  decisions: DecisionGrade[]
  totalEvLossBB: number
  /** The single worst decision, if any was worse than fine. */
  worst: DecisionGrade | null
  /** True when every decision was correct but the hand still lost chips. */
  correctAndLost: boolean
  net: number
}

/**
 * Bet sizes considered when grading — the same ones the action bar offers, so
 * a verdict never tells you to make a bet you could not have made.
 *
 * All-in is offered only when the stacks are shallow enough for it to be a
 * normal option. The EV model prices one street, and within one street a huge
 * bet with a strong hand always scores highest: there is no later street in
 * which it could have cost you the value a smaller bet would have collected.
 * Offering it everywhere would make the coach recommend jamming the nuts on
 * the flop, which is a limitation of the model rather than advice.
 */
const SHOVE_SPR_LIMIT = 2

export function sizingsFor(state: HandState, heroSeat: number): number[] {
  const option = legalActions(state).find((o) => o.type === 'raise')
  if (!option) return []
  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  const toCall = state.currentBet - hero.committed

  const targets = [1 / 3, 0.5, 0.75, 1].map((fraction) =>
    Math.round(state.currentBet + (pot + toCall) * fraction),
  )
  if (hero.stack <= pot * SHOVE_SPR_LIMIT) targets.push(option.max!)

  return [...new Set(targets.map((t) => Math.max(option.min!, Math.min(option.max!, t))))]
}

const sameAction = (a: Action, b: Action): boolean =>
  a.type === b.type && (a.type !== 'raise' || b.type !== 'raise' || a.to === b.to)

function explain(grade: Omit<DecisionGrade, 'explanation'>): string {
  const equity = `${(grade.equity * 100).toFixed(1)}%`

  if (grade.verdict === 'optimal') {
    if (grade.toCall > 0 && grade.chosen.type === 'call') {
      return `You held ${equity} and needed ${(grade.requiredEquity * 100).toFixed(1)}% — a call that makes money whatever this one runout did.`
    }
    return `${grade.chosenLabel} is the highest-value action here, with ${equity} equity against their range.`
  }

  const loss = `${grade.evLossBB.toFixed(2)}bb`
  if (grade.chosen.type === 'fold' && grade.toCall === 0) {
    return `Folding gave up ${loss}: nobody had bet, so ${grade.bestLabel} was free and your ${equity} share of the pot went with the hand.`
  }
  if (grade.chosen.type === 'fold') {
    return `Folding gave up ${loss}: ${equity} equity beats the ${(grade.requiredEquity * 100).toFixed(1)}% the price asked for, so ${grade.bestLabel} was worth more.`
  }
  if (grade.chosen.type === 'call' && grade.toCall > 0) {
    return `Calling cost ${loss}: you needed ${(grade.requiredEquity * 100).toFixed(1)}% and held ${equity}. ${grade.bestLabel} was the better line.`
  }
  return `${grade.chosenLabel} gave up ${loss} against ${grade.bestLabel}, with ${equity} equity against their range.`
}

/**
 * Rebuild every state a hand passed through.
 *
 * Replay deals from the deck the hand was played with, not from its seed.
 * Reshuffling from the seed would tie every stored hand to the current
 * shuffling code: change the generator or the dealing order and the whole
 * history would silently replay as different hands.
 */
export function replayHand(record: HandRecord): { state: HandState; action: Action }[] {
  let state = startHandWithDeck(
    {
      seats: record.state.seats.map((seat, i) => ({
        name: seat.name,
        // Who was sitting there is part of the hand: the coach prices its bets
        // against these opponents, so a replay that forgot them would grade
        // the hand against a different table from the one it was played at.
        style: seat.style,
        stack: record.startingStacks[i]!,
      })),
      buttonSeat: record.buttonSeat,
      smallBlind: record.smallBlind,
      bigBlind: record.bigBlind,
    },
    record.state.deck,
  )

  const steps: { state: HandState; action: Action }[] = []
  for (const entry of record.state.actions) {
    steps.push({ state, action: entry.action })
    state = applyAction(state, entry.action)
  }
  return steps
}

/**
 * The seed every decision is priced from.
 *
 * Fixing it is what makes a hand grade to the same numbers however often it is
 * opened. It is shared with the live advice, which prices the same decision the
 * same way and so cannot disagree with the verdict that follows it.
 */
export const GRADE_SEED = 4242

/**
 * Grade every decision the hero made in a hand.
 *
 * `seed` fixes the sampling so a hand always grades to the same numbers — a
 * verdict that changed each time you opened it would be worthless.
 */
export function gradeHand(record: HandRecord, heroSeat: number, seed = GRADE_SEED): HandGrade {
  const decisions: DecisionGrade[] = []

  for (const { state, action } of replayHand(record)) {
    if (state.toAct !== heroSeat) continue

    const hero = state.seats[heroSeat]!
    const pot = potSize(state)
    // What continuing actually costs, and what it actually plays for: a stack
    // too short to cover the bet pays less than the bet and can win less than
    // the pot, and pricing it any other way flatters or damns the decision.
    const toCall = Math.min(Math.max(0, state.currentBet - hero.committed), hero.stack)
    const winnable = winnablePot(state, heroSeat, toCall)

    /** Price the decision, at a given sampling effort and set of bet sizes. */
    const price = (effort: number, sizings = sizingsFor(state, heroSeat)) => {
      const context = evContext(state, heroSeat, seed + decisions.length, effort)
      const priced = evaluateActions(context, sizings)
      if (priced.options.length === 0) return null

      const best = priced.options.reduce((a, b) => (b.ev > a.ev ? b : a))
      // The action actually taken may be a size the grader did not offer, so
      // price it directly rather than looking it up.
      const chosen =
        priced.options.find((o) => sameAction(o.action, action)) ??
        evaluateActions(context, action.type === 'raise' ? [action.to] : []).options.find((o) =>
          sameAction(o.action, action),
        )
      if (!chosen) return null

      const evLoss = Math.max(0, best.ev - chosen.ev)
      // Two sampled numbers are being subtracted, so their errors compose. They
      // are drawn from the same stream and so move together, which makes this
      // an overstatement rather than an understatement — the safe direction for
      // something about to be said to a player.
      const error = Math.sqrt(best.error ** 2 + chosen.error ** 2)
      return { priced, best, chosen, evLoss, error }
    }

    let graded = price(1)
    if (graded === null) continue

    // Where the error bar straddles a band, the verdict is being decided by
    // the sample rather than by the play. That is the one place more rollouts
    // are worth buying, and the only place they are bought.
    // The verdict is read off the conservative end of the bar, so what matters
    // is whether the figure moving by as much as the sample allows would move
    // that end into another band.
    const bandOf = (chips: number) => verdictFor(Math.max(0, chips) / record.bigBlind)
    if (bandOf(graded.evLoss) !== bandOf(graded.evLoss - 2 * VERDICT_CONFIDENCE * graded.error)) {
      // Only the two actions the verdict is the gap between need the extra
      // rollouts. If some third size was really the best, it was within the
      // noise of this one, so the loss is understated rather than invented.
      const contested = [graded.best.action, graded.chosen.action]
        .filter((a): a is Extract<Action, { type: 'raise' }> => a.type === 'raise')
        .map((a) => a.to)
      graded = price(REFINE_EFFORT, contested) ?? graded
    }

    const { priced, best, chosen, evLoss, error } = graded
    const evLossBB = evLoss / record.bigBlind
    const solved = state.street === 'preflop' ? lookupPreflop(state, heroSeat) : null

    const partial = {
      street: state.street,
      potBefore: pot,
      toCall,
      equity: priced.equity,
      requiredEquity: requiredEquity(toCall, winnable),
      options: priced.options,
      chosen: action,
      best: best.action,
      chosenLabel: chosen.label,
      bestLabel: best.label,
      evLoss,
      evLossBB,
      evLossErrorBB: error / record.bigBlind,
      verdict: verdictWithin(evLossBB, error / record.bigBlind),
      ...(solved ? { blueprint: solved } : {}),
    }

    decisions.push({ ...partial, explanation: explain(partial) })
  }

  return summariseGrades(decisions, record, heroSeat)
}

/**
 * Roll graded decisions up into a verdict on the hand.
 *
 * Separate from grading so a caller holding grades already — the review panel,
 * looking at a hand the worker graded a moment ago — can have the summary
 * without paying to grade the hand a second time.
 */
export function summariseGrades(
  decisions: DecisionGrade[],
  record: HandRecord,
  heroSeat: number,
): HandGrade {
  const net = record.state.result?.net[heroSeat] ?? 0
  const worst = decisions
    .filter((d) => d.verdict === 'mistake' || d.verdict === 'blunder')
    .reduce<DecisionGrade | null>((a, b) => (a === null || b.evLoss > a.evLoss ? b : a), null)

  return {
    decisions,
    totalEvLossBB: decisions.reduce((sum, d) => sum + d.evLossBB, 0),
    worst,
    // The verdict this app exists to be able to deliver.
    correctAndLost: net < 0 && decisions.length > 0 && decisions.every((d) => d.verdict === 'optimal'),
    net,
  }
}
