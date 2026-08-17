import { describe, expect, it } from 'vitest'
import {
  formatCards,
  freshDeck,
  makeCard,
  NUM_CARDS,
  parseCard,
  parseCards,
  rankOf,
  Rng,
  shuffledDeck,
  suitOf,
} from './cards'

describe('card encoding', () => {
  it('round-trips every card through text', () => {
    for (let card = 0; card < NUM_CARDS; card++) {
      expect(parseCard(formatCards([card]))).toBe(card)
    }
  })

  it('encodes rank and suit', () => {
    expect(parseCard('2c')).toBe(0)
    expect(parseCard('As')).toBe(51)
    expect(rankOf(parseCard('Td'))).toBe(8)
    expect(suitOf(parseCard('Td'))).toBe(1)
    expect(makeCard(12, 3)).toBe(parseCard('As'))
  })

  it('accepts mixed case', () => {
    expect(parseCard('as')).toBe(parseCard('AS'))
  })

  it('rejects malformed input', () => {
    expect(() => parseCard('Xs')).toThrow()
    expect(() => parseCard('A')).toThrow()
    expect(() => parseCard('Ax')).toThrow()
  })

  it('parses a list', () => {
    expect(parseCards('As Kd 7h')).toEqual([51, 45, 22])
  })
})

describe('deck', () => {
  it('is 52 distinct cards', () => {
    expect(new Set(freshDeck()).size).toBe(NUM_CARDS)
  })

  it('shuffles to a permutation', () => {
    const deck = shuffledDeck(new Rng(7))
    expect(deck).toHaveLength(NUM_CARDS)
    expect(new Set(deck).size).toBe(NUM_CARDS)
  })

  it('shuffles differently from the ordered deck', () => {
    expect(shuffledDeck(new Rng(7))).not.toEqual(freshDeck())
  })
})

describe('rng', () => {
  it('is reproducible from a seed', () => {
    expect(shuffledDeck(new Rng(42))).toEqual(shuffledDeck(new Rng(42)))
  })

  it('gives unrelated streams for adjacent seeds', () => {
    expect(shuffledDeck(new Rng(1))).not.toEqual(shuffledDeck(new Rng(2)))
  })

  it('stays in range', () => {
    const rng = new Rng(3)
    for (let i = 0; i < 10_000; i++) {
      const n = rng.nextInt(52)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(52)
    }
  })

  it('is roughly uniform', () => {
    const rng = new Rng(9)
    const buckets = new Array(52).fill(0)
    const trials = 520_000
    for (let i = 0; i < trials; i++) buckets[rng.nextInt(52)]++

    const expected = trials / 52
    for (const count of buckets) {
      // Chebyshev-ish sanity bound: ±5% at 10k samples per bucket is generous
      // for an unbiased generator and tight enough to catch modulo bias.
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05)
    }
  })

  it('shuffles without positional bias', () => {
    // A broken Fisher-Yates usually shows up as a card that will not move.
    const positionsSeen = new Set<number>()
    for (let seed = 0; seed < 200; seed++) {
      positionsSeen.add(shuffledDeck(new Rng(seed)).indexOf(0))
    }
    expect(positionsSeen.size).toBeGreaterThan(40)
  })
})
