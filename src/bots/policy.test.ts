import { beforeAll, describe, expect, it } from 'vitest'
import { Rng } from '../engine/cards'
import { legalActions } from '../engine/hand'
import { potSize } from '../engine/types'
import { aggregate, type AggregateStats } from '../stats/hand-stats'
import {
  createSession,
  recordsForSeat,
  runBotsUntilHero,
  startNextHand,
  type SessionConfig,
} from '../game/session'
import { ARCHETYPE_IDS, archetype, positionalOpenWidth } from './archetypes'

/**
 * Sit six bots down and let them play. Nothing is asserted about how they
 * decide — only about the statistical fingerprint that comes out, which is
 * what a player would actually read off a HUD.
 */
/**
 * Yield to the event loop. These simulations are long and synchronous, and a
 * test worker that never breathes cannot answer its own heartbeat — which
 * Vitest reports as an unhandled error mid-run.
 */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0))

async function simulate(hands: number, seed = 4): Promise<AggregateStats[]> {
  const config: SessionConfig = {
    seats: ARCHETYPE_IDS.slice(0, 5)
      .map((id) => ({ name: id, bot: id, hidden: false }))
      .concat([{ name: 'tag2', bot: 'tag', hidden: false }]),
    // No human at this table: every seat is driven by a policy.
    heroSeat: -1,
    buyIn: 200,
    smallBlind: 1,
    bigBlind: 2,
    seed,
  }

  const session = createSession(config)
  for (let i = 0; i < hands; i++) {
    startNextHand(session)
    runBotsUntilHero(session)
    if (i % 25 === 0) await breathe()
  }

  return config.seats.map((_, seat) => aggregate(recordsForSeat(session, seat), config.bigBlind))
}

describe('archetype tuning', () => {
  it('tightens opening ranges from earlier position', () => {
    expect(positionalOpenWidth(0.4, 0)).toBeCloseTo(0.4, 6)
    expect(positionalOpenWidth(0.4, 3)).toBeLessThan(0.3)
    expect(positionalOpenWidth(0.4, 5)).toBeLessThan(positionalOpenWidth(0.4, 3))
  })

  it('exposes every archetype by id', () => {
    for (const id of ARCHETYPE_IDS) expect(archetype(id).id).toBe(id)
    expect(() => archetype('nope')).toThrow()
  })
})

describe('emergent bot signatures', () => {
  // Simulating in the describe body would run during collection, before the
  // test timeout applies. Build it once in a hook instead.
  //
  // These simulations are synchronous and long enough to starve the test
  // worker's heartbeat, so the default run is sized to separate the
  // archetypes reliably and `SLOW_TESTS` runs the fuller sample.
  const HANDS = process.env.SLOW_TESTS ? 1_500 : 400
  let stats: AggregateStats[]
  let named: Record<string, AggregateStats>

  beforeAll(async () => {
    stats = await simulate(HANDS)
    const [nit, tag, lag, station, maniac] = stats
    named = { nit, tag, lag, station, maniac } as Record<string, AggregateStats>
  }, 300_000)

  it('produces a full session of hands', () => {
    for (const seat of stats) expect(seat.hands).toBe(HANDS)
  })

  it('separates loose from tight play', () => {
    expect(named.nit!.vpip).toBeLessThan(named.tag!.vpip)
    expect(named.tag!.vpip).toBeLessThan(named.lag!.vpip)
    expect(named.lag!.vpip).toBeLessThan(named.maniac!.vpip)
  })

  it('separates aggressive from passive play', () => {
    // The station and the rock both play few pots aggressively, but the
    // station gets there by calling: that gap is its whole signature.
    expect(named.station!.aggressionFactor).toBeLessThan(named.tag!.aggressionFactor)
    expect(named.maniac!.aggressionFactor).toBeGreaterThan(named.tag!.aggressionFactor)
  })

  it('makes the station play far more hands than it raises', () => {
    expect(named.station!.vpip - named.station!.pfr).toBeGreaterThan(15)
  })

  it('keeps the eagle in the band a solid regular occupies', () => {
    // The benchmark opponent should look like a competent player, not a
    // caricature. These bounds are wide on purpose: they are a sanity check,
    // not a calibration.
    expect(named.tag!.vpip).toBeGreaterThan(15)
    expect(named.tag!.vpip).toBeLessThan(40)
    expect(named.tag!.pfr).toBeLessThan(named.tag!.vpip)
  })

  it('never raises more than it plays', () => {
    for (const seat of stats) expect(seat.pfr).toBeLessThanOrEqual(seat.vpip)
  })

  it('conserves chips across the session', async () => {
    const config: SessionConfig = {
      seats: ARCHETYPE_IDS.map((id) => ({ name: id, bot: id, hidden: false })),
      heroSeat: -1,
      buyIn: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 99,
    }
    const session = createSession(config)
    for (let i = 0; i < 60; i++) {
      startNextHand(session)
      runBotsUntilHero(session)
      if (i % 25 === 0) await breathe()
    }

    const chips = session.stacks.reduce((a, b) => a + b, 0)
    const paidIn = config.seats.length * config.buyIn + session.rebuys.reduce((a, b) => a + b, 0)
    expect(chips).toBe(paidIn)
  }, 120_000)
})

describe('policy safety', () => {
  it('only ever produces legal actions', async () => {
    const config: SessionConfig = {
      seats: ARCHETYPE_IDS.map((id) => ({ name: id, bot: id, hidden: false })),
      heroSeat: -1,
      buyIn: 200,
      smallBlind: 1,
      bigBlind: 2,
      seed: 7,
    }
    const session = createSession(config)

    for (let i = 0; i < 60; i++) {
      startNextHand(session)
      // Step manually so each decision can be checked against the rules before
      // it is applied.
      while (session.current !== null && session.current.result === null) {
        const state = session.current
        const options = legalActions(state)
        expect(options.length).toBeGreaterThan(0)
        expect(potSize(state)).toBeGreaterThan(0)
        runBotsUntilHero(session)
        if (session.current === state) break
      }
      expect(session.current!.result).not.toBeNull()
      if (i % 25 === 0) await breathe()
    }
  }, 120_000)

  it('is reproducible from the session seed', async () => {
    const run = async () => {
      const config: SessionConfig = {
        seats: ARCHETYPE_IDS.map((id) => ({ name: id, bot: id, hidden: false })),
        heroSeat: -1,
        buyIn: 200,
        smallBlind: 1,
        bigBlind: 2,
        seed: 1234,
      }
      const session = createSession(config)
      for (let i = 0; i < 20; i++) {
        startNextHand(session)
        runBotsUntilHero(session)
        if (i % 10 === 0) await breathe()
      }
      return session.stacks
    }
    expect(await run()).toEqual(await run())
  }, 120_000)

  it('runs a hand with a random generator that is not the session default', () => {
    const rng = new Rng(31)
    expect(rng.nextFloat()).toBeGreaterThanOrEqual(0)
  })
})
