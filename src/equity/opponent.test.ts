import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from '../bots/archetypes'
import { decide } from '../bots/policy'
import { NUM_CARDS, Rng, type Card } from '../engine/cards'
import { applyAction, legalActions, startHand } from '../engine/hand'
import type { HandState } from '../engine/types'
import { modelledWidth } from './opponent'
import { preflopStrength } from './preflop'

/**
 * The range a seat is put on has to hold the hands it is really holding.
 *
 * Every equity the app shows, every price the coach quotes and every bot
 * decision runs through one estimate: this seat holds a hand in the top w% of
 * starting hands. Nothing used to check it against the cards those seats
 * really had, and replaying a few hundred hands showed what that cost — a
 * maniac's raise was put on the top 15% when it meant the top 47%, and two
 * thirds of the hands it held were not inside the range it had been given.
 *
 * These tests hold it to both directions, which is what makes it a claim
 * rather than a number. A range that does not contain what the seat does is
 * wrong; a range far wider than what the seat does is useless.
 */

/** Every distinct two-card holding. */
function everyHolding(): [Card, Card][] {
  const holdings: [Card, Card][] = []
  for (let a = 0; a < NUM_CARDS; a++) {
    for (let b = a + 1; b < NUM_CARDS; b++) holdings.push([a as Card, b as Card])
  }
  return holdings
}

/** A fresh six-handed preflop hand where every seat plays the given way. */
function table(style: string, seed: number): HandState {
  return startHand(
    {
      seats: Array.from({ length: 6 }, (_, i) => ({ name: `Seat ${i}`, style, stack: 200 })),
      buttonSeat: 0,
      smallBlind: 1,
      bigBlind: 2,
    },
    new Rng(seed),
  )
}

/** Deal `holding` to the seat on the clock without disturbing anything else. */
const holding = (state: HandState, seat: number, cards: [Card, Card]): HandState => ({
  ...state,
  seats: state.seats.map((s) => (s.index === seat ? { ...s, holeCards: cards } : { ...s })),
})

describe('the range an opening raise is read as', () => {
  it('contains every hand the seat opens with, for every archetype', () => {
    for (const style of Object.values(ARCHETYPES)) {
      const start = table(style.id, 4)
      const seat = start.toAct!
      let opened = 0
      let widest = 0

      for (const cards of everyHolding()) {
        const dealt = holding(start, seat, cards)
        const action = decide(dealt, seat, style, new Rng(9))
        if (action.type !== 'raise') continue

        opened += 1
        const after = applyAction(dealt, action)
        const width = modelledWidth(after, seat)
        widest = Math.max(widest, width)
        // The hand it is holding has to be inside the range it is put on.
        expect(
          preflopStrength(cards).percentile,
          `${style.id} opened ${preflopStrength(cards).hand} and was put on the top ${(width * 100).toFixed(0)}%`,
        ).toBeGreaterThanOrEqual(1 - width)
      }

      // And the range must not be much wider than what it actually opens, or
      // it would contain everything and say nothing.
      const empirical = opened / 1326
      expect(opened, `${style.id} opened nothing`).toBeGreaterThan(0)
      expect(widest, `${style.id} is read far wider than it plays`).toBeLessThan(empirical + 0.06)
    }
  })
})

describe('the range a seat that has not acted is read as', () => {
  it('is everything, because it has done nothing', () => {
    const start = table('nit', 4)
    const waiting = start.seats.find(
      (seat) => seat.index !== start.toAct && start.actions.length === 0,
    )!
    expect(modelledWidth(start, waiting.index)).toBe(1)
  })
})

describe('a seat doing what its style says it never does', () => {
  it('is read by the general rule rather than by the style', () => {
    // The rock's limping width is zero: it does not limp. Reading that as "it
    // limped, so it holds the top nothing per cent" would put it on the very
    // best hands for making the loosest play in its repertoire.
    const start = table('nit', 4)
    const seat = start.toAct!
    const call = legalActions(start).find((option) => option.type === 'call')!
    expect(call).toBeDefined()
    const limped = applyAction(start, { type: 'call' })

    const width = modelledWidth(limped, seat)
    expect(ARCHETYPES['nit']!.limpWidth).toBe(0)
    expect(width).toBeGreaterThan(0.2)
  })
})

describe('the range a seat that keeps raising is read as', () => {
  /**
   * A seat that opened, got reraised, and is now on the clock again.
   *
   * Two raises from the same seat is the spot the reading has to get right,
   * and it is the spot it used to get most wrong.
   */
  function afterBeingReraised(style: string, seed: number): { state: HandState; seat: number } {
    const start = table(style, seed)
    const seat = start.toAct!
    const open = legalActions(start).find((option) => option.type === 'raise')!
    let live = applyAction(start, { type: 'raise', to: open.min! })

    const threeBet = legalActions(live).find((option) => option.type === 'raise')!
    live = applyAction(live, { type: 'raise', to: threeBet.min! })

    // Everybody else out of the way, so the action comes back to the opener.
    let guard = 0
    while (live.toAct !== seat && live.result === null && guard++ < 8) {
      live = applyAction(live, { type: 'fold' })
    }
    return { state: live, seat }
  }

  it('reads a four-bet as a four-bet, not as the range it opened with', () => {
    for (const style of Object.values(ARCHETYPES)) {
      const { state: start, seat } = afterBeingReraised(style.id, 6)
      expect(start.toAct).toBe(seat)
      const opened = start.actions.filter(
        (entry) => entry.seat === seat && entry.action.type === 'raise',
      )
      expect(opened).toHaveLength(1)

      let fourBet = 0
      let widest = 0
      for (const cards of everyHolding()) {
        const dealt = holding(start, seat, cards)
        const action = decide(dealt, seat, style, new Rng(3))
        if (action.type !== 'raise') continue

        fourBet += 1
        const after = applyAction(dealt, action)
        const width = modelledWidth(after, seat)
        widest = Math.max(widest, width)
        expect(
          preflopStrength(cards).percentile,
          `${style.id} four-bet ${preflopStrength(cards).hand} and was put on the top ${(width * 100).toFixed(0)}%`,
        ).toBeGreaterThanOrEqual(1 - width)
      }

      if (fourBet === 0) continue
      // Every action is taken knowing everything before it, so the latest one
      // is the most informative. Reading these by the open put a four-bettor
      // on the top 39% of hands while it was holding the top 20%, and had the
      // model expecting it to fold six times in ten where it folded fewer than
      // two.
      expect(widest, `${style.id} still reads as its opening range`).toBeLessThan(
        style.openWidth / 2,
      )
      expect(widest).toBeLessThan(fourBet / 1326 + 0.06)
    }
  })
})
