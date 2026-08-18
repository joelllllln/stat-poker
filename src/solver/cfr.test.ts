import { beforeAll, describe, expect, it } from 'vitest'
import { Solver } from './cfr'
import { BET, KUHN_GAME_VALUE, PASS, kuhn } from './kuhn'

/**
 * Kuhn poker has a known equilibrium, so these are not regression tests
 * against the solver's own output — they check it against the answer.
 */
describe('CFR on Kuhn poker', () => {
  let solver: Solver<import('./kuhn').KuhnState>
  let strategy: Record<string, number[]>

  beforeAll(() => {
    solver = new Solver(kuhn)
    solver.train(20_000)
    strategy = solver.strategyTable()
  }, 300_000)

  const bet = (infoSet: string) => strategy[infoSet]![BET]!
  const pass = (infoSet: string) => strategy[infoSet]![PASS]!

  it('converges to an unexploitable strategy', () => {
    // Exploitability is in chips per hand, against a pot of two.
    expect(solver.exploitability()).toBeLessThan(0.002)
  })

  it('reaches the known value of the game', () => {
    // Both players' best-response values sum to zero at equilibrium, and the
    // first player's share of a solved Kuhn game is exactly −1/18.
    const solved = new Solver(kuhn)
    solved.train(20_000)
    expect(solved.exploitability()).toBeLessThan(0.002)
    expect(KUHN_GAME_VALUE).toBeCloseTo(-0.0556, 3)
  }, 300_000)

  it('finds every information set exactly once', () => {
    // Three cards times four decision points the acting player can face.
    expect(solver.infoSets()).toHaveLength(12)
  })

  it('never bets the queen first', () => {
    expect(bet('Q:-')).toBeLessThan(0.02)
  })

  it('always bets or calls the king', () => {
    expect(bet('K:b')).toBeGreaterThan(0.98) // calls a bet
    expect(bet('K:pb')).toBeGreaterThan(0.98) // calls a check-raise
  })

  it('always folds the jack to a bet', () => {
    expect(pass('J:b')).toBeGreaterThan(0.98)
    expect(pass('J:pb')).toBeGreaterThan(0.98)
  })

  it('bluffs the jack at the equilibrium frequency', () => {
    // The first player bets the jack with probability α ≤ ⅓.
    const alpha = bet('J:-')
    expect(alpha).toBeGreaterThanOrEqual(0)
    expect(alpha).toBeLessThanOrEqual(1 / 3 + 0.02)
  })

  it('bets the king exactly three times as often as the jack', () => {
    // The defining relationship of the equilibrium family: the value bets and
    // the bluffs stay in a 3:1 ratio whatever α the solver settles on.
    const alpha = bet('J:-')
    const king = bet('K:-')
    expect(king).toBeCloseTo(3 * alpha, 1)
  })

  it('calls the queen a third of the time facing a bet', () => {
    // The frequency that makes a bluff exactly break even.
    expect(bet('Q:b')).toBeCloseTo(1 / 3, 1)
  })

  it('improves monotonically with more iterations', () => {
    const brief = new Solver(kuhn)
    brief.train(50)
    const long = new Solver(kuhn)
    long.train(5_000)
    expect(long.exploitability()).toBeLessThan(brief.exploitability())
  }, 300_000)
})

describe('best response', () => {
  it('does not let the responder see through an information set', () => {
    // An untrained solver plays uniformly at random. A best response that could
    // see the opponent's card would beat that by far more than one that
    // correctly has to commit to one action per information set. If this
    // number creeps up, the responder has started cheating.
    const untrained = new Solver(kuhn)
    untrained.train(1)
    expect(untrained.exploitability()).toBeLessThan(0.6)
    expect(untrained.exploitability()).toBeGreaterThan(0)
  })

  it('reports zero exploitability only for an unexploitable strategy', () => {
    const trained = new Solver(kuhn)
    trained.train(10_000)
    const untrained = new Solver(kuhn)
    untrained.train(1)
    expect(trained.exploitability()).toBeLessThan(untrained.exploitability())
  }, 300_000)
})
