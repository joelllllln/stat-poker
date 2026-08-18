/**
 * The hands behind you.
 *
 * A session in the browser is one sitting; a player's game is all of them.
 * This is what turns stored hands back into statistics, so the dashboard
 * describes how somebody plays rather than how they have played since the last
 * time they reloaded the page.
 *
 * Nothing here is a second copy of the statistics. Stored hands carry only
 * what replay needs, so every number is recomputed from the hand itself — an
 * improvement to a definition reaches hands recorded months ago.
 */

import type { HandRecord } from '../game/session'
import { fromStored, type StoredHand } from './serialize'

/** A hand read back from storage, with the identity its cache entries use. */
export interface ArchivedHand {
  record: HandRecord
  playedAt: number
  /**
   * Stable identity for one hand.
   *
   * Hand numbers restart every sitting, so they identify nothing on their own.
   * The seed makes two hands played in the same millisecond distinguishable,
   * which matters because the whole archive is keyed on this.
   */
  key: string
}

export const handKey = (hand: {
  playedAt?: number
  handNumber: number
  seed: number
}): string => `${hand.playedAt ?? 0}:${hand.handNumber}:${hand.seed}`

export interface Hydrated {
  hands: ArchivedHand[]
  /**
   * Hands that would not replay.
   *
   * Counted rather than thrown, because one unreadable hand should cost you
   * that hand and not the history it sits in.
   */
  unreadable: number
}

/** Replay stored hands into records, oldest first. */
export function hydrate(stored: readonly StoredHand[]): Hydrated {
  const hands: ArchivedHand[] = []
  let unreadable = 0

  for (const hand of stored) {
    try {
      hands.push({
        record: { ...fromStored(hand), playedAt: hand.playedAt },
        playedAt: hand.playedAt,
        key: handKey(hand),
      })
    } catch {
      unreadable += 1
    }
  }

  hands.sort((a, b) => a.playedAt - b.playedAt)
  return { hands, unreadable }
}

/**
 * Every hand a player has, oldest first: the archive followed by this sitting.
 *
 * Live hands that have not been written down yet have no timestamp, so they
 * sort after everything — which is where they belong, being the most recent
 * thing that happened.
 */
export function allHands(
  archive: readonly ArchivedHand[],
  live: readonly HandRecord[],
): HandRecord[] {
  return [...archive.map((hand) => hand.record), ...live]
}
