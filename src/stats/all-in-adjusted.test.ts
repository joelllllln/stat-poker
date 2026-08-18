import { describe, expect, it } from 'vitest'
import { freshDeck, parseCards, type Card } from '../engine/cards'
import { applyAction, startHandWithDeck } from '../engine/hand'
import type { Action, HandState } from '../engine/types'
import { allInAdjusted, luckCurve } from './all-in-adjusted'

function playOut(stacks: number[], holeCards: string[], board: string, actions: Action[]): HandState {
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

describe('all-in adjustment', () => {
  it('leaves a hand alone when there was no runout to come', () => {
    // Everyone folds preflop: nothing was left to chance.
    const state = playOut([200, 200], ['As Ks', '2h 3d'], 'Qs Js Ts 4c 5d', [{ type: 'fold' }])
    const result = allInAdjusted(state)

    expect(result.wasAllIn).toBe(false)
    expect(result.adjusted).toEqual(result.actual)
    expect(result.runouts).toBe(0)
  })

  it('prices a preflop all-in by every possible board', () => {
    // Aces against kings, all-in preflop. Whatever this one board did, the
    // adjusted result must reflect the roughly 82% the hand was worth.
    const state = playOut([200, 200], ['Ah As', 'Kh Ks'], '2c 7d 9h Jc 3s', [
      { type: 'raise', to: 200 },
      { type: 'call' },
    ])
    const result = allInAdjusted(state)

    expect(result.wasAllIn).toBe(true)
    // Too many completions to enumerate, so these are sampled.
    expect(result.runouts).toBeGreaterThan(1_000)

    // Aces win 200 about 82% of the time and lose 200 the rest, so the hand is
    // worth roughly +128 chips regardless of what fell.
    expect(result.adjusted[0]!).toBeGreaterThan(115)
    expect(result.adjusted[0]!).toBeLessThan(145)
    expect(result.adjusted[0]! + result.adjusted[1]!).toBeCloseTo(0, 6)
  }, 120_000)

  it('differs from the actual result when the underdog got there', () => {
    // Kings win this particular board, but were not worth winning it.
    const state = playOut([200, 200], ['Ah As', 'Kh Ks'], 'Kc 7d 9h Jc 3s', [
      { type: 'raise', to: 200 },
      { type: 'call' },
    ])
    const result = allInAdjusted(state)

    expect(result.actual[1]).toBe(200) // kings won the pot
    expect(result.adjusted[1]!).toBeLessThan(0) // and should not have
  }, 120_000)

  it('adjusts a river all-in to exactly the actual result', () => {
    // All five cards are already out, so there is nothing left to average.
    const state = playOut([200, 200], ['As Ks', '2h 3d'], 'Qs Js Ts 4c 5d', [
      { type: 'call' },
      { type: 'check' },
      { type: 'check' },
      { type: 'check' },
      { type: 'check' },
      { type: 'check' },
      { type: 'raise', to: 198 },
      { type: 'call' },
    ])
    const result = allInAdjusted(state)

    expect(result.wasAllIn).toBe(false)
    expect(result.adjusted).toEqual(result.actual)
  })

  it('conserves chips across the adjustment', () => {
    const state = playOut([200, 100], ['Ah As', 'Kh Ks'], '2c 7d 9h Jc 3s', [
      { type: 'raise', to: 100 },
      { type: 'call' },
    ])
    const result = allInAdjusted(state)
    const total = result.adjusted.reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(0, 6)
  }, 120_000)
})

describe('luck curve', () => {
  it('tracks actual against adjusted and reports the gap', () => {
    const lucky = playOut([200, 200], ['Kh Ks', 'Ah As'], 'Kc 7d 9h Jc 3s', [
      { type: 'raise', to: 200 },
      { type: 'call' },
    ])
    const curve = luckCurve([{ state: lucky, bigBlind: 2 }], 0)

    expect(curve.allInHands).toBe(1)
    expect(curve.actual).toHaveLength(1)
    // Won a pot the hand was not worth, so actual runs ahead of adjusted.
    expect(curve.actual[0]!).toBeGreaterThan(curve.adjusted[0]!)
    expect(curve.luckBB).toBeGreaterThan(0)
  }, 120_000)

  it('leaves the lines together when nothing went all-in', () => {
    const folded = playOut([200, 200], ['As Ks', '2h 3d'], 'Qs Js Ts 4c 5d', [{ type: 'fold' }])
    const curve = luckCurve([{ state: folded, bigBlind: 2 }], 0)

    expect(curve.allInHands).toBe(0)
    expect(curve.luckBB).toBeCloseTo(0, 6)
    expect(curve.actual).toEqual(curve.adjusted)
  })
})
