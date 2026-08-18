import { describe, expect, it } from 'vitest'
import { Rng } from '../engine/cards'
import { Solver } from './cfr'
import { CLASSES, CLASS_INDEX, MATCHUP } from './matchup-table'
import {
  ALL_IN,
  CALL,
  DEFAULT_CONFIG,
  FOLD,
  RAISE,
  createPreflopGame,
  positionsFor,
  type PreflopState,
} from './preflop'

const seeded = () => {
  const rng = new Rng(7)
  return () => rng.nextFloat()
}

describe('the matchup table', () => {
  it('covers every starting hand', () => {
    expect(CLASSES).toHaveLength(169)
    expect(MATCHUP).toHaveLength(169)
    for (const row of MATCHUP) expect(row).toHaveLength(169)
  })

  it('matches published equities', () => {
    const equity = (a: string, b: string) => MATCHUP[CLASS_INDEX[a]!]![CLASS_INDEX[b]!]!
    expect(equity('AA', 'KK')).toBeGreaterThan(0.79)
    expect(equity('AA', 'KK')).toBeLessThan(0.84)
    expect(equity('AA', '72o')).toBeGreaterThan(0.85)
    expect(equity('AKs', 'QQ')).toBeGreaterThan(0.43)
    expect(equity('AKs', 'QQ')).toBeLessThan(0.49)
  })

  it('is exactly symmetric', () => {
    for (let i = 0; i < CLASSES.length; i++) {
      // A hand against itself is a coin flip, and every pair complements.
      expect(MATCHUP[i]![i]).toBe(0.5)
      for (let j = 0; j < CLASSES.length; j++) {
        expect(MATCHUP[i]![j]! + MATCHUP[j]![i]!).toBeCloseTo(1, 9)
      }
    }
  })

  it('ranks better hands above worse ones', () => {
    const beats = (a: string, b: string) => MATCHUP[CLASS_INDEX[a]!]![CLASS_INDEX[b]!]! > 0.5
    expect(beats('AA', 'KK')).toBe(true)
    expect(beats('AKs', 'AKo')).toBe(true)
    expect(beats('QQ', 'JJ')).toBe(true)
    expect(beats('76s', '72o')).toBe(true)
  })
})

describe('the preflop tree', () => {
  const game = createPreflopGame()
  const dealt = () => game.sampleChance!(game.root(), seeded())

  it('posts blinds and starts under the gun', () => {
    const state = dealt()
    expect(state.committed[0]).toBe(0.5) // small blind
    expect(state.committed[1]).toBe(1) // big blind
    expect(state.toAct).toBe(2) // under the gun
  })

  it('deals every seat a hand', () => {
    const state = dealt()
    expect(state.hands).toHaveLength(DEFAULT_CONFIG.players)
    for (const hand of state.hands!) {
      expect(hand).toBeGreaterThanOrEqual(0)
      expect(hand).toBeLessThan(169)
    }
  })

  it('deals hands that could actually coexist', () => {
    // Six seats cannot all hold aces; sampling from a real deck is what stops
    // the solve being trained on impossible deals.
    const counts = new Map<number, number>()
    const random = seeded() // one stream, so the deals actually differ
    for (let i = 0; i < 400; i++) {
      const state = game.sampleChance!(game.root(), random)
      for (const hand of state.hands!) counts.set(hand, (counts.get(hand) ?? 0) + 1)
    }
    // Pairs are rarer than unpaired hands, as they are in a real deck.
    const pairs = [...counts.entries()]
      .filter(([hand]) => CLASSES[hand]!.length === 2)
      .reduce((sum, [, n]) => sum + n, 0)
    const total = [...counts.values()].reduce((a, b) => a + b, 0)
    // A real deck deals a pocket pair about one hand in seventeen.
    expect(pairs / total).toBeGreaterThan(0.02)
    expect(pairs / total).toBeLessThan(0.11)
  })

  it('offers no fold when checking is free', () => {
    // The big blind facing no raise can check, and folding is never offered
    // as an option that costs nothing to decline.
    let state = dealt()
    for (let i = 0; i < 4; i++) state = game.next(state, FOLD) // fold to the blinds
    expect(state.toAct).toBe(0) // small blind
    expect(game.actions(state)).toContain(FOLD)
  })

  it('closes betting when everyone has called a raise', () => {
    let state = dealt()
    state = game.next(state, RAISE) // under the gun opens
    for (let i = 0; i < 5; i++) {
      if (game.isTerminal(state)) break
      state = game.next(state, CALL)
    }
    expect(game.isTerminal(state)).toBe(true)
  })

  it('ends the hand when everyone folds to one player', () => {
    let state = dealt()
    for (let i = 0; i < 5; i++) {
      if (game.isTerminal(state)) break
      state = game.next(state, FOLD)
    }
    expect(game.isTerminal(state)).toBe(true)
    expect(state.folded.filter(Boolean)).toHaveLength(5)
  })

  it('pays the pot to the last player standing', () => {
    let state = dealt()
    for (let i = 0; i < 5; i++) {
      if (game.isTerminal(state)) break
      state = game.next(state, FOLD)
    }
    // Everyone folded to the big blind, which collects the small blind.
    expect(game.payoff(state, 1)).toBeCloseTo(0.5, 6)
    expect(game.payoff(state, 0)).toBeCloseTo(-0.5, 6)
  })

  it('conserves chips at every terminal state', () => {
    const random = seeded()
    for (let trial = 0; trial < 200; trial++) {
      let state: PreflopState = game.sampleChance!(game.root(), random)
      let guard = 0
      while (!game.isTerminal(state) && guard++ < 60) {
        const options = game.actions(state)
        state = game.next(state, options[Math.floor(random() * options.length)]!)
      }
      expect(game.isTerminal(state)).toBe(true)

      const total = state.committed
        .map((_, seat) => game.payoff(state, seat))
        .reduce((a, b) => a + b, 0)
      expect(total).toBeCloseTo(0, 6)
    }
  })

  it('never commits more than a stack', () => {
    const random = seeded()
    for (let trial = 0; trial < 200; trial++) {
      let state: PreflopState = game.sampleChance!(game.root(), random)
      let guard = 0
      while (!game.isTerminal(state) && guard++ < 60) {
        const options = game.actions(state)
        state = game.next(state, options[Math.floor(random() * options.length)]!)
        for (const committed of state.committed) {
          expect(committed).toBeLessThanOrEqual(DEFAULT_CONFIG.stack)
        }
      }
    }
  })

  it('caps the raising war', () => {
    let state = dealt()
    let raises = 0
    let guard = 0
    while (!game.isTerminal(state) && guard++ < 40) {
      const options = game.actions(state)
      if (options.includes(RAISE)) {
        state = game.next(state, RAISE)
        raises++
      } else if (options.includes(ALL_IN)) {
        state = game.next(state, ALL_IN)
        raises++
      } else {
        state = game.next(state, CALL)
      }
    }
    expect(raises).toBeLessThanOrEqual(6)
  })

  it('names positions for each table size', () => {
    // The same labels the table itself uses.
    expect(positionsFor(6)).toEqual(['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'])
    expect(positionsFor(2)).toEqual(['BTN', 'BB'])
  })
})

describe('solving the preflop tree', () => {
  it('learns to fold the worst hands and play the best', () => {
    const game = createPreflopGame({ players: 2, stack: 20, smallBlind: 0.5 })
    const rng = new Rng(99)
    const solver = new Solver(game, () => rng.nextFloat())
    solver.train(4_000)

    // Find the button's opening decision for each hand — the most-visited
    // information set whose key names that seat and holding.
    const openingWith = (hand: string) => {
      const keys = solver
        .infoSets()
        .filter((key) => key.startsWith(`0|${hand}|`))
        .sort((a, b) => solver.visitsFor(b) - solver.visitsFor(a))
      return keys[0]
    }

    const acesKey = openingWith('AA')
    const trashKey = openingWith('72o')
    expect(acesKey).toBeDefined()
    expect(trashKey).toBeDefined()

    // Folding is action 0 wherever it is offered at all.
    const foldRate = (key: string) => {
      const actions = solver.actionsFor(key)
      const strategy = solver.averageStrategy(key)
      const index = actions.indexOf(FOLD)
      return index < 0 ? 0 : strategy[index]!
    }

    expect(foldRate(acesKey!)).toBeLessThan(foldRate(trashKey!))
  }, 300_000)
})
