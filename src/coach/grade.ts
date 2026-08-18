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

import { Rng } from '../engine/cards'
import { applyAction, legalActions, startHandWithDeck } from '../engine/hand'
import { potSize, type Action, type HandState, type Street } from '../engine/types'
import type { HandRecord } from '../game/session'
import { requiredEquity } from './odds'
import { evaluateActions, evContext, heroEquity, type ActionEV } from './ev'
import { lookupPreflop, type BlueprintAdvice } from '../solver/blueprint'

/**
 * What the coach's verdicts are worth remembering as.
 *
 * A graded hand is cached rather than regraded on every load, which would
 * otherwise freeze today's coach into a player's record forever. Raise this
 * whenever a change here would give a hand a different verdict: every cached
 * verdict below it is discarded and worked out again.
 */
export const GRADER_VERSION = 1

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

export interface DecisionGrade {
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

function sizingsFor(state: HandState, heroSeat: number): number[] {
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
 * Grade every decision the hero made in a hand.
 *
 * `seed` fixes the sampling so a hand always grades to the same numbers — a
 * verdict that changed each time you opened it would be worthless.
 */
export function gradeHand(record: HandRecord, heroSeat: number, seed = 4242): HandGrade {
  const decisions: DecisionGrade[] = []

  for (const { state, action } of replayHand(record)) {
    if (state.toAct !== heroSeat) continue

    const rng = new Rng(seed + decisions.length)
    const context = evContext(state, heroSeat, rng)
    const hero = state.seats[heroSeat]!
    const pot = potSize(state)
    const toCall = Math.max(0, state.currentBet - hero.committed)

    const options = evaluateActions(context, sizingsFor(state, heroSeat))
    if (options.length === 0) continue

    const best = options.reduce((a, b) => (b.ev > a.ev ? b : a))
    // The action actually taken may be a size the grader did not offer, so
    // price it directly rather than looking it up.
    const chosenExact = options.find((o) => sameAction(o.action, action))
    const chosen =
      chosenExact ?? evaluateActions(context, action.type === 'raise' ? [action.to] : [])
        .find((o) => sameAction(o.action, action))

    if (!chosen) continue

    const evLoss = Math.max(0, best.ev - chosen.ev)
    const evLossBB = evLoss / record.bigBlind

    const solved = state.street === 'preflop' ? lookupPreflop(state, heroSeat) : null

    const partial = {
      street: state.street,
      potBefore: pot,
      toCall,
      equity: heroEquity(context),
      requiredEquity: requiredEquity(toCall, pot),
      options,
      chosen: action,
      chosenLabel: chosen.label,
      bestLabel: best.label,
      evLoss,
      evLossBB,
      verdict: verdictFor(evLossBB),
      ...(solved ? { blueprint: solved } : {}),
    }

    decisions.push({ ...partial, explanation: explain(partial) })
  }

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
