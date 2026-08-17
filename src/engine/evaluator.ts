/**
 * 5-to-7 card hand evaluator.
 *
 * Returns a single integer per hand: higher is strictly better, and two hands
 * compare equal exactly when they chop. Layout is
 *
 *     category << 20 | k1 << 16 | k2 << 12 | k3 << 8 | k4 << 4 | k5
 *
 * where the kickers are rank indices (0..12) in descending significance and
 * unused kicker slots are zero. Everything fits in 24 bits, so these stay in
 * SMI range and compare with a plain `<`.
 */

import { NUM_RANKS, NUM_SUITS, rankOf, suitOf, type Card } from './cards'

export const enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.Trips]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.Quads]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
}

export const categoryOf = (value: number): HandCategory => (value >>> 20) as HandCategory

const pack = (category: HandCategory, k1 = 0, k2 = 0, k3 = 0, k4 = 0, k5 = 0): number =>
  (category << 20) | (k1 << 16) | (k2 << 12) | (k3 << 8) | (k4 << 4) | k5

/**
 * Highest rank index completing a 5-straight in `mask`, or -1.
 *
 * The mask is widened by one bit so the ace can also play low: bit 0 becomes
 * ace-low and rank r moves to bit r+1. A set bit at position p in the AND-fold
 * then means p..p+4 are all present, i.e. a straight topping out at rank p+3.
 */
function straightHigh(mask: number): number {
  const ext = ((mask << 1) | ((mask >>> 12) & 1)) >>> 0
  const runs = ext & (ext >>> 1) & (ext >>> 2) & (ext >>> 3) & (ext >>> 4)
  if (runs === 0) return -1
  return 31 - Math.clz32(runs) + 3
}

/** Pack the five highest set bits of a rank mask as kickers. */
function topFive(mask: number): number[] {
  const out: number[] = []
  for (let r = NUM_RANKS - 1; r >= 0 && out.length < 5; r--) {
    if (mask & (1 << r)) out.push(r)
  }
  return out
}

// Scratch buffers, reused across calls. The evaluator is on the hot path of
// every Monte Carlo rollout, so it must not allocate.
const rankCounts = new Int8Array(NUM_RANKS)
const suitCounts = new Int8Array(NUM_SUITS)
const suitMasks = new Int16Array(NUM_SUITS)

/**
 * Evaluate 5, 6, or 7 cards. Cards must be distinct.
 *
 * Note the shortcut this relies on: with 7 or fewer cards, holding a flush
 * makes quads and a full house impossible (both would need more cards than
 * exist), so once a five-card suit is found the answer is a flush or a
 * straight flush and nothing else needs checking.
 */
export function evaluate(cards: readonly Card[]): number {
  rankCounts.fill(0)
  suitCounts.fill(0)
  suitMasks.fill(0)

  let rankMask = 0
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!
    const rank = rankOf(card)
    const suit = suitOf(card)
    rankCounts[rank]!++
    suitCounts[suit]!++
    suitMasks[suit]! |= 1 << rank
    rankMask |= 1 << rank
  }

  for (let suit = 0; suit < NUM_SUITS; suit++) {
    if (suitCounts[suit]! < 5) continue
    const suited = suitMasks[suit]!
    const sfHigh = straightHigh(suited)
    if (sfHigh >= 0) return pack(HandCategory.StraightFlush, sfHigh)
    const [k1, k2, k3, k4, k5] = topFive(suited)
    return pack(HandCategory.Flush, k1, k2, k3, k4, k5)
  }

  // No flush, so walk the rank counts high-to-low and bucket by multiplicity.
  let quad = -1
  let tripsHigh = -1
  let tripsLow = -1
  let pairHigh = -1
  let pairLow = -1
  for (let r = NUM_RANKS - 1; r >= 0; r--) {
    const count = rankCounts[r]!
    if (count === 4) {
      if (quad < 0) quad = r
    } else if (count === 3) {
      if (tripsHigh < 0) tripsHigh = r
      else if (tripsLow < 0) tripsLow = r
    } else if (count === 2) {
      if (pairHigh < 0) pairHigh = r
      else if (pairLow < 0) pairLow = r
    }
  }

  if (quad >= 0) {
    const kicker = topFive(rankMask & ~(1 << quad))[0]!
    return pack(HandCategory.Quads, quad, kicker)
  }

  if (tripsHigh >= 0 && (tripsLow >= 0 || pairHigh >= 0)) {
    // A second set plays as the pair when it outranks the best actual pair —
    // possible with seven cards (e.g. 999 888 2).
    const pair = tripsLow > pairHigh ? tripsLow : pairHigh
    return pack(HandCategory.FullHouse, tripsHigh, pair)
  }

  const straight = straightHigh(rankMask)
  if (straight >= 0) return pack(HandCategory.Straight, straight)

  if (tripsHigh >= 0) {
    const [k1, k2] = topFive(rankMask & ~(1 << tripsHigh))
    return pack(HandCategory.Trips, tripsHigh, k1, k2)
  }

  if (pairHigh >= 0 && pairLow >= 0) {
    const kicker = topFive(rankMask & ~(1 << pairHigh) & ~(1 << pairLow))[0]!
    return pack(HandCategory.TwoPair, pairHigh, pairLow, kicker)
  }

  if (pairHigh >= 0) {
    const [k1, k2, k3] = topFive(rankMask & ~(1 << pairHigh))
    return pack(HandCategory.Pair, pairHigh, k1, k2, k3)
  }

  const [k1, k2, k3, k4, k5] = topFive(rankMask)
  return pack(HandCategory.HighCard, k1, k2, k3, k4, k5)
}

/** Human-readable description, e.g. `Two Pair, aces and eights`. */
export function describe(value: number): string {
  const category = categoryOf(value)
  const name = CATEGORY_NAMES[category]
  const k1 = (value >>> 16) & 0xf
  const k2 = (value >>> 12) & 0xf
  const plural = ['deuces', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces']
  const single = ['deuce', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace']
  switch (category) {
    case HandCategory.StraightFlush:
      return k1 === 12 ? 'Royal Flush' : `${name}, ${single[k1]}-high`
    case HandCategory.Straight:
      return `${name}, ${single[k1]}-high`
    case HandCategory.Quads:
      return `${name}, ${plural[k1]}`
    case HandCategory.FullHouse:
      return `${name}, ${plural[k1]} full of ${plural[k2]}`
    case HandCategory.TwoPair:
      return `${name}, ${plural[k1]} and ${plural[k2]}`
    case HandCategory.Trips:
    case HandCategory.Pair:
      return `${name}, ${plural[k1]}`
    default:
      return `${name}, ${single[k1]}-high`
  }
}
