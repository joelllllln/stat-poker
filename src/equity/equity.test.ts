import { describe, expect, it } from 'vitest'
import { parseCards, Rng } from '../engine/cards'
import { handEquity, subsetEquity } from './equity'
import { comboClass, parseRange, rangePercent, rangeWeight } from './range'

const hero = (text: string) => parseCards(text) as [number, number]
const vs = (text: string) => [parseRange(text)]

describe('range parsing', () => {
  it('counts combos per shape', () => {
    expect(parseRange('AA')).toHaveLength(6)
    expect(parseRange('AKs')).toHaveLength(4)
    expect(parseRange('AKo')).toHaveLength(12)
    expect(parseRange('AK')).toHaveLength(16)
  })

  it('expands pair ranges', () => {
    expect(parseRange('QQ+')).toHaveLength(18) // QQ, KK, AA
    expect(parseRange('22-55')).toHaveLength(24)
  })

  it('expands kicker ranges', () => {
    expect(parseRange('ATs+')).toHaveLength(16) // ATs AJs AQs AKs
    expect(parseRange('KTo+')).toHaveLength(36) // KTo KJo KQo
  })

  it('expands connector runs', () => {
    expect(parseRange('T9s-76s')).toHaveLength(16) // T9s 98s 87s 76s
  })

  it('parses explicit combos', () => {
    expect(parseRange('AhKd')).toHaveLength(1)
  })

  it('parses a full range with weights', () => {
    const range = parseRange('77+, AJs+, KQo:0.5')
    expect(rangeWeight(range)).toBeCloseTo(8 * 6 + 3 * 4 + 12 * 0.5, 6)
  })

  it('covers the whole deck for random', () => {
    const range = parseRange('random')
    expect(range).toHaveLength(1326)
    expect(rangePercent(range)).toBeCloseTo(100, 6)
  })

  it('does not double-count overlapping tokens', () => {
    expect(parseRange('AA, AA, AhAd')).toHaveLength(6)
  })

  it('names hand classes', () => {
    expect(comboClass(hero('As Ks'))).toBe('AKs')
    expect(comboClass(hero('As Kd'))).toBe('AKo')
    expect(comboClass(hero('As Ad'))).toBe('AA')
  })

  it('rejects nonsense', () => {
    expect(() => parseRange('XX')).toThrow()
    expect(() => parseRange('AAs')).toThrow()
    expect(() => parseRange('T9s-76o')).toThrow()
  })
})

describe('exact equity', () => {
  it('gives a made hand on the river its true share', () => {
    // Hero holds the nuts; nothing in the villain range beats it.
    const result = handEquity(hero('As Ks'), vs('QQ, JJ'), parseCards('Qs Js Ts 2c 3d'))
    expect(result.exact).toBe(true)
    expect(result.equity).toBe(1)
  })

  it('scores a river chop as half the pot', () => {
    // Both play the board.
    const result = handEquity(hero('2c 3d'), vs('2h3s'), parseCards('As Ks Qd Jc Th'))
    expect(result.exact).toBe(true)
    expect(result.equity).toBe(0.5)
    expect(result.tie).toBe(1)
  })

  it('enumerates a turn spot exactly', () => {
    // Hero has a flush draw with one card to come: nine outs of 44 unseen
    // cards, and the villain's known hand blocks none of them.
    const result = handEquity(hero('As 2s'), vs('KhKd'), parseCards('Ks 7s 3h 9c'))
    expect(result.exact).toBe(true)
    // Villain has a set, hero wins only by hitting a spade that does not pair
    // the board. Nine spades remain, but the Ks-paired board can fill up.
    expect(result.equity).toBeGreaterThan(0.15)
    expect(result.equity).toBeLessThan(0.25)
  })

  it('is symmetric between two hands', () => {
    const full = { exactBudget: 5_000_000 }
    const aces = handEquity(hero('Ah As'), vs('KhKs'), [], full)
    const kings = handEquity(hero('Kh Ks'), vs('AhAs'), [], full)
    expect(aces.equity + kings.equity).toBeCloseTo(1, 6)
  })
})

describe('known matchups', () => {
  // Enumerated exactly, so these are the true numbers rather than estimates.
  it('puts aces over kings at about 82%', () => {
    const result = handEquity(hero('Ah As'), vs('KhKs'), [], { exactBudget: 5_000_000 })
    expect(result.exact).toBe(true)
    expect(result.equity).toBeGreaterThan(0.8)
    expect(result.equity).toBeLessThan(0.84)
  })

  it('makes a pair against two overcards close to a coin flip', () => {
    const result = handEquity(hero('2c 2d'), vs('AhKh'), [])
    expect(result.equity).toBeGreaterThan(0.47)
    expect(result.equity).toBeLessThan(0.55)
  })

  it('puts aces against a random hand at about 85%', () => {
    const result = handEquity(hero('Ah As'), vs('random'), [], { iterations: 60_000 })
    expect(result.equity).toBeGreaterThan(0.84)
    expect(result.equity).toBeLessThan(0.87)
  })

  it('drops equity as opponents are added', () => {
    const oneWay = handEquity(hero('Ah As'), [parseRange('random')], [], { iterations: 30_000 })
    const threeWay = handEquity(
      hero('Ah As'),
      [parseRange('random'), parseRange('random'), parseRange('random')],
      [],
      { iterations: 30_000 },
    )
    expect(threeWay.equity).toBeLessThan(oneWay.equity)
    expect(threeWay.equity).toBeGreaterThan(0.5)
  })
})

describe('sampling', () => {
  it('converges to the enumerated answer', () => {
    const board = parseCards('Ks 7s 3h')
    const exact = handEquity(hero('As 2s'), vs('KhKd'), board)
    const sampled = handEquity(hero('As 2s'), vs('KhKd'), board, {
      exactBudget: 0,
      iterations: 50_000,
      rng: new Rng(11),
    })
    expect(exact.exact).toBe(true)
    expect(sampled.exact).toBe(false)
    expect(Math.abs(sampled.equity - exact.equity)).toBeLessThan(sampled.errorMargin * 2)
  })

  it('reports a margin of error that shrinks with samples', () => {
    const few = handEquity(hero('Ah As'), vs('random'), [], { iterations: 1_000 })
    const many = handEquity(hero('Ah As'), vs('random'), [], { iterations: 50_000 })
    expect(many.errorMargin).toBeLessThan(few.errorMargin)
    expect(many.errorMargin).toBeLessThan(0.01)
  })

  it('is reproducible from a seed', () => {
    const a = handEquity(hero('Ah As'), vs('random'), [], { rng: new Rng(5), iterations: 5_000 })
    const b = handEquity(hero('Ah As'), vs('random'), [], { rng: new Rng(5), iterations: 5_000 })
    expect(a.equity).toBe(b.equity)
  })
})

describe('card removal', () => {
  it('excludes villain combos that use the hero or board cards', () => {
    // Hero holds the ace of spades, so the villain cannot have it: AA drops
    // from six combos to three, and every remaining one is beatable here.
    const withBlocker = handEquity(hero('As Kd'), vs('AA'), parseCards('Ah 7c 2d'))
    expect(withBlocker.exact).toBe(true)
    // Villain must hold one of the two remaining aces paired with the fourth,
    // making a set every time.
    expect(withBlocker.equity).toBeLessThan(0.15)
  })

  it('refuses a range fully blocked by visible cards', () => {
    expect(() => handEquity(hero('As Ah'), vs('AcAd'), parseCards('Ac 7c 2d'))).toThrow()
  })
})

/**
 * Pricing a bet means pricing every way the field can split, because who calls
 * is not known when the chips go in. One sweep answers all of them.
 */
describe('equity against every subset of the field', () => {
  const board = parseCards('Qs 8d 2h')
  const ranges = [parseRange('JJ+, AQs+'), parseRange('55+, A2s+, KQo')]

  it('agrees with pricing the whole field the usual way', () => {
    const { equity } = subsetEquity(hero('As Ks'), ranges, board, {
      rng: new Rng(3),
      iterations: 60_000,
    })

    expect(equity[0]).toBe(1) // nobody called: the pot is uncontested

    const both = handEquity(hero('As Ks'), ranges, board, {
      rng: new Rng(13),
      iterations: 60_000,
    }).equity
    expect(equity[3]).toBeCloseTo(both, 2)
  })

  it('keeps a folded hand out of the deck', () => {
    // A subset priced here differs slightly from the same villain priced
    // alone, and the difference is the point: the opponent who folded still
    // holds two cards, so they are not available to the board or to anyone
    // else. Pricing each subset in its own run would quietly put them back.
    const { equity } = subsetEquity(hero('As Ks'), ranges, board, {
      rng: new Rng(3),
      iterations: 60_000,
    })
    const alone = handEquity(hero('As Ks'), [ranges[0]!], board).equity
    expect(alone).toBeGreaterThan(0)
    expect(Math.abs(equity[1]! - alone)).toBeLessThan(0.02)
  })

  it('is worth less against more opponents', () => {
    const { equity } = subsetEquity(hero('As Ks'), ranges, board, {
      rng: new Rng(7),
      iterations: 20_000,
    })
    expect(equity[3]!).toBeLessThan(equity[1]!)
    expect(equity[3]!).toBeLessThan(equity[2]!)
  })

  it('carries an error bar measured from the spread, not assumed', () => {
    const { error } = subsetEquity(hero('As Ks'), ranges, board, {
      rng: new Rng(9),
      iterations: 20_000,
    })
    expect(error[0]).toBe(0) // an uncontested pot never varies
    expect(error[3]!).toBeGreaterThan(0)
    expect(error[3]!).toBeLessThan(0.01)
  })
})
