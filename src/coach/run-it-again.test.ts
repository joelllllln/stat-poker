import { describe, expect, it } from 'vitest'
import { freshDeck, parseCards, type Card } from '../engine/cards'
import { applyAction, startHandWithDeck } from '../engine/hand'
import type { Action, HandState } from '../engine/types'
import { outcomes, runItAgain } from './run-it-again'

function playOut(
  stacks: number[],
  holeCards: string[],
  board: string,
  actions: Action[],
): HandState {
  const chosen = [...holeCards.flatMap((h) => parseCards(h)), ...parseCards(board)]
  const deck: Card[] = [...chosen, ...freshDeck().filter((c) => !chosen.includes(c))]
  let state = startHandWithDeck(
    {
      seats: stacks.map((stack, i) => ({ name: `P${i}`, stack })),
      buttonSeat: 0,
      smallBlind: 1,
      bigBlind: 2,
    },
    deck,
  )
  for (const action of actions) state = applyAction(state, action)
  return state
}

/** Aces against kings, all-in preflop, kings hitting a king on the flop. */
const acesLoseToKings = () =>
  playOut([200, 200], ['Ah As', 'Kh Ks'], 'Kc 7d 9h Jc 3s', [
    { type: 'raise', to: 200 },
    { type: 'call' },
  ])

describe('running the hand again', () => {
  it('shows a hand that lost was worth winning', () => {
    // The classic bad beat: aces in, kings out in front. Re-dealing the board
    // should show the hand winning about four times in five.
    const run = runItAgain(acesLoseToKings(), 0, 0, 3_000)

    expect(run.winRate).toBeGreaterThan(0.75)
    expect(run.winRate).toBeLessThan(0.9)
    expect(run.expected).toBeGreaterThan(0)
    expect(run.actual).toBe(-200) // what actually happened
  })

  it('places the real result in the distribution', () => {
    const run = runItAgain(acesLoseToKings(), 0, 0, 3_000)
    // Losing was one of the worse outcomes available, so almost nothing
    // finished below it.
    expect(run.actualPercentile).toBeLessThan(0.25)
  })

  it('holds the board it is told to hold', () => {
    // From the flop onwards only the turn and river change, so the king that
    // already flopped stays on the board and the aces do much worse.
    const fromFlop = runItAgain(acesLoseToKings(), 0, 3, 3_000)
    const fromPreflop = runItAgain(acesLoseToKings(), 0, 0, 3_000)

    expect(fromFlop.fixedBoard).toBe(3)
    expect(fromFlop.winRate).toBeLessThan(fromPreflop.winRate)
    expect(fromFlop.winRate).toBeLessThan(0.2)
  })

  it('is deterministic', () => {
    const a = runItAgain(acesLoseToKings(), 0, 0, 500)
    const b = runItAgain(acesLoseToKings(), 0, 0, 500)
    expect(a.winRate).toBe(b.winRate)
    expect(a.expected).toBe(b.expected)
  })

  it('conserves chips in every runout', () => {
    const run = runItAgain(acesLoseToKings(), 0, 0, 200)
    const villain = runItAgain(acesLoseToKings(), 1, 0, 200)
    // Two players, one pot: whatever one wins the other loses.
    expect(run.expected + villain.expected).toBeCloseTo(0, 6)
  })

  it('never reports a result outside what the pot could pay', () => {
    const run = runItAgain(acesLoseToKings(), 0, 0, 500)
    for (const net of run.nets) {
      expect(net).toBeGreaterThanOrEqual(-200)
      expect(net).toBeLessThanOrEqual(200)
    }
  })

  it('marks a folded hand as a counterfactual', () => {
    // The hero folds the best hand; the question is what folding cost, which
    // is a hypothetical rather than a replay.
    const folded = playOut([200, 200], ['Ah As', 'Kh Ks'], '2c 7d 9h Jc 3s', [
      { type: 'raise', to: 6 },
      { type: 'raise', to: 20 },
      { type: 'fold' },
    ])
    const run = runItAgain(folded, 0, 0, 1_000)

    expect(run.counterfactual).toBe(true)
    // Aces would have won most of the time it went to showdown.
    expect(run.winRate).toBeGreaterThan(0.7)
  })

  it('says nothing useful when there was never a contest', () => {
    // Everyone folded preflop: no runout could have changed anything.
    const walkover = playOut([200, 200], ['Ah As', 'Kh Ks'], '2c 7d 9h Jc 3s', [
      { type: 'fold' },
    ])
    const run = runItAgain(walkover, 1, 0, 100)
    expect(run.trials).toBe(0)
    expect(run.expected).toBe(run.actual)
  })
})

describe('the spread', () => {
  it('reduces to the handful of results the hand can actually pay', () => {
    // Heads-up all-in: win the pot or lose the stack, and nothing between.
    const run = runItAgain(acesLoseToKings(), 0, 0, 2_000)
    const spread = outcomes(run.nets)

    expect(spread.length).toBeLessThanOrEqual(3)
    expect(spread.reduce((sum, o) => sum + o.count, 0)).toBe(run.nets.length)
    expect(spread.reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1, 6)
  })

  it('orders outcomes from worst to best', () => {
    const spread = outcomes(runItAgain(acesLoseToKings(), 0, 0, 500).nets)
    for (let i = 1; i < spread.length; i++) {
      expect(spread[i]!.net).toBeGreaterThan(spread[i - 1]!.net)
    }
  })

  it('is empty when there is nothing to draw', () => {
    expect(outcomes([])).toEqual([])
  })

  it('collapses a hand that always pays the same into one outcome', () => {
    expect(outcomes([5, 5, 5, 5])).toEqual([{ net: 5, count: 4, probability: 1 }])
  })
})
