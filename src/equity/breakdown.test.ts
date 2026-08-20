import { describe, expect, it } from 'vitest'
import { parseCards } from '../engine/cards'
import { parseRange } from './range'
import { rangeSplit, splitAgainstAll } from './breakdown'
import { topPercentRange } from './preflop'

const hand = (text: string) => parseCards(text) as [number, number]
const cards = (text: string) => parseCards(text)

describe('splitting a range by what beats you', () => {
  it('says nothing before the flop, where there is nothing made to compare', () => {
    expect(rangeSplit(hand('As Ks'), [], parseRange('QQ+'))).toBeNull()
  })

  it('puts the whole range behind the nuts', () => {
    // Quad aces on a paired ace board: nothing in any range is ahead.
    const split = rangeSplit(hand('As Ah'), cards('Ac Ad 7h'), parseRange('KK,QQ,72o'))
    expect(split).not.toBeNull()
    expect(split!.ahead).toBe(1)
    expect(split!.behind).toBe(0)
    expect(split!.beatenBy).toEqual([])
  })

  it('puts the whole range ahead of the worst hand', () => {
    // Seven-two on a board of broadway cards against a range of big pairs.
    const split = rangeSplit(hand('7c 2d'), cards('As Ks Qh'), parseRange('AA,KK,QQ'))
    expect(split!.behind).toBe(1)
    expect(split!.ahead).toBe(0)
  })

  it('names what is doing the beating, biggest first', () => {
    // An overpair on a king-high board, against a range holding sets and two
    // pair. Both beat aces, and the panel has to say which is which.
    const split = rangeSplit(hand('Ac Ad'), cards('Ks 8h 3d'), parseRange('88,33,K8s'))!
    const names = split.beatenBy.map((kind) => kind.name)
    expect(names).toContain('a set')
    expect(names).toContain('two pair')
    // Sorted by how much of the range each accounts for.
    const shares = split.beatenBy.map((kind) => kind.share)
    expect([...shares].sort((a, b) => b - a)).toEqual(shares)
    // And every combo in that range really does beat an overpair.
    expect(split.behind).toBe(1)
  })

  it('tells a better pair from a pair', () => {
    // Ace-jack on an ace-high board: a better pair is the thing to worry
    // about, and calling it "a pair" would say nothing.
    const split = rangeSplit(hand('Ac Jd'), cards('Ah 7s 2d'), parseRange('AK,AQ'))!
    expect(split.behind).toBeGreaterThan(0.9)
    expect(split.beatenBy[0]!.name).toBe('a better pair')
  })

  it('adds up to one', () => {
    for (const width of [0.1, 0.35, 0.8]) {
      const split = rangeSplit(hand('Ts 9s'), cards('8s 7d 2c'), parseRange(topPercentRange(width)))!
      expect(split.ahead + split.tied + split.behind).toBeCloseTo(1, 10)
    }
  })

  it('leaves out combos that cannot be dealt', () => {
    // Three aces are accounted for — one in the hand, two on the board — so
    // no combo of AA can be dealt, and a range of nothing but AA is a range
    // nobody can hold. Saying so beats reporting a split of an empty set.
    expect(rangeSplit(hand('As Ks'), cards('Ac Ad 5h'), parseRange('AA'))).toBeNull()

    // With one ace free the same range still has combos, and they are only
    // the ones using cards nobody else holds.
    const some = rangeSplit(hand('Ks Qs'), cards('Ac Ad 5h'), parseRange('AA'))!
    expect(some.combos).toBe(1)
  })

  it('never reports a hand as beaten by itself', () => {
    const split = rangeSplit(hand('9h 9c'), cards('9s 4d 2h'), parseRange('99'))
    // Every combo of nines is dead but one, and that one chops.
    expect(split === null || split.behind === 0).toBe(true)
  })
})

describe('splitting against a whole table', () => {
  const board = cards('Kh 8c 3d')

  it('is harder to be ahead of two ranges than of one', () => {
    const one = splitAgainstAll(hand('Ac Kd'), board, [parseRange(topPercentRange(0.3))])!
    const three = splitAgainstAll(
      hand('Ac Kd'),
      board,
      [0.3, 0.3, 0.3].map((w) => parseRange(topPercentRange(w))),
    )!
    expect(three.ahead).toBeLessThan(one.ahead)
    expect(three.behind).toBeGreaterThan(one.behind)
  })

  it('still adds up to one', () => {
    const split = splitAgainstAll(
      hand('Ac Kd'),
      board,
      [0.2, 0.5].map((w) => parseRange(topPercentRange(w))),
    )!
    expect(split.ahead + split.tied + split.behind).toBeCloseTo(1, 10)
  })

  it('shares out the beating across everyone, not per opponent', () => {
    const split = splitAgainstAll(
      hand('Ac Kd'),
      board,
      [0.3, 0.3].map((w) => parseRange(topPercentRange(w))),
    )!
    const named = split.beatenBy.reduce((sum, kind) => sum + kind.share, 0)
    expect(named).toBeCloseTo(split.behind, 6)
  })

  it('says nothing when nobody is left to read', () => {
    expect(splitAgainstAll(hand('Ac Kd'), board, [])).toBeNull()
  })
})
