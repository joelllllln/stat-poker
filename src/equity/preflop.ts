/**
 * Preflop hand strength.
 *
 * Every preflop decision consults this, so the equities are precomputed by
 * `scripts/generate-preflop-table.ts` and committed rather than sampled at
 * runtime — sampling them on startup cost two seconds, and they never change.
 *
 * Percentile, not raw equity, is what callers want: "this hand is in the top
 * 12% of starting hands" is the quantity ranges and opening charts are written
 * in.
 */

import { RANKS, rankOf, suitOf, type Card } from '../engine/cards'
import { PREFLOP_EQUITY } from './preflop-table'
import { comboClass } from './range'

export interface PreflopStrength {
  /** Class name, e.g. `AKs`. */
  hand: string
  /** All-in equity against one random hand. */
  equity: number
  /** 1 for the best starting hand, falling toward 0 for the worst. */
  percentile: number
}

let table: Map<string, PreflopStrength> | null = null

function ensureTable(): Map<string, PreflopStrength> {
  if (table !== null) return table
  const built = new Map<string, PreflopStrength>()
  PREFLOP_EQUITY.forEach(([hand, equity], index) => {
    built.set(hand, {
      hand,
      equity,
      percentile: 1 - index / (PREFLOP_EQUITY.length - 1),
    })
  })
  table = built
  return built
}

/** Strength of a specific two-card holding. */
export function preflopStrength(cards: readonly [Card, Card]): PreflopStrength {
  const key = comboClass(cards)
  const row = ensureTable().get(key)
  if (!row) throw new Error(`No preflop entry for ${key}`)
  return row
}

/** All 169 classes, best first. */
export function preflopRanking(): PreflopStrength[] {
  return [...ensureTable().values()].sort((a, b) => b.percentile - a.percentile)
}

/**
 * The top `fraction` of starting hands as a range string, e.g. the top 15%.
 * Weighted by how many combinations each class actually has, so "top 20%"
 * means a fifth of the deals rather than a fifth of the 169 labels.
 */
export function topPercentRange(fraction: number): string {
  const combosFor = (hand: string): number =>
    hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12

  const target = fraction * 1326
  const chosen: string[] = []
  let total = 0
  for (const row of preflopRanking()) {
    if (total >= target) break
    chosen.push(row.hand)
    total += combosFor(row.hand)
  }
  return chosen.join(', ')
}

/** Text form of a holding for display, e.g. `A♠K♠`. */
export function formatHolding(cards: readonly [Card, Card]): string {
  const glyphs = ['♣', '♦', '♥', '♠']
  return cards.map((c) => `${RANKS[rankOf(c)]}${glyphs[suitOf(c)]}`).join('')
}
