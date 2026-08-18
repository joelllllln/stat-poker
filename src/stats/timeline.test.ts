import { describe, expect, it } from 'vitest'
import { Rng } from '../engine/cards'
import { legalActions } from '../engine/hand'
import {
  createSession,
  defaultSessionConfig,
  heroAct,
  runBotsUntilHero,
  startNextHand,
  type HandRecord,
  type SessionState,
} from '../game/session'
import { toStored } from './serialize'
import { hydrate, handKey, allHands } from './archive'
import {
  BLOCK_SIZE,
  blocks,
  describeMovement,
  movement,
  READINGS,
  sittings,
} from './timeline'

/** Play a session with a random hero so there is a history to cut up. */
function playSession(hands: number, seed = 5): SessionState {
  const session = createSession(defaultSessionConfig(seed))
  const rng = new Rng(seed + 1)

  for (let i = 0; i < hands; i++) {
    startNextHand(session)
    runBotsUntilHero(session)
    let guard = 0
    while (session.current!.result === null && guard++ < 50) {
      if (session.current!.toAct !== session.config.heroSeat) break
      const options = legalActions(session.current!)
      const choice = options[rng.nextInt(options.length)]!
      heroAct(
        session,
        choice.type === 'raise' ? { type: 'raise', to: choice.min! } : { type: choice.type },
      )
      if (session.current!.result === null) runBotsUntilHero(session)
    }
  }
  return session
}

/** Stamp a history with times, one hand a minute from `startedAt`. */
function timestamped(history: HandRecord[], startedAt = 1_700_000_000_000): HandRecord[] {
  return history.map((record, i) => ({ ...record, playedAt: startedAt + i * 60_000 }))
}

describe('the archive', () => {
  it('replays stored hands into records that still carry their statistics', () => {
    const session = playSession(6)
    const stored = session.history.map((record, i) => toStored(record, 1_000 + i))
    const { hands, unreadable } = hydrate(stored)

    expect(unreadable).toBe(0)
    expect(hands).toHaveLength(6)
    for (const [i, hand] of hands.entries()) {
      const original = session.history[i]!
      expect(hand.record.stats).toEqual(original.stats)
      expect(hand.record.heroSeat).toBe(original.heroSeat)
      expect(hand.record.state.board).toEqual(original.state.board)
    }
  })

  it('loses one unreadable hand rather than the history around it', () => {
    const session = playSession(4)
    const stored = session.history.map((record, i) => toStored(record, 1_000 + i))
    stored[1] = { ...stored[1]!, deck: stored[1]!.deck.slice(0, 20) }

    const { hands, unreadable } = hydrate(stored)
    expect(unreadable).toBe(1)
    expect(hands).toHaveLength(3)
  })

  it('reads a hand recorded before the seat was written down', () => {
    const session = playSession(1)
    const stored = toStored(session.history[0]!, 1_000)
    // Version one had no heroSeat: it was always the first seat.
    const old = { ...stored, version: 1 } as Record<string, unknown>
    delete old['heroSeat']

    const { hands, unreadable } = hydrate([old as never])
    expect(unreadable).toBe(0)
    expect(hands[0]!.record.heroSeat).toBe(0)
  })

  it('gives every hand an identity that survives a reload', () => {
    const session = playSession(3)
    const stored = session.history.map((record, i) => toStored(record, 1_000 + i))
    const keys = stored.map(handKey)

    expect(new Set(keys).size).toBe(3)
    // The same identity has to come back from the record the hand replays to,
    // or a cached verdict could never be matched to its hand again.
    const { hands } = hydrate(stored)
    expect(hands.map((hand) => handKey(hand.record))).toEqual(keys)
  })

  it('puts the archive before the hands being played now', () => {
    const older = playSession(2)
    const stored = older.history.map((record, i) => toStored(record, 1_000 + i))
    const live = playSession(2, 11)

    const all = allHands(hydrate(stored).hands, live.history)
    expect(all).toHaveLength(4)
    expect(all[0]!.playedAt).toBe(1_000)
    expect(all[3]!.playedAt).toBeUndefined()
  })

  it('sorts hands by when they were played, not by how they came out of storage', () => {
    const session = playSession(3)
    const stored = session.history.map((record, i) => toStored(record, 3_000 - i * 1_000))
    const { hands } = hydrate(stored)
    expect(hands.map((hand) => hand.playedAt)).toEqual([1_000, 2_000, 3_000])
  })
})

describe('blocks of hands', () => {
  it('cuts a history into blocks and keeps the part-block on the end', () => {
    const session = playSession(BLOCK_SIZE + 4)
    const cut = blocks(session.history)

    expect(cut).toHaveLength(2)
    expect(cut[0]!.hands).toBe(BLOCK_SIZE)
    expect(cut[1]!.hands).toBe(4)
    expect(cut[0]!.from).toBe(1)
    expect(cut[1]!.to).toBe(BLOCK_SIZE + 4)
  })

  it('reports no expected value given up until hands have been graded', () => {
    const session = playSession(8)
    expect(blocks(session.history, 4)[0]!.evLostPer100).toBeNull()

    const graded = session.history.map((record, i) => ({ ...record, evLostBB: i < 4 ? 1 : 0 }))
    const cut = blocks(graded, 4)
    // A big blind given up per hand is a hundred per hundred hands.
    expect(cut[0]!.evLostPer100).toBeCloseTo(100, 6)
    expect(cut[1]!.evLostPer100).toBeCloseTo(0, 6)
    expect(cut[0]!.gradedHands).toBe(4)
  })

  it('has nothing to say about an empty history', () => {
    expect(blocks([])).toEqual([])
    expect(sittings([])).toEqual([])
    expect(describeMovement([])).toBeNull()
  })
})

describe('sittings', () => {
  it('splits where play stopped for a while', () => {
    const session = playSession(6)
    const history = timestamped(session.history)
    // Push the last two hands out to the next evening.
    history[4] = { ...history[4]!, playedAt: history[3]!.playedAt! + 6 * 60 * 60 * 1000 }
    history[5] = { ...history[5]!, playedAt: history[4]!.playedAt! + 60_000 }

    const split = sittings(history)
    expect(split).toHaveLength(2)
    expect(split[0]!.hands).toBe(4)
    expect(split[1]!.hands).toBe(2)
  })

  it('keeps a steady run of hands together', () => {
    const session = playSession(10)
    expect(sittings(timestamped(session.history))).toHaveLength(1)
  })

  it('counts hands not yet written down as part of the sitting happening now', () => {
    const session = playSession(6)
    const history = [...timestamped(session.history.slice(0, 3)), ...session.history.slice(3)]
    const split = sittings(history)

    expect(split).toHaveLength(1)
    expect(split[0]!.hands).toBe(6)
  })
})

describe('movement', () => {
  it('finds a real change when the two halves genuinely differ', () => {
    const session = playSession(60)
    // Second half gives up two big blinds a hand, first half none at all.
    const history = session.history.map((record, i) => ({
      ...record,
      evLostBB: i < 30 ? 0 : 2,
    }))

    const change = movement(history, READINGS.evLost)!
    expect(change.before).toBeCloseTo(0, 6)
    expect(change.after).toBeCloseTo(2, 6)
    expect(change.real).toBe(true)
    expect(describeMovement(history)).toContain('worse')
  })

  it('calls an improvement an improvement', () => {
    const session = playSession(60)
    const history = session.history.map((record, i) => ({
      ...record,
      evLostBB: i < 30 ? 2 : 0,
    }))
    expect(describeMovement(history)).toContain('better')
  })

  it('will not call noise a trend', () => {
    const session = playSession(60)
    // Alternating hands: the halves are identical, so there is nothing to say.
    const history = session.history.map((record, i) => ({
      ...record,
      evLostBB: i % 2 === 0 ? 0 : 2,
    }))

    expect(movement(history, READINGS.evLost)!.real).toBe(false)
    expect(describeMovement(history)).toBeNull()
  })

  it('refuses to compare halves of a handful of hands', () => {
    const session = playSession(3)
    expect(movement(session.history, READINGS.net)).toBeNull()
  })

  it('reads a rate as the share of hands it happened in', () => {
    const session = playSession(40)
    const change = movement(session.history, READINGS.vpip)!
    expect(change.before).toBeGreaterThanOrEqual(0)
    expect(change.before).toBeLessThanOrEqual(1)
  })
})
