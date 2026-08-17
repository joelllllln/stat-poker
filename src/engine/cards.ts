/**
 * Card representation.
 *
 * A card is a plain integer 0..51, encoded as `rank * 4 + suit`.
 * Ranks are 0..12 for deuce..ace; suits are 0..3 for clubs, diamonds, hearts,
 * spades. Integers (not objects) because the equity engine will evaluate
 * millions of hands per second and needs these in typed arrays.
 */

export type Card = number
export type Rank = number
export type Suit = number

export const RANKS = '23456789TJQKA'
export const SUITS = 'cdhs'

export const NUM_RANKS = 13
export const NUM_SUITS = 4
export const NUM_CARDS = 52

export const makeCard = (rank: Rank, suit: Suit): Card => rank * NUM_SUITS + suit
export const rankOf = (card: Card): Rank => (card / NUM_SUITS) | 0
export const suitOf = (card: Card): Suit => card % NUM_SUITS

/** Parse a card such as `As`, `Td`, `2c`. Throws on anything malformed. */
export function parseCard(text: string): Card {
  if (text.length !== 2) throw new Error(`Invalid card: ${text}`)
  const rank = RANKS.indexOf(text[0]!.toUpperCase())
  const suit = SUITS.indexOf(text[1]!.toLowerCase())
  if (rank < 0 || suit < 0) throw new Error(`Invalid card: ${text}`)
  return makeCard(rank, suit)
}

/** Parse whitespace-separated cards, e.g. `"As Kd 7h"`. */
export function parseCards(text: string): Card[] {
  return text.split(/\s+/).filter(Boolean).map(parseCard)
}

export const formatCard = (card: Card): string => RANKS[rankOf(card)]! + SUITS[suitOf(card)]!

export const formatCards = (cards: readonly Card[]): string => cards.map(formatCard).join(' ')

/** A fresh ordered deck. Shuffle it with {@link shuffle}. */
export function freshDeck(): Card[] {
  return Array.from({ length: NUM_CARDS }, (_, i) => i)
}

/**
 * xoshiro128** — a small, fast, well-distributed PRNG.
 *
 * The engine is a pure reducer and holds no randomness of its own; a seeded
 * generator is passed in from outside. That is what makes a hand reproducible
 * from `(seed, actions[])` alone, which in turn is what makes replay,
 * "run it again" analysis, and deterministic tests possible.
 */
export class Rng {
  private s0: number
  private s1: number
  private s2: number
  private s3: number

  constructor(seed: number) {
    // splitmix32 the seed out into four words so that nearby seeds (0, 1, 2…)
    // produce entirely unrelated streams.
    let x = seed >>> 0
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0
      let z = x
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
      return (z ^ (z >>> 15)) >>> 0
    }
    this.s0 = next()
    this.s1 = next()
    this.s2 = next()
    this.s3 = next()
  }

  /** Next 32-bit unsigned integer. */
  nextUint32(): number {
    const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0
    const t = (this.s1 << 9) >>> 0
    this.s2 ^= this.s0
    this.s3 ^= this.s1
    this.s1 ^= this.s2
    this.s0 ^= this.s3
    this.s2 ^= t
    this.s3 = rotl(this.s3, 11)
    return result
  }

  /** Uniform integer in [0, bound). Rejection-sampled, so genuinely unbiased. */
  nextInt(bound: number): number {
    if (bound <= 0) throw new Error(`bound must be positive, got ${bound}`)
    // Reject the tail that would otherwise make low values slightly likelier.
    const limit = 0x100000000 - (0x100000000 % bound)
    let value = this.nextUint32()
    while (value >= limit) value = this.nextUint32()
    return value % bound
  }

  /** Float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 0x100000000
  }
}

/** Fisher-Yates, in place. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1)
    const tmp = items[i]!
    items[i] = items[j]!
    items[j] = tmp
  }
  return items
}

export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(freshDeck(), rng)
}
