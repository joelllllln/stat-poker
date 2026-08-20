import { describe, expect, it } from 'vitest'
import { createSession, runBotsUntilHero, startNextHand, heroAct } from '../game/session'
import { sessionConfigFor, type TableConfig } from '../game/table'
import { legalActions } from '../engine/hand'
import { Rng } from '../engine/cards'
import { exportHands, fromStored, importHands, toStored } from './serialize'
import { MemoryHandStore, importIntoStore } from './storage'
import { hydrate } from './archive'

/**
 * What survives being written down.
 *
 * A hand is stored as the deck and the actions, and everything else — the
 * board, the winner, every statistic — is worked out again by replaying it.
 * That is only safe if the replay reproduces the hand exactly, at every table
 * the app can now deal rather than at the one table it used to have.
 */

const TABLES: TableConfig[] = [
  { seats: 2, smallBlind: 1, bigBlind: 2, buyIn: 200, opponents: ['tag'], random: false },
  { seats: 5, smallBlind: 2, bigBlind: 5, buyIn: 50, opponents: ['maniac', 'nit'], random: false },
  { seats: 9, smallBlind: 25, bigBlind: 50, buyIn: 25_000, opponents: ['lag', 'station'], random: false },
]

/** A session of hands played badly, at a given table. */
function playSome(table: TableConfig, hands: number) {
  const session = createSession(sessionConfigFor(table, 31))
  const rng = new Rng(99)
  for (let hand = 0; hand < hands; hand++) {
    startNextHand(session)
    runBotsUntilHero(session)
    let guard = 0
    while (session.current!.result === null && guard++ < 60) {
      if (session.current!.toAct !== session.config.heroSeat) break
      const options = legalActions(session.current!)
      const pick = options[rng.nextInt(options.length)]!
      heroAct(session, pick.type === 'raise' ? { type: 'raise', to: pick.max! } : { type: pick.type })
      if (session.current!.result === null) runBotsUntilHero(session)
    }
  }
  return session
}

describe('writing a hand down and reading it back', () => {
  it.each(TABLES.map((t) => [`${t.seats}-handed ${t.smallBlind}/${t.bigBlind}`, t] as const))(
    'replays to the same hand: %s',
    (where, table) => {
      const session = playSome(table, 6)
      expect(session.history.length).toBe(6)

      for (const record of session.history) {
        const back = fromStored(JSON.parse(JSON.stringify(toStored(record, 1_700_000_000_000))))
        expect(back.state.board, `${where}: the board`).toEqual(record.state.board)
        expect(back.state.result!.net, `${where}: who won what`).toEqual(record.state.result!.net)
        expect(back.state.result!.pots, `${where}: the pots`).toEqual(record.state.result!.pots)
        expect(back.state.seats.map((s) => s.stack), `${where}: the stacks`).toEqual(
          record.state.seats.map((s) => s.stack),
        )
        expect(back.state.seats.map((s) => s.style), `${where}: who was playing`).toEqual(
          record.state.seats.map((s) => s.style),
        )
        expect(back.stats, `${where}: the statistics`).toEqual(record.stats)
      }
    },
  )

  it('carries a whole session through an export file', async () => {
    const session = playSome(TABLES[2]!, 5)
    const stored = session.history.map((record, i) => toStored(record, 1_700_000_000_000 + i))
    const { hands } = importHands(exportHands(stored))
    expect(hands).toHaveLength(5)
    const { hands: replayed, unreadable } = hydrate(hands)
    expect(unreadable).toBe(0)
    expect(replayed.map((h) => h.record.state.result!.net)).toEqual(
      session.history.map((r) => r.state.result!.net),
    )
  })
})

describe('a history file that is not what it claims to be', () => {
  const good = (seed: number) => {
    const session = playSome(TABLES[0]!, 1)
    return toStored(session.history[0]!, 1_700_000_000_000 + seed)
  }

  it('refuses a file that is not a history at all', () => {
    expect(() => importHands('nonsense')).toThrow()
    expect(() => importHands('{"nope":1}')).toThrow()
    expect(() => importHands('[]')).toThrow()
  })

  it('keeps the readable hands in a file with a broken one in it', async () => {
    const store = new MemoryHandStore()
    const broken = [
      { ...good(1), deck: [1, 2, 3] },
      { ...good(2), seatNames: undefined },
      { version: 99, handNumber: 1, seed: 1 },
      null,
      'not a hand',
    ]
    const json = JSON.stringify({
      version: 3,
      hands: [good(3), ...broken, good(4)],
      estimates: [],
    })

    const added = await importIntoStore(store, json)
    // The two intact hands come through; the wreckage does not take them down,
    // and it is counted rather than quietly dropped.
    expect(added.hands).toHaveLength(2)
    expect(added.unreadable).toBe(broken.length)
    expect((await store.all()).length).toBe(2)

    // And every hand that did come through still replays.
    const { unreadable } = hydrate(added.hands)
    expect(unreadable).toBe(0)
  })
})
