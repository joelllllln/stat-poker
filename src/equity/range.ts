/**
 * Hand ranges.
 *
 * A range is a weighted set of two-card combinations. Everything the app says
 * about equity is said against a range rather than against specific cards, so
 * this is the vocabulary the HUD, the bots, and the coach all share.
 */

import { makeCard, NUM_RANKS, NUM_SUITS, parseCard, RANKS, rankOf, suitOf, type Card } from '../engine/cards'

export interface Combo {
  cards: readonly [Card, Card]
  weight: number
}

export type Range = Combo[]

const orderedPair = (a: Card, b: Card): [Card, Card] => (a > b ? [a, b] : [b, a])

/** The six combinations of a pocket pair. */
function pairCombos(rank: number): [Card, Card][] {
  const out: [Card, Card][] = []
  for (let s1 = 0; s1 < NUM_SUITS; s1++) {
    for (let s2 = s1 + 1; s2 < NUM_SUITS; s2++) {
      out.push(orderedPair(makeCard(rank, s1), makeCard(rank, s2)))
    }
  }
  return out
}

/** The four suited combinations of two distinct ranks. */
function suitedCombos(high: number, low: number): [Card, Card][] {
  return Array.from({ length: NUM_SUITS }, (_, suit) =>
    orderedPair(makeCard(high, suit), makeCard(low, suit)),
  )
}

/** The twelve offsuit combinations of two distinct ranks. */
function offsuitCombos(high: number, low: number): [Card, Card][] {
  const out: [Card, Card][] = []
  for (let s1 = 0; s1 < NUM_SUITS; s1++) {
    for (let s2 = 0; s2 < NUM_SUITS; s2++) {
      if (s1 !== s2) out.push(orderedPair(makeCard(high, s1), makeCard(low, s2)))
    }
  }
  return out
}

type Shape = 's' | 'o' | 'both'

function classCombos(high: number, low: number, shape: Shape): [Card, Card][] {
  if (high === low) return pairCombos(high)
  if (shape === 's') return suitedCombos(high, low)
  if (shape === 'o') return offsuitCombos(high, low)
  return [...suitedCombos(high, low), ...offsuitCombos(high, low)]
}

const rankIndex = (letter: string): number => {
  const index = RANKS.indexOf(letter.toUpperCase())
  if (index < 0) throw new Error(`Unknown rank: ${letter}`)
  return index
}

/** Parse `AKs`, `77`, `T9o`, or `AK` into ranks plus shape. */
function parseClass(token: string): { high: number; low: number; shape: Shape } {
  const shapeChar = token.length === 3 ? token[2]!.toLowerCase() : ''
  if (token.length === 3 && shapeChar !== 's' && shapeChar !== 'o') {
    throw new Error(`Unknown hand class: ${token}`)
  }
  const a = rankIndex(token[0]!)
  const b = rankIndex(token[1]!)
  const high = Math.max(a, b)
  const low = Math.min(a, b)
  if (high === low && token.length === 3) throw new Error(`A pair cannot be suited: ${token}`)
  const shape: Shape = shapeChar === 's' ? 's' : shapeChar === 'o' ? 'o' : 'both'
  return { high, low, shape }
}

/**
 * Expand one token into combos.
 *
 * Supported: `AA`, `77+`, `22-99`, `AKs`, `AKo`, `AK`, `A2s+`, `KTo+`,
 * `T9s-76s`, explicit combos like `AhKd`, and a trailing `:0.5` weight.
 */
function expandToken(token: string): [Card, Card][] {
  // Explicit combo, e.g. AhKd.
  if (/^[2-9TJQKA][cdhs][2-9TJQKA][cdhs]$/i.test(token)) {
    return [orderedPair(parseCard(token.slice(0, 2)), parseCard(token.slice(2)))]
  }

  // A run between two classes, e.g. 22-99 or T9s-76s.
  if (token.includes('-')) {
    const [fromText, toText] = token.split('-') as [string, string]
    const from = parseClass(fromText)
    const to = parseClass(toText)
    if (from.shape !== to.shape) throw new Error(`Mismatched shapes in range: ${token}`)
    if (from.high - from.low !== to.high - to.low) {
      throw new Error(`Range endpoints must share a gap: ${token}`)
    }
    const step = from.high <= to.high ? 1 : -1
    const out: [Card, Card][] = []
    for (let high = from.high; ; high += step) {
      out.push(...classCombos(high, high - (from.high - from.low), from.shape))
      if (high === to.high) break
    }
    return out
  }

  // An open-ended class, e.g. 77+ (pairs up) or A2s+ (kicker up).
  if (token.endsWith('+')) {
    const { high, low, shape } = parseClass(token.slice(0, -1))
    const out: [Card, Card][] = []
    if (high === low) {
      for (let rank = high; rank < NUM_RANKS; rank++) out.push(...classCombos(rank, rank, shape))
    } else {
      for (let kicker = low; kicker < high; kicker++) out.push(...classCombos(high, kicker, shape))
    }
    return out
  }

  const { high, low, shape } = parseClass(token)
  return classCombos(high, low, shape)
}

/**
 * Parse a range string such as `"77+, AJs+, KQo, AhKd"`.
 *
 * `random` or `any` means every combination. Duplicate combos keep their
 * highest weight rather than stacking, so overlapping tokens are harmless.
 */
export function parseRange(text: string): Range {
  const byKey = new Map<number, Combo>()

  const add = (cards: [Card, Card], weight: number) => {
    const key = cards[0] * 52 + cards[1]
    const existing = byKey.get(key)
    if (!existing || weight > existing.weight) byKey.set(key, { cards, weight })
  }

  for (const raw of text.split(',')) {
    const token = raw.trim()
    if (!token) continue

    if (token.toLowerCase() === 'random' || token.toLowerCase() === 'any') {
      for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) add(orderedPair(a, b), 1)
      continue
    }

    const [body, weightText] = token.split(':')
    const weight = weightText === undefined ? 1 : Number(weightText)
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(`Weight must be between 0 and 1: ${token}`)
    }
    for (const combo of expandToken(body!.trim())) add(combo, weight)
  }

  return [...byKey.values()]
}

/** Drop combos that use any of `blockers` — cards already visible elsewhere. */
export function removeBlocked(range: Range, blockers: readonly Card[]): Range {
  if (blockers.length === 0) return range
  const blocked = new Set(blockers)
  return range.filter((c) => !blocked.has(c.cards[0]) && !blocked.has(c.cards[1]))
}

/** Sum of weights — the effective number of combos in the range. */
export const rangeWeight = (range: Range): number => range.reduce((sum, c) => sum + c.weight, 0)

/** The 169 hand classes, as `AKs` / `AKo` / `77`. */
export function comboClass(cards: readonly [Card, Card]): string {
  const [a, b] = cards
  const r1 = rankOf(a)
  const r2 = rankOf(b)
  const high = RANKS[Math.max(r1, r2)]!
  const low = RANKS[Math.min(r1, r2)]!
  if (r1 === r2) return `${high}${low}`
  return `${high}${low}${suitOf(a) === suitOf(b) ? 's' : 'o'}`
}

/** Percentage of all 1326 starting combinations this range covers. */
export const rangePercent = (range: Range): number => (rangeWeight(range) / 1326) * 100
