import { beforeAll, describe, expect, it } from 'vitest'
import { parseCards, rankOf } from '../engine/cards'
import { HandCategory, categoryOf } from '../engine/evaluator'
import { parseRange } from '../equity/range'
import {
  BET,
  CALL,
  CHECK,
  DEFAULT_POSTFLOP,
  FOLD,
  RiverSolver,
  buildRiverTree,
  holdingsFor,
  showdownValues,
  weightsFor,
  type Holdings,
  type RiverNode,
} from './postflop'

const BOARD = parseCards('As Kd 7c 3h 2s')

/**
 * The definition the fast sweep has to agree with: every holding against every
 * holding, one pair at a time, skipping any that share a card.
 */
function bruteForceShowdown(
  holdings: Holdings,
  opponent: Float64Array,
  pot: number,
  committed: number,
): Float64Array {
  const n = holdings.combos.length
  const out = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    const [a, b] = holdings.combos[i]!
    let value = 0
    for (let j = 0; j < n; j++) {
      const [c, d] = holdings.combos[j]!
      if (a === c || a === d || b === c || b === d) continue
      const weight = opponent[j]!
      if (weight === 0) continue
      const mine = holdings.values[i]!
      const theirs = holdings.values[j]!
      const share = mine > theirs ? pot : mine === theirs ? pot / 2 : 0
      value += weight * (share - committed)
    }
    out[i] = value
  }
  return out
}

describe('holdings on a board', () => {
  const holdings = holdingsFor(BOARD)

  it('leaves every pair of cards the board does not use', () => {
    // Five cards are on the board, so 47 remain: C(47,2) pairs.
    expect(holdings.combos).toHaveLength((47 * 46) / 2)
  })

  it('never deals a card that is already on the board', () => {
    const onBoard = new Set(BOARD)
    for (const [a, b] of holdings.combos) {
      expect(onBoard.has(a)).toBe(false)
      expect(onBoard.has(b)).toBe(false)
    }
  })

  it('scores and sorts every holding', () => {
    expect(holdings.values).toHaveLength(holdings.combos.length)
    for (let i = 1; i < holdings.byStrength.length; i++) {
      const previous = holdings.values[holdings.byStrength[i - 1]!]!
      expect(holdings.values[holdings.byStrength[i]!]!).toBeGreaterThanOrEqual(previous)
    }
  })

  it('knows the nuts on this board', () => {
    // As Kd 7c 3h 2s puts an ace, a deuce and a trey out, so five-four makes
    // the wheel — which beats the set of aces that looks like the best hand.
    const best = holdings.byStrength[holdings.byStrength.length - 1]!
    expect(categoryOf(holdings.values[best]!)).toBe(HandCategory.Straight)

    const ranks = holdings.combos[best]!.map((card) => rankOf(card)).sort((a, b) => a - b)
    expect(ranks).toEqual([rankOf(parseCards('4c')[0]!), rankOf(parseCards('5c')[0]!)])
  })
})

describe('showdown values', () => {
  const holdings = holdingsFor(BOARD)

  const check = (rangeText: string, pot: number, committed: number) => {
    const opponent = weightsFor(holdings, parseRange(rangeText))
    const fast = showdownValues(holdings, opponent, pot, committed)
    const slow = bruteForceShowdown(holdings, opponent, pot, committed)

    let worst = 0
    for (let i = 0; i < fast.length; i++) {
      worst = Math.max(worst, Math.abs(fast[i]! - slow[i]!))
    }
    return worst
  }

  it('matches a hand-by-hand comparison exactly', () => {
    // The sweep is an optimisation of the definition above, so the two must
    // agree to floating-point noise and nothing more.
    expect(check('QQ+, AKs, 76s', 20, 10)).toBeLessThan(1e-9)
  })

  it('matches on a wide range too', () => {
    expect(check('22+, A2s+, K9o+, 54s', 30, 12)).toBeLessThan(1e-9)
  })

  it('matches when the range is the whole deck', () => {
    expect(check('random', 12, 6)).toBeLessThan(1e-9)
  })

  it('handles a range of one hand', () => {
    expect(check('AhAc', 10, 5)).toBeLessThan(1e-9)
  })

  it('gets chopped pots right', () => {
    // Both play the board, so every matchup ties and each holding wins half
    // the pot less what it put in.
    const board = parseCards('As Ks Qs Js Ts')
    const royal = holdingsFor(board)
    const opponent = weightsFor(royal, parseRange('random'))
    const fast = showdownValues(royal, opponent, 20, 5)
    const slow = bruteForceShowdown(royal, opponent, 20, 5)
    for (let i = 0; i < fast.length; i++) expect(fast[i]!).toBeCloseTo(slow[i]!, 9)
  })

  it('accounts for the cards a holding removes', () => {
    // Against a range of exactly one hand, a holding sharing a card with it
    // can never face it, and so has no showdown to value.
    const opponent = weightsFor(holdings, parseRange('AhAc'))
    const values = showdownValues(holdings, opponent, 10, 5)
    const blocking = holdings.combos.findIndex(
      ([a, b]) => a === parseCards('Ah')[0]! || b === parseCards('Ah')[0]!,
    )
    expect(values[blocking]).toBe(0)
  })
})

describe('the river tree', () => {
  const holdings = holdingsFor(BOARD)
  const config = { ...DEFAULT_POSTFLOP, board: BOARD }
  const root = buildRiverTree(config, holdings) as RiverNode

  it('starts with the out-of-position player checking or betting', () => {
    expect(root.kind).toBe('decision')
    expect(root.toAct).toBe(0)
    expect(root.actions).toContain(CHECK)
    expect(root.actions.some((a) => a >= BET && a !== FOLD && a !== CALL)).toBe(true)
    expect(root.actions).not.toContain(FOLD) // nothing to fold to yet
  })

  it('lets the second player fold, call or raise a bet', () => {
    const betIndex = root.actions.findIndex((a) => a >= BET && a !== FOLD && a !== CALL)
    const facing = root.children[betIndex]! as RiverNode

    expect(facing.kind).toBe('decision')
    expect(facing.toAct).toBe(1)
    expect(facing.actions).toContain(FOLD)
    expect(facing.actions).toContain(CALL)
  })

  it('ends the hand when both check', () => {
    const checked = root.children[root.actions.indexOf(CHECK)]! as RiverNode
    const both = checked.children[checked.actions.indexOf(CHECK)]!
    expect(both.kind).toBe('terminal')
  })

  it('caps the raising', () => {
    let node: RiverNode = root
    let depth = 0
    while (depth < 20) {
      const raise = node.actions.findIndex((a) => a >= BET && a !== FOLD && a !== CALL)
      if (raise < 0) break
      const next = node.children[raise]!
      if (next.kind === 'terminal') break
      node = next
      depth++
    }
    expect(depth).toBeLessThanOrEqual(config.maxRaises + 1)
  })

  it('never commits more than a stack', () => {
    const walk = (node: ReturnType<typeof buildRiverTree>) => {
      if (node.kind === 'terminal') {
        for (const committed of node.committed) {
          expect(committed).toBeLessThanOrEqual(config.stack)
        }
        return
      }
      for (const committed of node.committed) {
        expect(committed).toBeLessThanOrEqual(config.stack)
      }
      for (const child of node.children) walk(child)
    }
    walk(root)
  })
})

describe('solving a river', () => {
  let solver: RiverSolver
  let holdings: Holdings

  beforeAll(() => {
    holdings = holdingsFor(BOARD)
    // A polarised bettor against a range of medium-strength hands: the classic
    // river spot, where the answer is a mix rather than a rule.
    const ranges: [Float64Array, Float64Array] = [
      weightsFor(holdings, parseRange('22+, AJs+, KQs, 76s, 54s')),
      weightsFor(holdings, parseRange('88+, AJo+, KQo, ATs+')),
    ]
    solver = new RiverSolver({ ...DEFAULT_POSTFLOP, board: BOARD }, ranges)
    solver.train(150)
  }, 600_000)

  it('converges to a solved river', () => {
    // Chips per hand in a ten-chip pot: a fraction of a percent of the pot is
    // solved for any purpose a player has.
    expect(solver.exploitability()).toBeLessThan(0.05)
    expect(solver.exploitability()).toBeGreaterThanOrEqual(0)
  })

  it('gets closer to equilibrium the longer it runs', () => {
    const brief = new RiverSolver(
      { ...DEFAULT_POSTFLOP, board: BOARD },
      [
        weightsFor(holdings, parseRange('22+, AJs+, KQs, 76s, 54s')),
        weightsFor(holdings, parseRange('88+, AJo+, KQo, ATs+')),
      ],
    )
    brief.train(2)
    expect(solver.exploitability()).toBeLessThan(brief.exploitability())
  }, 600_000)

  it('bets its strongest hands more often than its weakest', () => {
    const root = solver.root as RiverNode
    const bets = root.actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => action >= BET && action !== FOLD && action !== CALL)
    expect(bets.length).toBeGreaterThan(0)

    const range = weightsFor(holdings, parseRange('22+, AJs+, KQs, 76s, 54s'))
    const inRange = [...holdings.byStrength].filter((hand) => range[hand]! > 0)
    const betRate = (hand: number) =>
      bets.reduce((sum, { index }) => sum + solver.strategyFor(root, hand)[index]!, 0)

    const strongest = inRange.slice(-20).reduce((sum, h) => sum + betRate(h), 0) / 20
    const weakest = inRange.slice(0, 20).reduce((sum, h) => sum + betRate(h), 0) / 20
    expect(strongest).toBeGreaterThan(weakest)
  })

  it('gives every holding a distribution at every node', () => {
    for (const node of solver.nodes()) {
      for (let hand = 0; hand < holdings.combos.length; hand += 37) {
        const total = solver.strategyFor(node, hand).reduce((a, b) => a + b, 0)
        expect(total).toBeCloseTo(1, 6)
      }
    }
  })

  it('folds the worst hands to a bet and never folds the best', () => {
    const root = solver.root as RiverNode
    const betIndex = root.actions.findIndex((a) => a >= BET && a !== FOLD && a !== CALL)
    const facing = root.children[betIndex]! as RiverNode
    const foldAt = facing.actions.indexOf(FOLD)

    // Only holdings the responder can actually have are trained; anything
    // outside its range never reaches the node and keeps a uniform strategy.
    const range = weightsFor(holdings, parseRange('88+, AJo+, KQo, ATs+'))
    const inRange = [...holdings.byStrength].filter((hand) => range[hand]! > 0)
    expect(inRange.length).toBeGreaterThan(10)

    const strongest = inRange[inRange.length - 1]!
    const weakest = inRange[0]!

    expect(solver.strategyFor(facing, strongest)[foldAt]!).toBeLessThan(
      solver.strategyFor(facing, weakest)[foldAt]!,
    )
  })

  it('labels its actions readably', () => {
    const root = solver.root as RiverNode
    const labels = root.actions.map((action) => solver.labelFor(root, action))
    expect(labels).toContain('check')
    expect(labels.some((label) => label.startsWith('bet '))).toBe(true)
  })

  it('refuses a board that is not a river', () => {
    expect(
      () =>
        new RiverSolver({ ...DEFAULT_POSTFLOP, board: parseCards('As Kd 7c') }, [
          new Float64Array(1),
          new Float64Array(1),
        ]),
    ).toThrow(/complete board/)
  })
})
