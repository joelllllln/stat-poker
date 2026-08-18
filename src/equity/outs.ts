/**
 * Outs.
 *
 * Counting outs is normally taught as a rule of thumb — nine for a flush draw,
 * eight for an open-ender — and the rules quietly assume the opponent holds
 * exactly one thing. They also say nothing about the cards that improve you
 * and improve them more.
 *
 * The definition used here needs no rules: **an out is a card that turns you
 * from an underdog into a favourite** against the range you are actually up
 * against. It counts a card that pairs your ace when that is enough, refuses
 * to count a flush card that puts a fourth of a suit on a board where it
 * completes their range too, and handles every board texture the same way,
 * because it never had a texture rule to begin with.
 */

import { NUM_CARDS, Rng, type Card } from '../engine/cards'
import { handEquity } from './equity'
import type { Range } from './range'

export interface OutsResult {
  /** Cards that make the hand a favourite. */
  outs: Card[]
  /** Equity as things stand. */
  current: number
  /** Chance of hitting one by the next card. */
  byNextCard: number
  /** Chance of hitting one by the river. */
  byRiver: number
  /** Cards still to come. */
  toCome: number
}

/** Iterations per candidate card. Enough to rank, cheap enough to sweep 47. */
const ITERATIONS = 600
/** Equity a hand needs after a card for that card to count as an out. */
const FAVOURITE = 0.5

/**
 * Which unseen cards would make this hand a favourite.
 *
 * Every card the board could bring is tried, and the hand is re-priced against
 * the same opponent range with that card in place. Nothing is assumed about
 * what a draw is worth.
 */
export function findOuts(
  hero: readonly [Card, Card],
  board: readonly Card[],
  villains: readonly Range[],
  seed = 0x0475,
): OutsResult {
  const toCome = 5 - board.length
  if (toCome <= 0 || villains.length === 0) {
    return { outs: [], current: 0, byNextCard: 0, byRiver: 0, toCome: 0 }
  }

  const rng = new Rng(seed)
  const seen = new Set<Card>([...hero, ...board])
  const priceWith = (extra: Card | null): number => {
    const withCard = extra === null ? board : [...board, extra]
    try {
      return handEquity(hero, villains, withCard, { rng, iterations: ITERATIONS }).equity
    } catch {
      return 0
    }
  }

  const current = priceWith(null)
  const outs: Card[] = []
  let unseen = 0

  for (let card = 0; card < NUM_CARDS; card++) {
    if (seen.has(card)) continue
    unseen++
    // A card only counts if it changes the answer: a hand already ahead is not
    // drawing to anything, and cards that keep it ahead are not outs.
    if (current >= FAVOURITE) continue
    if (priceWith(card) >= FAVOURITE) outs.push(card)
  }

  const missOnce = unseen === 0 ? 1 : (unseen - outs.length) / unseen
  const byNextCard = 1 - missOnce
  // Two cards to come: miss both, with one fewer card in the deck the second
  // time. Adding the two chances together — the usual shortcut — overcounts
  // the runouts that bring two.
  const byRiver =
    toCome >= 2 && unseen > 1
      ? 1 - missOnce * ((unseen - 1 - outs.length) / (unseen - 1))
      : byNextCard

  return { outs, current, byNextCard, byRiver, toCome }
}

/** Card names for display, e.g. `9 spades and 3 tens`. */
export function summariseOuts(result: OutsResult): string {
  if (result.toCome === 0) return 'no cards to come'
  if (result.current >= FAVOURITE) return 'already ahead'
  if (result.outs.length === 0) return 'no card makes you a favourite'
  return `${result.outs.length} card${result.outs.length === 1 ? '' : 's'} put you ahead`
}
