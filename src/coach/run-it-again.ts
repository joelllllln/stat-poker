/**
 * Running a hand again, thousands of times.
 *
 * Everything about the hand is held exactly as it was played — the cards each
 * player held, every bet, every call — and only the community cards are dealt
 * again. That is precisely what players mean by running it twice, and it needs
 * no assumption about how anyone would have acted, because nobody acts
 * differently: the betting is a matter of record.
 *
 * The result turns "I got sucked out on" into a distribution with the actual
 * hand marked in it. A player who sees that the line they chose wins 78% of
 * the time has learned something the single result they lived through was
 * actively hiding.
 */

import { NUM_CARDS, Rng, type Card } from '../engine/cards'
import { evaluate } from '../engine/evaluator'
import { awardPots, buildPots } from '../engine/hand'
import type { HandState } from '../engine/types'

export interface RunItAgainResult {
  trials: number
  /** How often the hero won at least part of the pot. */
  winRate: number
  /** How often the pot was chopped. */
  tieRate: number
  /** Average net chips across every runout. */
  expected: number
  /** Net chips in the hand that was actually played. */
  actual: number
  /**
   * Share of runouts that finished worse than the real one, so a low number
   * means the deck was unkind rather than the line being bad.
   */
  actualPercentile: number
  /** Board cards that were already out and stayed fixed. */
  fixedBoard: number
  /** True when the hero folded and this is a counterfactual showdown. */
  counterfactual: boolean
  /** Net chips from every runout, ascending. */
  nets: number[]
}

/**
 * Re-deal the board from `fromBoardSize` onwards and settle the hand again.
 *
 * A hero who folded never reached the showdown, so their result cannot vary
 * with the cards. For those hands the pot is settled as if they had been there
 * to contest it — clearly a counterfactual, flagged as one, and never fed back
 * into a grade. What it can honestly answer is whether the hand was worth
 * continuing with, which is exactly the question a player asks after folding.
 */
export function runItAgain(
  state: HandState,
  heroSeat: number,
  fromBoardSize = 0,
  trials = 1_000,
  seed = 0x5a17,
): RunItAgainResult {
  const result = state.result
  if (result === null) throw new Error('Hand is not complete')

  const hero = state.seats[heroSeat]
  if (!hero?.holeCards) throw new Error('Hero has no cards')

  const counterfactual = hero.status === 'folded'
  // Contested seats: everyone who reached the showdown, plus the hero when
  // asking what folding cost.
  const contenders = state.seats.filter(
    (seat) => seat.status !== 'folded' || (counterfactual && seat.index === heroSeat),
  )
  if (contenders.length < 2) {
    return {
      trials: 0,
      winRate: 1,
      tieRate: 0,
      expected: result.net[heroSeat]!,
      actual: result.net[heroSeat]!,
      actualPercentile: 0.5,
      fixedBoard: state.board.length,
      counterfactual,
      nets: [],
    }
  }

  const fixed = Math.min(fromBoardSize, state.board.length)
  const known = new Set<Card>([
    ...contenders.flatMap((seat) => [...seat.holeCards!]),
    ...state.board.slice(0, fixed),
  ])
  const deck: Card[] = []
  for (let card = 0; card < NUM_CARDS; card++) if (!known.has(card)) deck.push(card)

  const needed = 5 - fixed
  const board: Card[] = [...state.board.slice(0, fixed), ...new Array<Card>(needed)]
  const handValues: (number | null)[] = state.seats.map(() => null)
  const scratch: Card[] = new Array(7)
  const rng = new Rng(seed)

  // Pots are built from what everyone actually put in; only the winner changes.
  const pots = buildPots(state).map((pot) => ({
    ...pot,
    eligible: counterfactual
      ? [...new Set([...pot.eligible, heroSeat])].sort((a, b) => a - b)
      : pot.eligible,
  }))

  const nets: number[] = []
  let wins = 0
  let ties = 0
  let total = 0

  for (let trial = 0; trial < trials; trial++) {
    for (let i = 0; i < needed; i++) {
      const j = i + rng.nextInt(deck.length - i)
      const tmp = deck[i]!
      deck[i] = deck[j]!
      deck[j] = tmp
      board[fixed + i] = deck[i]!
    }

    for (const seat of contenders) {
      scratch[0] = seat.holeCards![0]
      scratch[1] = seat.holeCards![1]
      for (let i = 0; i < 5; i++) scratch[i + 2] = board[i]!
      handValues[seat.index] = evaluate(scratch)
    }

    const winnings = awardPots(
      pots.map((pot) => ({ ...pot, winners: [] })),
      handValues,
      state.buttonSeat,
      state.seats.length,
    )
    const net = winnings[heroSeat]! - state.seats[heroSeat]!.totalCommitted
    nets.push(net)
    total += net

    const best = Math.max(...contenders.map((seat) => handValues[seat.index] ?? -1))
    const mine = handValues[heroSeat] ?? -1
    if (mine === best) {
      const sharing = contenders.filter((seat) => handValues[seat.index] === best).length
      if (sharing > 1) ties++
      else wins++
    }
  }

  const actual = result.net[heroSeat]!
  const worse = nets.filter((net) => net < actual).length

  return {
    trials,
    winRate: wins / trials,
    tieRate: ties / trials,
    expected: total / trials,
    actual,
    actualPercentile: worse / trials,
    fixedBoard: fixed,
    counterfactual,
    nets: [...nets].sort((a, b) => a - b),
  }
}

export interface Outcome {
  /** Net chips this outcome pays. */
  net: number
  count: number
  probability: number
}

/**
 * The distinct results the hand can produce, with how often each happens.
 *
 * A histogram is the wrong shape here. With the betting fixed, re-dealing the
 * board does not spread results smoothly — it picks between a handful of
 * definite outcomes: win the pot, lose what went in, or chop. Bucketing that
 * into a continuous range leaves most of the chart empty and hides the very
 * thing worth seeing, which is how the few real possibilities divide up.
 */
export function outcomes(nets: readonly number[]): Outcome[] {
  if (nets.length === 0) return []
  const counts = new Map<number, number>()
  for (const net of nets) counts.set(net, (counts.get(net) ?? 0) + 1)

  return [...counts.entries()]
    .map(([net, count]) => ({ net, count, probability: count / nets.length }))
    .sort((a, b) => a.net - b.net)
}
