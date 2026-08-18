import { describe, expect, it } from 'vitest'
import { freshDeck, parseCards, Rng, type Card } from '../engine/cards'
import { applyAction, startHand, startHandWithDeck } from '../engine/hand'
import type { Action, HandState } from '../engine/types'
import { BLUEPRINT, BLUEPRINT_EXPLOITABILITY } from './blueprint-table'
import { blueprintSize, classOf, lookupPreflop, toHeadsUpState } from './blueprint'
import { FOLD, RAISE } from './preflop'

/** A six-handed table, optionally with known hole cards dealt in seat order. */
const sixMax = (stack = 200, holeCards?: string[]): HandState => {
  const config = {
    seats: Array.from({ length: 6 }, (_, i) => ({ name: `P${i}`, stack })),
    buttonSeat: 0,
    smallBlind: 1,
    bigBlind: 2,
  }
  if (!holeCards) return startHand(config, new Rng(5))
  const chosen = holeCards.flatMap((h) => parseCards(h))
  const deck: Card[] = [...chosen, ...freshDeck().filter((c) => !chosen.includes(c))]
  return startHandWithDeck(config, deck)
}

const play = (state: HandState, actions: Action[]): HandState =>
  actions.reduce((s, action) => applyAction(s, action), state)

const fold: Action = { type: 'fold' }
const call: Action = { type: 'call' }

/**
 * Everyone folds to the blinds. With the button in seat 0 the small blind is
 * seat 1, so four folds leave exactly the two blinds and no dead money — the
 * heads-up game the blueprint was solved for.
 */
const foldedToTheBlinds = (stack = 200, holeCards?: string[]): HandState =>
  play(sixMax(stack, holeCards), [fold, fold, fold, fold])

describe('hand classes', () => {
  it('labels holdings the way ranges are written', () => {
    expect(classOf(parseCards('As Ks') as [Card, Card])).toBe('AKs')
    expect(classOf(parseCards('As Kd') as [Card, Card])).toBe('AKo')
    expect(classOf(parseCards('7h 7c') as [Card, Card])).toBe('77')
    expect(classOf(parseCards('2c 7d') as [Card, Card])).toBe('72o')
  })
})

describe('recognising the solved game inside a six-handed hand', () => {
  it('translates a pot folded to the blinds', () => {
    const state = foldedToTheBlinds()
    expect(state.toAct).toBe(1) // the small blind

    const translated = toHeadsUpState(state, state.toAct!)
    expect(translated).not.toBeNull()
    // Seat 0 of the solve is always the small blind, whatever seat it sat in.
    expect(translated!.toAct).toBe(0)
    expect(translated!.committed[0]).toBeCloseTo(0.5, 6)
    expect(translated!.committed[1]).toBeCloseTo(1, 6)
  })

  it('measures the pot in big blinds, not chips', () => {
    const translated = toHeadsUpState(foldedToTheBlinds(), 1)!
    expect(translated.currentBet).toBe(1)
  })

  it('follows the action to the big blind', () => {
    const raised = applyAction(foldedToTheBlinds(), { type: 'raise', to: 5 })
    const translated = toHeadsUpState(raised, raised.toAct!)!
    expect(translated.toAct).toBe(1) // the big blind now decides
    expect(translated.raiseCount).toBe(1)
    expect(translated.currentBet).toBe(2.5)
  })

  it('translates a genuine heads-up table too', () => {
    const headsUp = startHand(
      {
        seats: [
          { name: 'A', stack: 200 },
          { name: 'B', stack: 200 },
        ],
        buttonSeat: 0,
        smallBlind: 1,
        bigBlind: 2,
      },
      new Rng(1),
    )
    expect(toHeadsUpState(headsUp, headsUp.toAct!)).not.toBeNull()
  })

  it('refuses a spot with more than two players left', () => {
    // Fresh six-handed hand: four players still to act is not the solved game.
    const state = sixMax()
    expect(toHeadsUpState(state, state.toAct!)).toBeNull()
  })

  it('refuses a pot carrying dead money', () => {
    // Under the gun limps and later folds, leaving chips behind. Two players
    // remain, but the pot is bigger than the one that was solved and every
    // price in it is different.
    const state = play(sixMax(), [
      call, // under the gun limps
      fold,
      fold,
      fold,
      { type: 'raise', to: 10 }, // small blind raises
      { type: 'raise', to: 30 }, // big blind reraises
      fold, // the limper gives up, leaving its two chips
    ])
    expect(state.seats.filter((s) => s.status !== 'folded')).toHaveLength(2)
    expect(state.street).toBe('preflop')
    expect(toHeadsUpState(state, state.toAct!)).toBeNull()
  })

  it('refuses a stack depth the solve does not cover', () => {
    // Solved at a hundred blinds; twenty blinds is a different game.
    expect(toHeadsUpState(foldedToTheBlinds(40), 1)).toBeNull()
    expect(toHeadsUpState(foldedToTheBlinds(200), 1)).not.toBeNull()
  })

  it('refuses a hand past the flop', () => {
    const flop = play(foldedToTheBlinds(), [call, { type: 'check' }])
    expect(flop.street).toBe('flop')
    expect(toHeadsUpState(flop, flop.toAct!)).toBeNull()
  })

  it('refuses a seat that is not to act', () => {
    const state = foldedToTheBlinds()
    expect(toHeadsUpState(state, 2)).toBeNull()
  })
})

describe('the advice it gives', () => {
  const adviceFor = (holeCards: string[], seat = 1) =>
    lookupPreflop(foldedToTheBlinds(200, holeCards), seat)

  // Seat order is 0..5, so seat 1 (the small blind) is dealt the second pair.
  const smallBlindHolding = (hand: string) => ['2c 3d', hand, '4c 5d', '6c 7d', '8c 9d', 'Tc Jd']

  it('raises aces from the small blind', () => {
    const advice = adviceFor(smallBlindHolding('Ah As'))
    expect(advice).not.toBeNull()
    expect(advice!.primary.action).toBe(RAISE)
    expect(advice!.primary.frequency).toBeGreaterThan(0.9)
  })

  it('folds the worst hand in the deck', () => {
    const advice = adviceFor(smallBlindHolding('7h 2c'))
    expect(advice).not.toBeNull()
    expect(advice!.primary.action).toBe(FOLD)
  })

  it('reports how solved its advice is', () => {
    const advice = adviceFor(smallBlindHolding('Ah As'))!
    expect(advice.exploitability).toBe(BLUEPRINT_EXPLOITABILITY)
    expect(advice.exploitability).toBeLessThan(0.01)
  })

  it('gives frequencies that form a distribution', () => {
    for (const hand of ['Ah As', 'Kh Qs', '9h 9c', '7h 2c', 'Jh Ts']) {
      const advice = adviceFor(smallBlindHolding(hand))
      expect(advice, hand).not.toBeNull()
      const total = advice!.actions.reduce((sum, a) => sum + a.frequency, 0)
      expect(total, hand).toBeGreaterThan(0.98)
      expect(total, hand).toBeLessThan(1.02)
      expect(advice!.actions).toContainEqual(advice!.primary)
    }
  })

  it('never offers calling as an opening action', () => {
    // Limping is outside the solved tree, so it is never advised.
    const advice = adviceFor(smallBlindHolding('Ah As'))!
    expect(advice.actions.map((a) => a.label)).not.toContain('call')
  })

  it('returns nothing for a spot outside the solve', () => {
    const state = sixMax()
    expect(lookupPreflop(state, state.toAct!)).toBeNull()
  })
})

describe('the shipped blueprint', () => {
  const entries = Object.entries(BLUEPRINT)

  it('covers the tree', () => {
    expect(blueprintSize()).toBeGreaterThan(500)
  })

  it('stores a valid distribution for every spot', () => {
    for (const [key, strategy] of entries) {
      const total = strategy.reduce((a, b) => a + b, 0)
      expect(total, key).toBeGreaterThan(0.95)
      expect(total, key).toBeLessThan(1.05)
      for (const frequency of strategy) {
        expect(frequency, key).toBeGreaterThanOrEqual(0)
        expect(frequency, key).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keys every spot by seat, hand, context and legal actions', () => {
    for (const [key, strategy] of entries) {
      const parts = key.split('|')
      expect(parts, key).toHaveLength(4)
      // The action signature must match the number of frequencies stored.
      expect(parts[3]!.length, key).toBe(strategy.length)
      expect(Number(parts[0]), key).toBeLessThan(2) // heads-up: two seats
    }
  })

  it('was solved close enough to equilibrium to be worth quoting', () => {
    expect(BLUEPRINT_EXPLOITABILITY).toBeLessThan(0.001)
    expect(BLUEPRINT_EXPLOITABILITY).toBeGreaterThanOrEqual(0)
  })
})
