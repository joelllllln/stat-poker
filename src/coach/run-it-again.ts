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
 * What each seat had put in before any uncalled bet was handed back.
 *
 * Settling a hand returns the part of a bet nobody matched, so the totals left
 * behind are not the amounts that were actually wagered. Asking what would
 * have happened had somebody called needs the wagered amounts, and they are
 * recoverable exactly: what a seat posted, plus what every action of theirs
 * cost.
 */
function grossCommitments(state: HandState): number[] {
  const result = state.result!
  const n = state.seats.length
  const sbSeat = n === 2 ? state.buttonSeat : (state.buttonSeat + 1) % n
  const bbSeat = n === 2 ? (state.buttonSeat + 1) % n : (state.buttonSeat + 2) % n

  const gross = state.seats.map((seat, index) => {
    const blind = index === sbSeat ? state.smallBlind : index === bbSeat ? state.bigBlind : 0
    // A seat cannot have posted more than it sat down with.
    const startingStack = seat.stack - result.net[index]!
    return Math.min(blind, startingStack)
  })
  for (const action of state.actions) gross[action.seat]! += action.cost
  return gross
}

/**
 * Re-deal the board from `fromBoardSize` onwards and settle the hand again.
 *
 * The default is the point at which the betting ended, because that is exactly
 * the stretch of board over which "nobody would have acted differently" is a
 * true statement rather than a convenient one. Dealing from earlier is a
 * different and more hypothetical question — it re-runs a flop the betting
 * responded to — and is offered, but only when it is asked for.
 *
 * A hero who folded never reached the showdown, so their result cannot vary
 * with the cards. For those hands the question is what calling would have been
 * worth, and it is priced as a call: the hero pays what the fold was facing,
 * that payment is matched by whoever was betting into them, and they are
 * eligible for exactly the pot those chips reach. Clearly a counterfactual,
 * flagged as one, and never fed back into a grade — but a counterfactual with
 * the price of admission in it, rather than a free pot.
 */
export function runItAgain(
  state: HandState,
  heroSeat: number,
  fromBoardSize?: number,
  trials = 1_000,
  seed = 0x5a17,
): RunItAgainResult {
  const result = state.result
  if (result === null) throw new Error('Hand is not complete')

  const hero = state.seats[heroSeat]
  if (!hero?.holeCards) throw new Error('Hero has no cards')

  const from = fromBoardSize ?? result.runoutFrom
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

  const fixed = Math.min(from, state.board.length)
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
  //
  // Except where the hero folded, in which case they are rebuilt as though the
  // hero had called: the hero pays what the fold was facing, and every other
  // seat's wager counts up to what the hero matched — no further, since chips
  // beyond that would have come back to whoever bet them.
  const heroFold = state.actions.find(
    (entry) => entry.seat === heroSeat && entry.action.type === 'fold',
  )
  const cost = counterfactual ? Math.min(heroFold?.toCall ?? 0, hero.stack) : 0
  const heroTotal = hero.totalCommitted + cost

  const pots = counterfactual
    ? buildPots({
        ...state,
        seats: state.seats.map((seat, index) =>
          index === heroSeat
            ? { ...seat, status: 'active', totalCommitted: heroTotal }
            : { ...seat, totalCommitted: Math.min(grossCommitments(state)[index]!, heroTotal) },
        ),
      })
    : buildPots(state)

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
    const net = winnings[heroSeat]! - heroTotal
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
