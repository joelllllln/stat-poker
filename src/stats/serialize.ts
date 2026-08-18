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
import type { HandRecord } from '../game/session'
import type { Estimate } from './estimates'
import { deriveHandStats } from './hand-stats'

export const SCHEMA_VERSION = 1

export interface StoredHand {
  version: number
  handNumber: number
  /** Milliseconds since the epoch, supplied by the caller. */
  playedAt: number
  buttonSeat: number
  smallBlind: number
  bigBlind: number
  seatNames: string[]
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
    smallBlind: record.smallBlind,
    bigBlind: record.bigBlind,
    seatNames: record.state.seats.map((s) => s.name),
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
 * There is only one version so far; the seam exists from the start so that
 * adding a second never means asking people to throw away their history.
 */
export function migrate(stored: StoredHand): StoredHand {
  if (stored.version > SCHEMA_VERSION) {
    throw new Error(
      `Hand was written by a newer version (${stored.version} > ${SCHEMA_VERSION})`,
    )
  }
  return stored
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
