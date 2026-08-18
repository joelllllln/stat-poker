import { describe, expect, it } from 'vitest'
import { legalActions } from '../engine/hand'
import { Rng } from '../engine/cards'
import {
  createSession,
  defaultSessionConfig,
  heroAct,
  recordsForSeat,
  runBotsUntilHero,
  startNextHand,
  type SessionState,
} from '../game/session'
import { aggregate } from './hand-stats'
import {
  STREET_SAMPLE,
  buildProfile,
  classifyMastery,
  classifyStyle,
  handsForPrecision,
  rateInterval,
  styleByStreet,
  styleContradiction,
  winrateInterval,
} from './profile'
import { exportHands, fromStored, importHands, migrate, toStored } from './serialize'
import { MemoryHandStore, exportStore, importIntoStore } from './storage'

/** Play a session with a simple hero policy so there is history to work on. */
function playSession(hands: number, seed = 31): SessionState {
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

describe('style classification', () => {
  const stats = (vpip: number, pfr: number) => ({ ...aggregate([], 2), vpip, pfr, hands: 500 })

  it('separates the four shapes', () => {
    expect(classifyStyle(stats(12, 10)).id).toBe('eagle') // tight, aggressive
    expect(classifyStyle(stats(12, 3)).id).toBe('rock') // tight, passive
    expect(classifyStyle(stats(45, 40)).id).toBe('hawk') // loose, aggressive
    expect(classifyStyle(stats(45, 8)).id).toBe('fish') // loose, passive
  })

  it('judges aggression by the share of played hands raised, not raw PFR', () => {
    // 20% PFR is aggressive on a 25% VPIP and passive on a 60% one.
    expect(classifyStyle(stats(25, 20)).aggression).toBe('aggressive')
    expect(classifyStyle(stats(60, 20)).aggression).toBe('passive')
  })
})

describe('mastery tiers', () => {
  it('ranks by expected value given up', () => {
    expect(classifyMastery(0.5).id).toBe('elite')
    expect(classifyMastery(3).id).toBe('strong')
    expect(classifyMastery(6).id).toBe('solid')
    expect(classifyMastery(12).id).toBe('amateur')
    expect(classifyMastery(30).id).toBe('fish')
  })

  it('combines both axes into one label', () => {
    const profile = buildProfile({ ...aggregate([], 2), vpip: 45, pfr: 35, hands: 300 }, 6)
    expect(profile.label).toBe('Loose-Aggressive · Solid')
    expect(profile.reliable).toBe(true)
  })

  it('marks a small sample unreliable', () => {
    expect(buildProfile({ ...aggregate([], 2), vpip: 20, pfr: 15, hands: 10 }, 3).reliable).toBe(
      false,
    )
  })
})

describe('style street by street', () => {
  const decisions = (street: string, action: string, count: number) =>
    Array.from({ length: count }, () => ({ street, action }))

  it('reads each street separately', () => {
    const styles = styleByStreet([
      ...decisions('preflop', 'fold', 40),
      ...decisions('turn', 'raise', 40),
    ])

    expect(styles.map((s) => s.street)).toEqual(['preflop', 'turn'])
    expect(styles[0]!.label).toBe('tight')
    expect(styles[1]!.label).toBe('wild')
  })

  it('keeps the streets in the order they are played', () => {
    const styles = styleByStreet([
      ...decisions('river', 'call', 30),
      ...decisions('preflop', 'call', 30),
      ...decisions('flop', 'call', 30),
    ])
    expect(styles.map((s) => s.street)).toEqual(['preflop', 'flop', 'river'])
  })

  it('names the contradiction between two streets', () => {
    const contradiction = styleContradiction(
      styleByStreet([
        ...decisions('preflop', 'fold', 40),
        ...decisions('turn', 'raise', 40),
      ]),
    )
    expect(contradiction).toContain('preflop')
    expect(contradiction).toContain('turn')
  })

  it('stays quiet when the streets are played alike', () => {
    const even = styleByStreet([
      ...decisions('preflop', 'call', 40),
      ...decisions('turn', 'call', 40),
    ])
    expect(styleContradiction(even)).toBeNull()
  })

  it('will not call a handful of decisions a style', () => {
    const thin = styleByStreet([
      ...decisions('preflop', 'fold', STREET_SAMPLE - 1),
      ...decisions('turn', 'raise', STREET_SAMPLE - 1),
    ])
    expect(styleContradiction(thin)).toBeNull()
  })

  it('handles a player who has done nothing yet', () => {
    expect(styleByStreet([])).toEqual([])
    expect(styleContradiction([])).toBeNull()
  })
})

describe('confidence intervals', () => {
  it('never reports an impossible rate', () => {
    // The normal approximation would put the lower bound below zero here.
    const [low, high] = rateInterval(1, 5)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(100)
  })

  it('narrows as the sample grows', () => {
    const small = rateInterval(25, 50)
    const large = rateInterval(2_500, 5_000)
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0])
  })

  it('brackets the observed rate', () => {
    const [low, high] = rateInterval(30, 100)
    expect(low).toBeLessThan(30)
    expect(high).toBeGreaterThan(30)
  })

  it('measures a winrate interval from the observed spread', () => {
    const session = playSession(40)
    const records = recordsForSeat(session, session.config.heroSeat)
    const interval = winrateInterval(records, session.config.bigBlind)

    expect(interval.low).toBeLessThanOrEqual(interval.bbPer100)
    expect(interval.high).toBeGreaterThanOrEqual(interval.bbPer100)
    expect(interval.standardDeviation).toBeGreaterThan(0)
  })

  it('shows how many hands a meaningful winrate needs', () => {
    // At a realistic spread, resolving a winrate to ±5bb/100 takes tens of
    // thousands of hands. This is the number the dashboard exists to admit.
    expect(handsForPrecision(100, 10)).toBeGreaterThan(1_000)
    expect(handsForPrecision(100, 10)).toBeLessThan(10_000)
    expect(handsForPrecision(100, 2)).toBeGreaterThan(30_000)
  })
})

describe('hand history storage', () => {
  it('round-trips a hand through storage without losing anything', () => {
    const session = playSession(6)
    for (const record of session.history) {
      const restored = fromStored(toStored(record, 0))

      expect(restored.state.board).toEqual(record.state.board)
      expect(restored.state.result!.net).toEqual(record.state.result!.net)
      expect(restored.state.seats.map((s) => s.holeCards)).toEqual(
        record.state.seats.map((s) => s.holeCards),
      )
      expect(restored.stats).toEqual(record.stats)
    }
  })

  it('stores only what replay needs', () => {
    const session = playSession(2)
    const stored = toStored(session.history[0]!, 0)
    // No board, no winners, no statistics — all recomputed on read.
    expect(Object.keys(stored).sort()).toEqual(
      [
        'actions',
        'bigBlind',
        'buttonSeat',
        'deck',
        'handNumber',
        'playedAt',
        'seatNames',
        'seed',
        'smallBlind',
        'startingStacks',
        'version',
      ].sort(),
    )
  })

  it('stays small', () => {
    const session = playSession(2)
    const bytes = JSON.stringify(toStored(session.history[0]!, 0)).length
    expect(bytes).toBeLessThan(1_000)
  })

  it('rejects a corrupt deck rather than replaying half a hand', () => {
    const session = playSession(1)
    const stored = toStored(session.history[0]!, 0)

    expect(() => fromStored({ ...stored, deck: stored.deck.slice(0, 20) })).toThrow(/52/)
    expect(() =>
      fromStored({ ...stored, deck: [...stored.deck.slice(0, 51), stored.deck[0]!] }),
    ).toThrow(/duplicate/)
  })

  it('refuses a hand written by a newer schema', () => {
    const session = playSession(1)
    const stored = toStored(session.history[0]!, 0)
    expect(() => migrate({ ...stored, version: 99 })).toThrow(/newer version/)
  })

  it('exports and imports a whole history', () => {
    const session = playSession(5)
    const stored = session.history.map((record) => toStored(record, 0))
    const restored = importHands(exportHands(stored))

    expect(restored).toHaveLength(stored.length)
    expect(restored.map((h) => h.deck)).toEqual(stored.map((h) => h.deck))
  })

  it('rejects a file that is not a history', () => {
    expect(() => importHands('{"nope":1}')).toThrow(/not a stat-poker history/i)
    expect(() => importHands('[]')).toThrow()
  })
})

describe('the store', () => {
  it('keeps hands and counts them', async () => {
    const store = new MemoryHandStore()
    const session = playSession(4)
    await store.putMany(session.history.map((record) => toStored(record, 0)))

    expect(await store.count()).toBe(4)
    expect(await store.all()).toHaveLength(4)

    await store.clear()
    expect(await store.count()).toBe(0)
  })

  it('moves a history between stores through an export', async () => {
    const source = new MemoryHandStore()
    const session = playSession(3)
    await source.putMany(session.history.map((record) => toStored(record, 0)))

    const destination = new MemoryHandStore()
    const imported = await importIntoStore(destination, await exportStore(source))

    expect(imported).toBe(3)
    expect(await destination.count()).toBe(3)

    // Everything that came back must still replay.
    for (const hand of await destination.all()) {
      expect(fromStored(hand).state.result).not.toBeNull()
    }
  })

  it('recomputes statistics on read, so improvements apply to old hands', async () => {
    const store = new MemoryHandStore()
    const session = playSession(4)
    await store.putMany(session.history.map((record) => toStored(record, 0)))

    const rebuilt = (await store.all()).map(fromStored)
    const fromStorage = aggregate(
      rebuilt.map((r) => r.stats[session.config.heroSeat]!),
      2,
    )
    const live = aggregate(recordsForSeat(session, session.config.heroSeat), 2)

    expect(fromStorage).toEqual(live)
  })
})
