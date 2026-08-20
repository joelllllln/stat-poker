import { describe, expect, it } from 'vitest'
import { ARCHETYPES, ARCHETYPE_IDS } from '../bots/archetypes'
import { Rng } from '../engine/cards'
import { legalActions } from '../engine/hand'
import { potSize } from '../engine/types'
import {
  createSession,
  heroAct,
  runBotsUntilHero,
  startNextHand,
  type SessionState,
} from './session'
import {
  DEFAULT_TABLE,
  MAX_SEATS,
  MAX_STACK_BB,
  MIN_SEATS,
  MIN_STACK_BB,
  faultsIn,
  isPlayable,
  opponentsFor,
  seatsFor,
  sessionConfigFor,
  type TableConfig,
} from './table'

/**
 * Every table the app offers has to be a game.
 *
 * The setup screen lets somebody choose the size, the stakes, the stacks and
 * the opponents, which is a great many more tables than the one this app was
 * built around. A combination that deals a broken hand is not a rare edge
 * case to a player — it is the table they picked.
 */

const table = (over: Partial<TableConfig> = {}): TableConfig => ({ ...DEFAULT_TABLE, ...over })

/** Play a table for a while, taking whatever action is legal. */
function play(config: TableConfig, hands: number, seed: number) {
  const session: SessionState = createSession(sessionConfigFor(config, seed))
  const rng = new Rng(seed + 1)
  let decisions = 0

  for (let hand = 0; hand < hands; hand++) {
    startNextHand(session)
    runBotsUntilHero(session)

    let guard = 0
    while (session.current!.result === null && guard++ < 80) {
      if (session.current!.toAct !== session.config.heroSeat) break
      const options = legalActions(session.current!)
      expect(options.length).toBeGreaterThan(0)
      const choice = options[rng.nextInt(options.length)]!
      heroAct(
        session,
        choice.type === 'raise'
          ? { type: 'raise', to: rng.nextInt(2) === 0 ? choice.min! : choice.max! }
          : { type: choice.type },
      )
      decisions += 1
      if (session.current!.result === null) runBotsUntilHero(session)
    }
    expect(session.current!.result, 'every hand plays to a result').not.toBeNull()
  }

  return { session, decisions }
}

describe('what makes a table playable', () => {
  it('accepts the table the app grew up on', () => {
    expect(faultsIn(DEFAULT_TABLE)).toEqual([])
    expect(isPlayable(DEFAULT_TABLE)).toBe(true)
  })

  it('refuses a table with too few or too many seats', () => {
    expect(faultsIn(table({ seats: MIN_SEATS - 1 }))).toHaveLength(1)
    expect(faultsIn(table({ seats: MAX_SEATS + 1 }))).toHaveLength(1)
    expect(faultsIn(table({ seats: 6.5 }))).toHaveLength(1)
  })

  it('refuses blinds that are not a ladder', () => {
    // Nothing to raise by if the big blind does not exceed the small one.
    expect(faultsIn(table({ smallBlind: 2, bigBlind: 2 })).join(' ')).toContain('bigger than')
    expect(faultsIn(table({ smallBlind: 5, bigBlind: 2 })).join(' ')).toContain('bigger than')
  })

  it('refuses a stack that cannot play', () => {
    // Shorter than ten big blinds is not a game, it is an all-in button.
    const short = table({ buyIn: DEFAULT_TABLE.bigBlind * (MIN_STACK_BB - 1) })
    expect(faultsIn(short).join(' ')).toContain('shortest worth playing')
    const silly = table({ buyIn: DEFAULT_TABLE.bigBlind * (MAX_STACK_BB + 1) })
    expect(faultsIn(silly).join(' ')).toContain('stop at')
  })

  it('refuses an opponent it has never heard of', () => {
    expect(faultsIn(table({ opponents: ['shark'], random: false })).join(' ')).toContain('no player called')
    expect(faultsIn(table({ opponents: [], random: false })).join(' ')).toContain('at least one')
  })

  it('reports every fault at once, so a form is fixed once', () => {
    const hopeless = table({ seats: 99, bigBlind: 1, opponents: [], random: false })
    expect(faultsIn(hopeless).length).toBeGreaterThanOrEqual(3)
  })

  it('will not build a session from a table that cannot be dealt', () => {
    expect(() => sessionConfigFor(table({ seats: 1 }), 1)).toThrow(/cannot be dealt/)
  })
})

describe('who ends up in the seats', () => {
  it('seats the player first and fills the rest from the chosen styles', () => {
    const seats = seatsFor(table({ seats: 4, opponents: ['nit', 'tag', 'lag'], random: false }), 5)
    expect(seats).toHaveLength(4)
    expect(seats[0]).toEqual({ name: 'You', bot: null, hidden: false })
    for (const seat of seats.slice(1)) {
      expect(['nit', 'tag', 'lag']).toContain(seat.bot)
    }
  })

  it('fills a bigger table from one choice', () => {
    // "I want to play maniacs" is one choice, not eight.
    const ids = opponentsFor(table({ seats: 9, opponents: ['maniac'], random: false }), 5)
    expect(ids).toHaveLength(8)
    expect(new Set(ids)).toEqual(new Set(['maniac']))
  })

  it('deals a different mix from the same choice', () => {
    // The mix is drawn rather than dealt round-robin, so two sittings at the
    // same table are two different games. One of each every time is a shape
    // you learn to read instead of learning to play.
    const chosen = table({ seats: 7, opponents: ['nit', 'tag', 'lag', 'station', 'maniac'], random: false })
    const mixes = new Set(
      Array.from({ length: 40 }, (_, seed) => opponentsFor(chosen, seed).join(',')),
    )
    expect(mixes.size).toBeGreaterThan(30)

    // And the counts really do vary: somewhere in there is a style that turned
    // up more than once, which round-robin could never produce at this size.
    const doubled = Array.from({ length: 40 }, (_, seed) => opponentsFor(chosen, seed)).some(
      (ids) => new Set(ids).size < ids.length,
    )
    expect(doubled, 'a style appears more than once').toBe(true)
  })

  it('draws only from the styles that were chosen', () => {
    for (let seed = 0; seed < 50; seed++) {
      const ids = opponentsFor(table({ seats: 9, opponents: ['nit', 'maniac'], random: false }), seed)
      for (const id of ids) expect(['nit', 'maniac']).toContain(id)
    }
  })

  it('is the same table twice from the same seed', () => {
    const chosen = table({ seats: 6, opponents: ['nit', 'lag'], random: false })
    expect(seatsFor(chosen, 99)).toEqual(seatsFor(chosen, 99))
  })

  it('numbers them only when there is more than one', () => {
    const one = seatsFor(table({ seats: 2, opponents: ['nit'], random: false }), 1)
    expect(one[1]!.name).toBe('Rock')

    const several = seatsFor(table({ seats: 4, opponents: ['nit'], random: false }), 1)
    expect(several.slice(1).map((s) => s.name)).toEqual(['Rock 1', 'Rock 2', 'Rock 3'])
  })

  it('gives every seat a distinct name, whatever the mix', () => {
    // Two seats sharing a name would make the history ambiguous, and the
    // stored format keys a seat by its name.
    for (const seats of [2, 5, 9]) {
      for (const random of [false, true]) {
        const names = seatsFor(table({ seats, opponents: ['nit', 'nit', 'tag'], random }), seats).map(
          (s) => s.name,
        )
        expect(new Set(names).size, `${seats}-handed, random ${random}`).toBe(names.length)
      }
    }
  })
})

describe('a table of strangers', () => {
  const strangers = (seats: number, seed: number) =>
    seatsFor(table({ seats, opponents: [], random: true }), seed)

  it('is playable without choosing anybody', () => {
    expect(faultsIn(table({ seats: 6, opponents: [], random: true }))).toEqual([])
    // Where the styles are the table, an empty pool is still a fault.
    expect(faultsIn(table({ seats: 6, opponents: [], random: false }))).not.toEqual([])
  })

  it('draws from every style rather than a chosen few', () => {
    const seen = new Set<string>()
    for (let seed = 0; seed < 60; seed++) {
      for (const id of opponentsFor(table({ seats: 9, opponents: ['nit'], random: true }), seed)) {
        seen.add(id)
      }
    }
    expect(seen).toEqual(new Set(ARCHETYPE_IDS))
  })

  it('never names a seat after how it plays', () => {
    const tells = ARCHETYPE_IDS.flatMap((id) => [id, (ARCHETYPES[id]?.name ?? id).replace(/^The /, '')])
    for (let seed = 0; seed < 30; seed++) {
      for (const seat of strangers(9, seed).slice(1)) {
        for (const tell of tells) {
          expect(seat.name.toLowerCase(), `seed ${seed}`).not.toContain(tell.toLowerCase())
        }
      }
    }
  })

  it('marks every opponent hidden, so nothing draws the style', () => {
    const seats = strangers(6, 3)
    expect(seats[0]!.hidden, 'you know what you are').toBe(false)
    expect(seats.slice(1).every((s) => s.hidden)).toBe(true)
    // A chosen table hides nothing: picking them is the point.
    expect(seatsFor(table({ seats: 6, opponents: ['nit'], random: false }), 3).every((s) => !s.hidden)).toBe(true)
  })

  it('still tells the coach who it is pricing against', () => {
    // Hidden is about the screen, not about the model: a coach that did not
    // know who was in the pot would price every bet against a stranger.
    for (const seat of strangers(6, 11).slice(1)) {
      expect(ARCHETYPE_IDS).toContain(seat.bot)
    }
  })

  it('seats a different set of strangers each time', () => {
    const names = new Set(
      Array.from({ length: 30 }, (_, seed) => strangers(6, seed).slice(1).map((s) => s.name).join(',')),
    )
    expect(names.size).toBeGreaterThan(20)
  })
})

describe('every table it offers deals a real game', () => {
  it('plays out at every size from heads-up to nine-handed', () => {
    for (let seats = MIN_SEATS; seats <= MAX_SEATS; seats++) {
      const { session } = play(table({ seats }), 12, 100 + seats)
      expect(session.history, `${seats}-handed`).toHaveLength(12)

      for (const record of session.history) {
        expect(record.state.seats, `${seats}-handed`).toHaveLength(seats)
        // Chips are conserved: what the seats hold plus what the pot paid out
        // has to equal what they sat down with.
        const net = record.state.result!.net.reduce((sum, chips) => sum + chips, 0)
        expect(Math.abs(net), `${seats}-handed chips`).toBeLessThan(1e-9)
      }
    }
  })

  it('plays at every stake and stack the setup screen allows', () => {
    const stakes = [
      { smallBlind: 1, bigBlind: 2, buyIn: 40 },
      { smallBlind: 1, bigBlind: 3, buyIn: 300 },
      { smallBlind: 25, bigBlind: 50, buyIn: 25_000 },
      { smallBlind: 2, bigBlind: 5, buyIn: 50 },
    ]
    for (const stake of stakes) {
      const { session } = play(table(stake), 10, 7)
      expect(session.history).toHaveLength(10)
      for (const record of session.history) {
        expect(record.bigBlind).toBe(stake.bigBlind)
        expect(potSize(record.state)).toBeGreaterThan(0)
      }
    }
  })

  it('plays against a table made of any one archetype', () => {
    for (const id of ARCHETYPE_IDS) {
      const { session, decisions } = play(table({ seats: 5, opponents: [id], random: false }), 8, 11)
      expect(session.history, id).toHaveLength(8)
      expect(decisions, id).toBeGreaterThan(0)
    }
  })

  it('tops a busted stack back up whatever the table', () => {
    // Short stacks and a big table is where the rebuy rule gets exercised.
    const { session } = play(table({ seats: 9, buyIn: 20 }), 25, 3)
    for (const record of session.history) {
      for (const stack of record.startingStacks) expect(stack).toBeGreaterThan(0)
    }
  })
})

describe('a record made of many different tables', () => {
  /**
   * Somebody who changes tables has one history, not one per table.
   *
   * Every statistic, every stored hand and every verdict has to survive a
   * record whose hands were dealt at different sizes, stakes and stacks —
   * which is a thing that could not happen until the table became a choice,
   * and is now the ordinary case for anybody who tries the setup screen.
   */
  const tables: TableConfig[] = [
    table({ seats: 2, smallBlind: 5, bigBlind: 10, buyIn: 1_000, opponents: ['lag'], random: false }),
    table({ seats: 6 }),
    table({ seats: 9, smallBlind: 1, bigBlind: 2, buyIn: 60, opponents: ['station', 'maniac'], random: false }),
    table({ seats: 3, smallBlind: 25, bigBlind: 50, buyIn: 5_000, opponents: ['nit'], random: false }),
  ]

  const mixedHistory = () =>
    tables.flatMap((config, i) => play(config, 6, 500 + i).session.history)

  it('stores and replays every hand, whatever table it came from', async () => {
    const { toStored } = await import('../stats/serialize')
    const { hydrate } = await import('../stats/archive')

    const history = mixedHistory()
    expect(history).toHaveLength(24)

    const stored = history.map((record, i) => toStored(record, 1_700_000_000_000 + i * 60_000))
    const { hands, unreadable } = hydrate(stored)
    expect(unreadable, 'no hand is unreadable').toBe(0)
    expect(hands).toHaveLength(stored.length)

    for (const [i, rebuilt] of hands.entries()) {
      const original = history[i]!
      expect(rebuilt.record.state.seats).toHaveLength(original.state.seats.length)
      expect(rebuilt.record.bigBlind).toBe(original.bigBlind)
      // The statistics are recomputed on read, so they have to come out the
      // same as the ones derived while it was being played.
      expect(rebuilt.record.stats).toEqual(original.stats)
    }
  })

  it('aggregates statistics across tables in big blinds, not chips', async () => {
    const { aggregate } = await import('../stats/hand-stats')
    const history = mixedHistory()

    // One aggregate over a mixed record has to pick a unit, and the unit is
    // big blinds: a 25/50 hand and a 1/2 hand are the same size of win at ten
    // big blinds, and totalling their chips would say otherwise.
    const stats = aggregate(
      history.map((record) => record.stats[record.heroSeat]!),
      2,
    )
    expect(stats.hands).toBe(history.length)
    expect(Number.isFinite(stats.vpip)).toBe(true)
    expect(stats.vpip).toBeGreaterThanOrEqual(0)
    expect(stats.vpip).toBeLessThanOrEqual(100)
  })

  it('grades a hand from any of them without failing', async () => {
    const { gradeHand } = await import('../coach/grade')
    for (const record of mixedHistory()) {
      const graded = gradeHand(record, record.heroSeat)
      expect(Number.isFinite(graded.totalEvLossBB), `${record.state.seats.length}-handed`).toBe(true)
      expect(graded.totalEvLossBB).toBeGreaterThanOrEqual(0)
    }
  })
})
