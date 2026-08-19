/**
 * Hand history storage format.
 *
 * Only what replay needs is stored: the deck, the actions, the stacks the hand
 * was dealt with, and the table it was played at. Everything else — the board,
 * who won, every statistic, every verdict — is recomputed from those by
 * replaying the hand.
 *
 * That is what makes improving a stat or a grading rule apply retroactively to
 * the whole history rather than only to hands played afterwards.
 */

import { NUM_CARDS, type Card } from '../engine/cards'
import { applyAction, startHandWithDeck } from '../engine/hand'
import type { Action, HandState } from '../engine/types'
import { DEFAULT_SEAT_STYLES, type HandRecord } from '../game/session'
import type { Estimate } from './estimates'
import { deriveHandStats } from './hand-stats'

export const SCHEMA_VERSION = 3

export interface StoredHand {
  version: number
  handNumber: number
  /** Milliseconds since the epoch, supplied by the caller. */
  playedAt: number
  buttonSeat: number
  smallBlind: number
  bigBlind: number
  /** Which seat the person was sitting in: whose statistics these are. */
  heroSeat: number
  seatNames: string[]
  /**
   * How each seat played, as an archetype id, or null for the person.
   *
   * The coach prices a bet against the opponents it is facing, so a hand that
   * did not remember who was at the table would be regraded against a
   * different one every time it was read back.
   */
  seatStyles: (string | null)[]
  startingStacks: number[]
  /** The shuffled deck, which is all replay needs to reproduce every card. */
  deck: number[]
  actions: { seat: number; type: Action['type']; to?: number }[]
  /** Seed the deck came from, kept for provenance rather than for replay. */
  seed: number
}

export function toStored(record: HandRecord, playedAt: number): StoredHand {
  return {
    version: SCHEMA_VERSION,
    handNumber: record.handNumber,
    playedAt,
    buttonSeat: record.buttonSeat,
    heroSeat: record.heroSeat,
    smallBlind: record.smallBlind,
    bigBlind: record.bigBlind,
    seatNames: record.state.seats.map((s) => s.name),
    seatStyles: record.state.seats.map((s) => s.style),
    startingStacks: [...record.startingStacks],
    deck: [...record.state.deck],
    actions: record.state.actions.map((entry) =>
      entry.action.type === 'raise'
        ? { seat: entry.seat, type: entry.action.type, to: entry.action.to }
        : { seat: entry.seat, type: entry.action.type },
    ),
    seed: record.seed,
  }
}

function assertValid(stored: StoredHand): void {
  if (stored.seatNames.length !== stored.startingStacks.length) {
    throw new Error('Stored hand has mismatched seats and stacks')
  }
  if (stored.deck.length !== NUM_CARDS) {
    throw new Error(`Stored hand has ${stored.deck.length} cards, expected ${NUM_CARDS}`)
  }
  if (new Set(stored.deck).size !== NUM_CARDS) {
    throw new Error('Stored hand has a deck with duplicates')
  }
}

/**
 * Rebuild a full record by replaying the stored hand.
 *
 * A corrupt or truncated hand throws rather than producing a half-hand: a
 * silently wrong history is worse than a missing one.
 */
export function fromStored(stored: StoredHand): HandRecord {
  const migrated = migrate(stored)
  assertValid(migrated)

  let state: HandState = startHandWithDeck(
    {
      seats: migrated.seatNames.map((name, i) => ({
        name,
        style: migrated.seatStyles[i] ?? null,
        stack: migrated.startingStacks[i]!,
      })),
      buttonSeat: migrated.buttonSeat,
      smallBlind: migrated.smallBlind,
      bigBlind: migrated.bigBlind,
    },
    migrated.deck as Card[],
  )

  for (const entry of migrated.actions) {
    const action: Action =
      entry.type === 'raise' ? { type: 'raise', to: entry.to! } : { type: entry.type }
    state = applyAction(state, action)
  }

  if (state.result === null) throw new Error('Stored hand does not play out to completion')

  return {
    handNumber: migrated.handNumber,
    seed: migrated.seed,
    buttonSeat: migrated.buttonSeat,
    heroSeat: migrated.heroSeat,
    startingStacks: migrated.startingStacks,
    smallBlind: migrated.smallBlind,
    bigBlind: migrated.bigBlind,
    state,
    stats: deriveHandStats(state),
  }
}

/**
 * Bring an older stored hand up to the current schema.
 *
 * Version one did not record which seat the person sat in, because at the time
 * there was only ever one table and they always sat in the first seat. Filling
 * that in is what lets a history recorded then still be read as somebody's
 * statistics rather than as six anonymous players.
 *
 * Version two did not record how each seat played, because nothing read it.
 * The coach does now — it prices its bets against the opponents it is actually
 * facing — so an older hand is matched back to the table it was dealt at by
 * name. Every one of them was dealt at that table; a seat that does not match
 * simply has no style, and grades by the generic rule.
 */
export function migrate(stored: StoredHand): StoredHand {
  if (stored.version > SCHEMA_VERSION) {
    throw new Error(
      `Hand was written by a newer version (${stored.version} > ${SCHEMA_VERSION})`,
    )
  }
  if (stored.version === SCHEMA_VERSION) return stored
  return {
    ...stored,
    heroSeat: stored.heroSeat ?? 0,
    seatStyles:
      stored.seatStyles ?? stored.seatNames.map((name) => DEFAULT_SEAT_STYLES[name] ?? null),
    version: SCHEMA_VERSION,
  }
}

/** The whole record as a portable JSON document. */
export function exportHands(hands: StoredHand[], estimates: Estimate[] = []): string {
  return JSON.stringify({ version: SCHEMA_VERSION, hands, estimates }, null, 0)
}

export function importHands(json: string): { hands: StoredHand[]; estimates: Estimate[] } {
  const parsed: unknown = JSON.parse(json)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { hands?: unknown }).hands)
  ) {
    throw new Error('Not a stat-poker history file')
  }
  const document = parsed as { hands: StoredHand[]; estimates?: Estimate[] }
  return {
    hands: document.hands.map(migrate),
    // Files written before guesses were recorded simply have none.
    estimates: Array.isArray(document.estimates) ? document.estimates : [],
  }
}
