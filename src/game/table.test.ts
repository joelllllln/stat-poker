import { describe, expect, it } from 'vitest'
import { ARCHETYPE_IDS } from '../bots/archetypes'
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
    expect(faultsIn(table({ opponents: ['shark'] })).join(' ')).toContain('no player called')
    expect(faultsIn(table({ opponents: [] })).join(' ')).toContain('at least one')
  })

  it('reports every fault at once, so a form is fixed once', () => {
    const hopeless = table({ seats: 99, bigBlind: 1, opponents: [] })
    expect(faultsIn(hopeless).length).toBeGreaterThanOrEqual(3)
  })

  it('will not build a session from a table that cannot be dealt', () => {
    expect(() => sessionConfigFor(table({ seats: 1 }), 1)).toThrow(/cannot be dealt/)
  })
})

describe('who ends up in the seats', () => {
  it('seats the player first and fills the rest from the chosen opponents', () => {
    const seats = seatsFor(table({ seats: 4, opponents: ['nit', 'tag', 'lag'] }))
    expect(seats).toHaveLength(4)
    expect(seats[0]).toEqual({ name: 'You', bot: null })
    expect(seats.slice(1).map((s) => s.bot)).toEqual(['nit', 'tag', 'lag'])
  })

  it('repeats the choice to fill a bigger table', () => {
    // "I want to play maniacs" is one choice, not eight.
    const ids = opponentsFor(table({ seats: 9, opponents: ['maniac'] }))
    expect(ids).toHaveLength(8)
    expect(new Set(ids)).toEqual(new Set(['maniac']))
  })

  it('numbers them only when there is more than one', () => {
    const one = seatsFor(table({ seats: 2, opponents: ['nit'] }))
    expect(one[1]!.name).toBe('Rock')

    const several = seatsFor(table({ seats: 4, opponents: ['nit'] }))
    expect(several.slice(1).map((s) => s.name)).toEqual(['Rock 1', 'Rock 2', 'Rock 3'])
  })

  it('gives every seat a distinct name, whatever the mix', () => {
    // Two seats sharing a name would make the history ambiguous, and the
    // stored format keys a seat by its name.
    for (const seats of [2, 5, 9]) {
      const names = seatsFor(table({ seats, opponents: ['nit', 'nit', 'tag'] })).map((s) => s.name)
      expect(new Set(names).size, `${seats}-handed`).toBe(names.length)
    }
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
      const { session, decisions } = play(table({ seats: 5, opponents: [id] }), 8, 11)
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
