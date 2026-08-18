import { beforeAll, describe, expect, it } from 'vitest'
import { CLASSES, CLASS_INDEX } from './matchup-table'
import { ALL_IN, CALL, FOLD, RAISE } from './preflop'
import {
  COMBOS,
  HAND_COUNT,
  HeadsUpPreflopSolver,
  buildCompatibility,
  buildPublicTree,
  realisedEquity,
  type PublicNode,
} from './preflop-hu'

const CONFIG = { players: 2, stack: 100, smallBlind: 0.5 }
const combosIn = (hands: string[]) => hands.reduce((sum, h) => sum + COMBOS[CLASS_INDEX[h]!]!, 0)

describe('card removal weights', () => {
  const table = buildCompatibility()
  const weight = (a: string, b: string) =>
    table[CLASS_INDEX[a]! * HAND_COUNT + CLASS_INDEX[b]!]!

  it('counts the ways two holdings can be dealt together', () => {
    // Two different pairs never block each other: 6 combos each.
    expect(weight('AA', 'KK')).toBe(36)
    // A suited hand against an unrelated pair: 4 × 6.
    expect(weight('AKs', 'QQ')).toBe(24)
  })

  it('makes a hand block itself hardest', () => {
    // Only three aces-versus-aces pairings exist without reusing a card, and
    // each is counted from both sides.
    expect(weight('AA', 'AA')).toBe(6)
    expect(weight('AA', 'AA')).toBeLessThan(weight('AA', 'KK'))
  })

  it('accounts for shared ranks', () => {
    // Aces take an ace away from ace-king, halving the ways they coexist; a
    // pair sharing no rank with it takes nothing away. Kings block it by the
    // same amount for the same reason, so the comparison that means something
    // is against a pair that shares neither rank.
    expect(weight('AA', 'AKs')).toBe(12)
    expect(weight('QQ', 'AKs')).toBe(24)
    expect(weight('AA', 'AKs')).toBeLessThan(weight('QQ', 'AKs'))
    expect(weight('KK', 'AKs')).toBeLessThan(weight('QQ', 'AKs'))
  })

  it('is symmetric', () => {
    for (const a of ['AA', 'AKs', '72o', 'JTs']) {
      for (const b of ['AA', 'AKs', '72o', 'JTs']) {
        expect(weight(a, b)).toBe(weight(b, a))
      }
    }
  })
})

describe('the public tree', () => {
  const root = buildPublicTree(CONFIG)

  it('starts with the button to act', () => {
    expect(root.toAct).toBe(0)
    expect(root.terminal).toBeNull()
  })

  it('does not model limping', () => {
    // Calling the blind is deliberately absent from the opening decision.
    expect(root.actions).not.toContain(CALL)
    expect(root.actions).toContain(FOLD)
    expect(root.actions).toContain(RAISE)
  })

  it('ends every line', () => {
    const depths: number[] = []
    const walk = (node: PublicNode, depth: number) => {
      if (node.terminal) {
        depths.push(depth)
        return
      }
      expect(node.children).toHaveLength(node.actions.length)
      for (const child of node.children) walk(child, depth + 1)
    }
    walk(root, 0)
    expect(depths.length).toBeGreaterThan(0)
    expect(Math.max(...depths)).toBeLessThan(12)
  })

  it('conserves chips at every terminal', () => {
    const walk = (node: PublicNode) => {
      if (node.terminal) {
        expect(node.terminal.committed[0] + node.terminal.committed[1]).toBeCloseTo(
          node.terminal.pot,
          6,
        )
        for (const committed of node.terminal.committed) {
          expect(committed).toBeLessThanOrEqual(CONFIG.stack)
        }
        return
      }
      for (const child of node.children) walk(child)
    }
    walk(root)
  })

  it('knows which showdowns still have a hand left to play', () => {
    // A terminal reached with chips behind is a flop the players will play;
    // one reached all-in is a board that simply runs out. Everything the model
    // says about position depends on telling those apart.
    const walk = (node: PublicNode) => {
      const terminal = node.terminal
      if (terminal) {
        if (terminal.winner < 0) {
          const allIn = terminal.committed.every((c) => c >= CONFIG.stack - 1e-9)
          expect(terminal.behind === 0).toBe(allIn)
        }
        expect(terminal.behind).toBeGreaterThanOrEqual(0)
        return
      }
      for (const child of node.children) walk(child)
    }
    walk(root)
  })

  it('prices an all-in showdown at the equity and nothing else', () => {
    // Position cannot be worth anything in a pot with no streets left, so the
    // discount has to vanish exactly, not merely shrink.
    for (const equity of [0.2, 0.5, 0.82]) {
      for (const player of [0, 1]) {
        expect(realisedEquity(equity, player, 0)).toBe(equity)
      }
    }

    // With a flop to come it still leans the button's way, and the two shares
    // of the same pot still add up to the pot.
    expect(realisedEquity(0.5, 0, 100)).toBeGreaterThan(0.5)
    expect(realisedEquity(0.5, 1, 100)).toBeLessThan(0.5)
    for (const equity of [0.2, 0.5, 0.82]) {
      expect(realisedEquity(equity, 0, 100) + realisedEquity(1 - equity, 1, 100)).toBeCloseTo(1, 12)
    }
  })

  it('gives a folded hand the blinds', () => {
    // The button folding immediately hands the big blind its half-blind win.
    const foldIndex = root.actions.indexOf(FOLD)
    const folded = root.children[foldIndex]!.terminal!
    expect(folded.winner).toBe(1)
    expect(folded.pot).toBeCloseTo(1.5, 6)
  })
})

describe('the solved strategy', () => {
  let solver: HeadsUpPreflopSolver
  const strategy = (hand: string) => solver.strategyFor(solver.root, CLASS_INDEX[hand]!)
  const rateOf = (hand: string, action: number) => {
    const index = solver.root.actions.indexOf(action)
    return index < 0 ? 0 : strategy(hand)[index]!
  }

  beforeAll(() => {
    solver = new HeadsUpPreflopSolver(CONFIG)
    solver.train(2_000)
  }, 300_000)

  it('converges to within a thousandth of a blind of equilibrium', () => {
    // Two-player and zero-sum, so this number means what it says.
    expect(solver.exploitability()).toBeLessThan(0.001)
    expect(solver.exploitability()).toBeGreaterThanOrEqual(0)
  })

  it('gets closer to equilibrium the longer it runs', () => {
    const brief = new HeadsUpPreflopSolver(CONFIG)
    brief.train(20)
    expect(solver.exploitability()).toBeLessThan(brief.exploitability())
  }, 300_000)

  it('always raises the hands nobody folds', () => {
    for (const hand of ['AA', 'KK', 'QQ', 'AKs', 'AKo']) {
      expect(rateOf(hand, RAISE), hand).toBeGreaterThan(0.9)
      expect(rateOf(hand, FOLD), hand).toBeLessThan(0.05)
    }
  })

  it('folds the worst hand in the deck', () => {
    expect(rateOf('72o', FOLD)).toBeGreaterThan(0.9)
  })

  it('opens the button about as wide as the game is known to be', () => {
    // Heads-up, the button is getting 1.5-to-0.5 on a steal and opens most of
    // the deck. Published solutions land in the low eighties.
    const foldIndex = solver.root.actions.indexOf(FOLD)
    const opened = CLASSES.filter(
      (_, hand) => solver.strategyFor(solver.root, hand)[foldIndex]! < 0.5,
    )
    const percent = (combosIn(opened) / 1326) * 100
    expect(percent).toBeGreaterThan(70)
    expect(percent).toBeLessThan(95)
  })

  it('folds worse hands more often than better ones', () => {
    const foldRate = (hand: string) => rateOf(hand, FOLD)
    expect(foldRate('AA')).toBeLessThanOrEqual(foldRate('72o'))
    expect(foldRate('KQs')).toBeLessThanOrEqual(foldRate('K2o'))
    expect(foldRate('99')).toBeLessThanOrEqual(foldRate('32o'))
  })

  it('does not shove a hundred blinds as its opening move', () => {
    // Available in the tree, and correctly almost never chosen at this depth.
    const shove = CLASSES.reduce((sum, hand) => sum + rateOf(hand, ALL_IN), 0) / HAND_COUNT
    expect(shove).toBeLessThan(0.1)
  })

  it('gives every hand a distribution at every node', () => {
    for (const node of solver.nodes()) {
      for (let hand = 0; hand < HAND_COUNT; hand++) {
        const total = solver.strategyFor(node, hand).reduce((a, b) => a + b, 0)
        expect(total).toBeCloseTo(1, 6)
      }
    }
  })
})
