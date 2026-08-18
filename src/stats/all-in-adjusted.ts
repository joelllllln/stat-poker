/**
 * All-in adjusted results: what a hand was worth, rather than what it paid.
 *
 * When the chips go in and there are cards still to come, the rest of the hand
 * is decided by the deck. The adjusted result replaces that coin flip with its
 * expectation — every possible runout, weighted equally — so the same decisions
 * always score the same regardless of which card happened to fall.
 *
 * Charted against the actual result, the gap between the two lines is luck. It
 * is the most honest thing a poker tracker can show a player, and the reason
 * this is worth the enumeration it costs.
 */

import { NUM_CARDS, Rng, type Card } from '../engine/cards'
import { evaluate } from '../engine/evaluator'
import { awardPots, buildPots } from '../engine/hand'
import type { HandState } from '../engine/types'

export interface AdjustedResult {
  /** Chips actually won or lost. */
  actual: number[]
  /** Chips the hand was worth, averaging over every remaining runout. */
  adjusted: number[]
  /** True when a runout was still to come, so the two can differ. */
  wasAllIn: boolean
  /** Runouts enumerated, or 0 when no adjustment applied. */
  runouts: number
}

/**
 * Runouts to enumerate before switching to sampling.
 *
 * A preflop all-in has 1,712,304 completions and takes seconds to enumerate in
 * full — fine for one hand, far too slow for a dashboard covering a session.
 * Above this bound the runouts are sampled with a fixed seed instead, which
 * keeps the answer stable from one page load to the next.
 */
const MAX_ENUMERATED_RUNOUTS = 120_000
const SAMPLED_RUNOUTS = 20_000

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1)
  return Math.round(result)
}

/**
 * Average the result over every completion of the board.
 *
 * This uses the players' real hole cards, which is legitimate here in a way it
 * never is when grading a decision: the question is not what anyone should
 * have done but what the pot was worth once the betting was over.
 */
export function allInAdjusted(state: HandState, seed = 0x5adf): AdjustedResult {
  const result = state.result
  if (result === null) throw new Error('Hand is not complete')

  const actual = result.net
  const dealtFrom = result.runoutFrom

  // Nothing to adjust: the hand ended without a forced runout.
  if (!result.showdown || dealtFrom >= 5) {
    return { actual, adjusted: actual, wasAllIn: false, runouts: 0 }
  }

  const live = state.seats.filter((s) => s.status !== 'folded')
  const known = new Set<Card>([
    ...state.seats.flatMap((s) => (s.holeCards ? [...s.holeCards] : [])),
    ...state.board.slice(0, dealtFrom),
  ])
  const deck: Card[] = []
  for (let card = 0; card < NUM_CARDS; card++) if (!known.has(card)) deck.push(card)

  const needed = 5 - dealtFrom
  const board: Card[] = [...state.board.slice(0, dealtFrom), ...new Array<Card>(needed)]
  const totals = new Array<number>(state.seats.length).fill(0)
  const handValues: (number | null)[] = state.seats.map(() => null)
  const scratch: Card[] = new Array(7)
  let runouts = 0

  const score = (): void => {
    for (const seat of live) {
      scratch[0] = seat.holeCards![0]
      scratch[1] = seat.holeCards![1]
      for (let i = 0; i < 5; i++) scratch[i + 2] = board[i]!
      handValues[seat.index] = evaluate(scratch)
    }
    // Rebuild the pots each runout: `awardPots` records winners on them.
    const winnings = awardPots(buildPots(state), handValues, state.buttonSeat, state.seats.length)
    for (let i = 0; i < totals.length; i++) totals[i]! += winnings[i]!
    runouts++
  }

  if (binomial(deck.length, needed) <= MAX_ENUMERATED_RUNOUTS) {
    const walk = (depth: number, start: number): void => {
      if (depth === needed) return score()
      for (let i = start; i < deck.length; i++) {
        board[dealtFrom + depth] = deck[i]!
        walk(depth + 1, i + 1)
      }
    }
    walk(0, 0)
  } else {
    const rng = new Rng(seed)
    const pool = [...deck]
    for (let trial = 0; trial < SAMPLED_RUNOUTS; trial++) {
      // Partial Fisher-Yates draws the runout without replacement.
      for (let i = 0; i < needed; i++) {
        const j = i + rng.nextInt(pool.length - i)
        const tmp = pool[i]!
        pool[i] = pool[j]!
        pool[j] = tmp
        board[dealtFrom + i] = pool[i]!
      }
      score()
    }
  }

  const adjusted = state.seats.map(
    (seat, i) => totals[i]! / runouts - seat.totalCommitted,
  )

  return { actual, adjusted, wasAllIn: true, runouts }
}

export interface LuckSummary {
  /** Cumulative actual result in big blinds, one point per hand. */
  actual: number[]
  /** Cumulative all-in adjusted result in big blinds. */
  adjusted: number[]
  /** Actual minus adjusted: positive means the deck has been kind. */
  luckBB: number
  /** Hands where chips went in with cards to come. */
  allInHands: number
}

/**
 * Running actual and adjusted results for one seat across a history.
 *
 * Hands that never got all-in contribute the same value to both lines, so the
 * two only diverge where luck actually had a say.
 */
/**
 * The same answer, remembered.
 *
 * Pricing a hand re-deals every runout it could have had, which is a few
 * milliseconds — nothing once, and a visible stall when a growing history is
 * redrawn on every action. The hand state is immutable, so its identity is a
 * sound key and a hand is priced once however often it is drawn.
 */
const priced = new WeakMap<HandState, AdjustedResult>()

export function pricedHand(state: HandState): AdjustedResult {
  let result = priced.get(state)
  if (result === undefined) {
    result = allInAdjusted(state)
    priced.set(state, result)
  }
  return result
}

export function luckCurve(
  hands: { state: HandState; bigBlind: number; seat?: number }[],
  seat: number,
): LuckSummary {
  const actual: number[] = []
  const adjusted: number[] = []
  let runningActual = 0
  let runningAdjusted = 0
  let allInHands = 0

  for (const hand of hands) {
    const { actual: real, adjusted: expected, wasAllIn } = pricedHand(hand.state)
    if (wasAllIn) allInHands++
    // A history can span tables, so each hand may name the seat it was played
    // from; the argument is the fallback for a caller that knows it is one.
    const heroSeat = hand.seat ?? seat
    runningActual += (real[heroSeat] ?? 0) / hand.bigBlind
    runningAdjusted += (expected[heroSeat] ?? 0) / hand.bigBlind
    actual.push(runningActual)
    adjusted.push(runningAdjusted)
  }

  return {
    actual,
    adjusted,
    luckBB: runningActual - runningAdjusted,
    allInHands,
  }
}
