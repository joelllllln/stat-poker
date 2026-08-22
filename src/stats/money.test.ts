import { describe, expect, it } from 'vitest'
import { Rng } from '../engine/cards'
import { legalActions } from '../engine/hand'
import {
  createSession,
  defaultSessionConfig,
  heroAct,
  runBotsUntilHero,
  startNextHand,
} from '../game/session'
import { byPosition, showdownSplit } from './money'
import type { HandRecord } from '../game/session'

/** A session played badly enough to produce both kinds of hand. */
function playSession(hands = 60, seed = 7) {
  const session = createSession(defaultSessionConfig(seed))
  const rng = new Rng(seed + 1)
  for (let hand = 0; hand < hands; hand++) {
    startNextHand(session)
    runBotsUntilHero(session)
    let guard = 0
    while (session.current!.result === null && guard++ < 40) {
      if (session.current!.toAct !== session.config.heroSeat) break
      const options = legalActions(session.current!)
      const pick = options[rng.nextInt(options.length)]!
      heroAct(session, pick.type === 'raise' ? { type: 'raise', to: pick.min! } : { type: pick.type })
      if (session.current!.result === null) runBotsUntilHero(session)
    }
  }
  return session.history
}

const total = (records: readonly HandRecord[], seat: number) =>
  records.reduce((sum, r) => sum + (r.state.result?.net[seat] ?? 0) / r.bigBlind, 0)

describe('winnings split by whether it was shown down', () => {
  it('accounts for every hand exactly once', () => {
    const records = playSession()
    const split = showdownSplit(records, 0)
    expect(split.showdownHands + split.otherHands).toBe(records.length)
  })

  it('adds back up to what was won overall', () => {
    const records = playSession()
    const split = showdownSplit(records, 0)
    expect(split.atShowdown + split.withoutShowdown).toBeCloseTo(total(records, 0), 6)
  })

  it('reads showdowns from the hero rather than from the table', () => {
    // A hand where two other seats showed down while the hero had folded is
    // not a showdown for the hero, and counting it as one would credit them
    // with money taken at a showdown they were not in.
    const records = playSession()
    for (const record of records) {
      const mine = record.stats[record.heroSeat]!
      if (record.state.seats[record.heroSeat]!.status === 'folded') {
        expect(mine.wentToShowdown, `hand ${record.handNumber}`).toBe(false)
      }
    }
  })

  it('says nothing about an empty record', () => {
    expect(showdownSplit([], 0)).toEqual({
      atShowdown: 0,
      withoutShowdown: 0,
      showdownHands: 0,
      otherHands: 0,
    })
  })
})

describe('what each seat has been worth', () => {
  it('accounts for every hand exactly once', () => {
    const records = playSession()
    const seats = byPosition(records, 0)
    expect(seats.reduce((sum, seat) => sum + seat.hands, 0)).toBe(records.length)
  })

  it('adds back up to what was won overall', () => {
    const records = playSession()
    const seats = byPosition(records, 0)
    expect(seats.reduce((sum, seat) => sum + seat.netBB, 0)).toBeCloseTo(total(records, 0), 6)
  })

  it('reads the rate off the hands that seat was actually dealt', () => {
    const seats = byPosition(playSession(), 0)
    for (const seat of seats) {
      expect(seat.per100).toBeCloseTo((seat.netBB / seat.hands) * 100, 6)
    }
  })

  it('puts the seats in the order a table is read, blinds first', () => {
    const order = byPosition(playSession(), 0).map((seat) => seat.position)
    expect(order[0]).toBe('SB')
    expect(order[1]).toBe('BB')
    expect(order.at(-1)).toBe('BTN')
  })

  it('finds every seat at the table over a long enough session', () => {
    // Six seats, and the button moves every hand, so sixty hands visits them
    // all ten times over.
    expect(byPosition(playSession(), 0)).toHaveLength(6)
  })

  it('says nothing about an empty record', () => {
    expect(byPosition([], 0)).toEqual([])
  })
})
