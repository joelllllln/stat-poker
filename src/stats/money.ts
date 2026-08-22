/**
 * Where the money came from, and where it went.
 *
 * Two cuts of the same record, and the two every tracker opens with. Neither
 * needs grading or a model behind it: both are counted off what happened,
 * which makes them the only figures here that are true whatever the coach
 * thinks.
 */

import { positionName } from '../engine/types'
import type { HandRecord } from '../game/session'

/** Chips a seat won or lost in a hand, in big blinds. */
const wonBB = (record: HandRecord, heroSeat: number): number =>
  (record.state.result?.net[heroSeat] ?? 0) / record.bigBlind

export interface ShowdownSplit {
  /** Big blinds won or lost in hands that were shown down. */
  atShowdown: number
  /** Big blinds won or lost in hands that ended before one. */
  withoutShowdown: number
  showdownHands: number
  otherHands: number
}

/**
 * Winnings split by whether the hand was shown down.
 *
 * Poker's oldest diagnosis, and it works because the two halves come from
 * different skills. Money won without a showdown is money taken by betting —
 * everybody folded. Money won at one is money taken by having the best hand.
 * Somebody who wins at showdown and bleeds everywhere else is not getting
 * unlucky: they are paying to see cards and never taking a pot without them,
 * which is the passive player's signature and invisible in a single winrate.
 */
export function showdownSplit(
  records: readonly HandRecord[],
  heroSeat: number,
): ShowdownSplit {
  const split: ShowdownSplit = {
    atShowdown: 0,
    withoutShowdown: 0,
    showdownHands: 0,
    otherHands: 0,
  }

  for (const record of records) {
    const seat = record.heroSeat ?? heroSeat
    // Shown down by this player: a hand where somebody else showed down while
    // the hero had already folded was not a showdown for the hero.
    const shown = record.stats[seat]?.wentToShowdown ?? false
    if (shown) {
      split.atShowdown += wonBB(record, seat)
      split.showdownHands += 1
    } else {
      split.withoutShowdown += wonBB(record, seat)
      split.otherHands += 1
    }
  }

  return split
}

export interface PositionResult {
  position: string
  hands: number
  netBB: number
  /** Big blinds per hundred hands from this seat. */
  per100: number
}

/**
 * The order a poker table is read in, rather than alphabetically.
 *
 * Blinds first because they are where the money leaves, then the seats in the
 * order they act, and the button last because it is the one that pays.
 */
const READING_ORDER = ['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO', 'BTN']

/**
 * What each seat at the table has been worth.
 *
 * Every tracker opens with this table, and it is usually the fastest way to
 * find a leak: the blinds lose money for everybody, and how much is the
 * question. A player losing far more from the small blind than from the big
 * one is playing too many hands from it.
 */
export function byPosition(
  records: readonly HandRecord[],
  heroSeat: number,
): PositionResult[] {
  const totals = new Map<string, { hands: number; netBB: number }>()

  for (const record of records) {
    const seat = record.heroSeat ?? heroSeat
    const position = positionName(seat, record.buttonSeat, record.state.seats.length)
    const running = totals.get(position) ?? { hands: 0, netBB: 0 }
    running.hands += 1
    running.netBB += wonBB(record, seat)
    totals.set(position, running)
  }

  return [...totals.entries()]
    .map(([position, running]) => ({
      position,
      hands: running.hands,
      netBB: running.netBB,
      per100: (running.netBB / running.hands) * 100,
    }))
    .sort((a, b) => {
      const left = READING_ORDER.indexOf(a.position)
      const right = READING_ORDER.indexOf(b.position)
      // Anything the table does not know about goes last, in its own order.
      return (left < 0 ? READING_ORDER.length : left) - (right < 0 ? READING_ORDER.length : right)
    })
}
