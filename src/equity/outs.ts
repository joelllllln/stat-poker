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
  /** Chance the next card is one of them. */
  byNextCard: number
  /**
   * Chance the hand is in front once the board is complete.
   *
   * Not the chance of hitting an out twice over: every pair of cards still to
   * come is tried and the hand re-priced, so a runout that arrives in two
   * pieces counts and one that arrives and is then undone does not.
   */
  byRiver: number
  /** Cards still to come. */
  toCome: number
}

/**
 * Precision the sweep works to, in share of the pot.
 *
 * A card is an out or it is not, and the comparison is made at even money, so
 * an answer that could be either side of it decides the count by coin flip.
 * Every candidate is scanned at this precision and only the ones that land too
 * close to call are then settled exactly — which is where the enumeration is
 * worth paying for, and the only place it is paid.
 */
const SCAN_ERROR = 0.02

/** Enumeration budget for settling a card that the scan could not separate. */
const EXACT_BUDGET = 2_000_000

/** Two-card runouts to try when enumerating all of them is too much work. */
const RUNOUT_SAMPLE = 400

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

  /** Price the hand with these cards added, to a stated precision. */
  const priceWith = (extra: readonly Card[], exact: boolean): { equity: number; error: number } => {
    try {
      const result = handEquity(hero, villains, [...board, ...extra], {
        rng,
        iterations: 400,
        targetError: SCAN_ERROR,
        maxIterations: 40_000,
        // The scan never enumerates: it is asking a rough question and an
        // exact answer to it costs twenty times what the rough one does.
        exactBudget: exact ? EXACT_BUDGET : 0,
      })
      return { equity: result.equity, error: result.errorMargin / 2 }
    } catch {
      return { equity: 0, error: 0 }
    }
  }

  const current = priceWith([], false).equity
  const remaining: Card[] = []
  for (let card = 0; card < NUM_CARDS; card++) if (!seen.has(card)) remaining.push(card)
  const unseen = remaining.length

  /** Is the hand in front once these cards land? Settled exactly if it is close. */
  const aheadWith = (extra: readonly Card[]): boolean => {
    const scan = priceWith(extra, false)
    if (Math.abs(scan.equity - FAVOURITE) > 2 * scan.error) return scan.equity >= FAVOURITE
    return priceWith(extra, true).equity >= FAVOURITE
  }

  const outs: Card[] = []
  // A hand already ahead is not drawing to anything, and cards that keep it
  // ahead are not outs.
  if (current < FAVOURITE) {
    for (const card of remaining) if (aheadWith([card])) outs.push(card)
  }

  const byNextCard = unseen === 0 ? 0 : outs.length / unseen

  // With two cards to come, the honest question is not how often an out
  // arrives but how often the hand ends up in front — which is answered by
  // trying pairs of cards rather than by assuming that what an out is stays
  // the same after the first one lands. That assumption is what the usual
  // "miss twice" shortcut is really making, and it counts a runout that
  // arrives and is then undone.
  let byRiver = byNextCard
  if (toCome >= 2 && unseen > 1 && current < FAVOURITE) {
    const pairs: [Card, Card][] = []
    for (let i = 0; i < unseen; i++) {
      for (let j = i + 1; j < unseen; j++) pairs.push([remaining[i]!, remaining[j]!])
    }

    // Every pair where that is affordable, and an unbiased sample of them
    // where it is not.
    const tried =
      pairs.length <= RUNOUT_SAMPLE
        ? pairs
        : Array.from({ length: RUNOUT_SAMPLE }, () => pairs[rng.nextInt(pairs.length)]!)

    let ahead = 0
    for (const pair of tried) if (aheadWith(pair)) ahead++
    byRiver = tried.length === 0 ? byNextCard : ahead / tried.length
  }

  return { outs, current, byNextCard, byRiver, toCome }
}

/** Card names for display, e.g. `9 spades and 3 tens`. */
export function summariseOuts(result: OutsResult): string {
  if (result.toCome === 0) return 'no cards to come'
  if (result.current >= FAVOURITE) return 'already ahead'
  if (result.outs.length === 0) return 'no card makes you a favourite'
  return `${result.outs.length} card${result.outs.length === 1 ? '' : 's'} put you ahead`
}
