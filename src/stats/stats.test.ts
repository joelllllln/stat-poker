import { describe, expect, it } from 'vitest'
import { applyAction, legalActions, startHandWithDeck } from '../engine/hand'
import { freshDeck, parseCards, Rng, type Card } from '../engine/cards'
import type { Action, HandState } from '../engine/types'
import {
  createSession,
  defaultSessionConfig,
  heroAct,
  recordsForSeat,
  runBotsUntilHero,
  startNextHand,
  type SessionState,
} from '../game/session'
import { aggregate, deriveHandStats } from './hand-stats'
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

/**
 * Let the worker answer its heartbeat between hands.
 *
 * A test that plays hundreds of hands without yielding holds the event loop
 * for long enough that the worker cannot reply to the runner.
 */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Play a session with a simple hero policy so there is history to work on. */
async function playSession(hands: number, seed = 31): Promise<SessionState> {
  const session = createSession(defaultSessionConfig(seed))
  const rng = new Rng(seed + 1)

  for (let i = 0; i < hands; i++) {
    if (i % 20 === 0) await breathe()
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

  it('separates the four shapes', async () => {
    expect(classifyStyle(stats(12, 10)).id).toBe('eagle') // tight, aggressive
    expect(classifyStyle(stats(12, 3)).id).toBe('rock') // tight, passive
    expect(classifyStyle(stats(45, 40)).id).toBe('hawk') // loose, aggressive
    expect(classifyStyle(stats(45, 8)).id).toBe('fish') // loose, passive
  })

  it('judges aggression by the share of played hands raised, not raw PFR', async () => {
    // 20% PFR is aggressive on a 25% VPIP and passive on a 60% one.
    expect(classifyStyle(stats(25, 20)).aggression).toBe('aggressive')
    expect(classifyStyle(stats(60, 20)).aggression).toBe('passive')
  })
})

describe('mastery tiers', () => {
  it('ranks by expected value given up', async () => {
    expect(classifyMastery(0.5).id).toBe('elite')
    expect(classifyMastery(3).id).toBe('strong')
    expect(classifyMastery(6).id).toBe('solid')
    expect(classifyMastery(12).id).toBe('amateur')
    expect(classifyMastery(30).id).toBe('fish')
  })

  it('combines both axes into one label', async () => {
    const profile = buildProfile({ ...aggregate([], 2), vpip: 45, pfr: 35, hands: 300 }, 6)
    expect(profile.label).toBe('Loose-Aggressive · Solid')
    expect(profile.reliable).toBe(true)
  })

  it('marks a small sample unreliable', async () => {
    expect(buildProfile({ ...aggregate([], 2), vpip: 20, pfr: 15, hands: 10 }, 3).reliable).toBe(
      false,
    )
  })
})

describe('style street by street', () => {
  const decisions = (street: string, action: string, count: number) =>
    Array.from({ length: count }, () => ({ street, action }))

  it('reads each street separately', async () => {
    const styles = styleByStreet([
      ...decisions('preflop', 'fold', 40),
      ...decisions('turn', 'raise', 40),
    ])

    expect(styles.map((s) => s.street)).toEqual(['preflop', 'turn'])
    expect(styles[0]!.label).toBe('tight')
    expect(styles[1]!.label).toBe('wild')
  })

  it('keeps the streets in the order they are played', async () => {
    const styles = styleByStreet([
      ...decisions('river', 'call', 30),
      ...decisions('preflop', 'call', 30),
      ...decisions('flop', 'call', 30),
    ])
    expect(styles.map((s) => s.street)).toEqual(['preflop', 'flop', 'river'])
  })

  it('names the contradiction between two streets', async () => {
    const contradiction = styleContradiction(
      styleByStreet([
        ...decisions('preflop', 'fold', 40),
        ...decisions('turn', 'raise', 40),
      ]),
    )
    expect(contradiction).toContain('preflop')
    expect(contradiction).toContain('turn')
  })

  it('stays quiet when the streets are played alike', async () => {
    const even = styleByStreet([
      ...decisions('preflop', 'call', 40),
      ...decisions('turn', 'call', 40),
    ])
    expect(styleContradiction(even)).toBeNull()
  })

  it('will not call a handful of decisions a style', async () => {
    const thin = styleByStreet([
      ...decisions('preflop', 'fold', STREET_SAMPLE - 1),
      ...decisions('turn', 'raise', STREET_SAMPLE - 1),
    ])
    expect(styleContradiction(thin)).toBeNull()
  })

  it('handles a player who has done nothing yet', async () => {
    expect(styleByStreet([])).toEqual([])
    expect(styleContradiction([])).toBeNull()
  })
})

describe('confidence intervals', () => {
  it('never reports an impossible rate', async () => {
    // The normal approximation would put the lower bound below zero here.
    const [low, high] = rateInterval(1, 5)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(100)
  })

  it('narrows as the sample grows', async () => {
    const small = rateInterval(25, 50)
    const large = rateInterval(2_500, 5_000)
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0])
  })

  it('brackets the observed rate', async () => {
    const [low, high] = rateInterval(30, 100)
    expect(low).toBeLessThan(30)
    expect(high).toBeGreaterThan(30)
  })

  it('measures a winrate interval from the observed spread', async () => {
    const session = await playSession(40)
    const records = recordsForSeat(session, session.config.heroSeat)
    const interval = winrateInterval(records, session.config.bigBlind)

    expect(interval.low).toBeLessThanOrEqual(interval.bbPer100)
    expect(interval.high).toBeGreaterThanOrEqual(interval.bbPer100)
    expect(interval.standardDeviation).toBeGreaterThan(0)
  })

  it('shows how many hands a meaningful winrate needs', async () => {
    // At a realistic spread, resolving a winrate to ±5bb/100 takes tens of
    // thousands of hands. This is the number the dashboard exists to admit.
    expect(handsForPrecision(100, 10)).toBeGreaterThan(1_000)
    expect(handsForPrecision(100, 10)).toBeLessThan(10_000)
    expect(handsForPrecision(100, 2)).toBeGreaterThan(30_000)
  })
})

describe('hand history storage', () => {
  it('round-trips a hand through storage without losing anything', async () => {
    const session = await playSession(6)
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

  it('stores only what replay needs', async () => {
    const session = await playSession(2)
    const stored = toStored(session.history[0]!, 0)
    // No board, no winners, no statistics — all recomputed on read.
    expect(Object.keys(stored).sort()).toEqual(
      [
        'actions',
        'bigBlind',
        'buttonSeat',
        'deck',
        'handNumber',
        'heroSeat',
        'playedAt',
        'seatNames',
        'seed',
        'smallBlind',
        'startingStacks',
        'version',
      ].sort(),
    )
  })

  it('stays small', async () => {
    const session = await playSession(2)
    const bytes = JSON.stringify(toStored(session.history[0]!, 0)).length
    expect(bytes).toBeLessThan(1_000)
  })

  it('rejects a corrupt deck rather than replaying half a hand', async () => {
    const session = await playSession(1)
    const stored = toStored(session.history[0]!, 0)

    expect(() => fromStored({ ...stored, deck: stored.deck.slice(0, 20) })).toThrow(/52/)
    expect(() =>
      fromStored({ ...stored, deck: [...stored.deck.slice(0, 51), stored.deck[0]!] }),
    ).toThrow(/duplicate/)
  })

  it('refuses a hand written by a newer schema', async () => {
    const session = await playSession(1)
    const stored = toStored(session.history[0]!, 0)
    expect(() => migrate({ ...stored, version: 99 })).toThrow(/newer version/)
  })

  it('exports and imports a whole history', async () => {
    const session = await playSession(5)
    const stored = session.history.map((record) => toStored(record, 0))
    const restored = importHands(exportHands(stored))

    expect(restored.hands).toHaveLength(stored.length)
    expect(restored.hands.map((h) => h.deck)).toEqual(stored.map((h) => h.deck))
  })

  it('carries equity guesses out and back with the hands', async () => {
    // An export that quietly drops half of what the app knows is a partial
    // backup pretending to be a complete one.
    const session = await playSession(2)
    const stored = session.history.map((record) => toStored(record, 0))
    const guesses = [
      { handNumber: 1, street: 'flop', guess: 40, actual: 52, boardSize: 3 },
      { handNumber: 2, street: 'turn', guess: 70, actual: 68, boardSize: 4 },
    ]

    const restored = importHands(exportHands(stored, guesses))
    expect(restored.estimates).toEqual(guesses)
  })

  it('reads a file written before guesses were recorded', async () => {
    const session = await playSession(1)
    const stored = session.history.map((record) => toStored(record, 0))
    const older = JSON.stringify({ version: 1, hands: stored })

    expect(importHands(older).estimates).toEqual([])
    expect(importHands(older).hands).toHaveLength(1)
  })

  it('rejects a file that is not a history', async () => {
    expect(() => importHands('{"nope":1}')).toThrow(/not a stat-poker history/i)
    expect(() => importHands('[]')).toThrow()
  })
})

describe('the store', () => {
  it('keeps hands and counts them', async () => {
    const store = new MemoryHandStore()
    const session = await playSession(4)
    await store.putMany(session.history.map((record) => toStored(record, 0)))

    expect(await store.count()).toBe(4)
    expect(await store.all()).toHaveLength(4)

    await store.clear()
    expect(await store.count()).toBe(0)
  })

  it('keeps equity guesses alongside the hands', async () => {
    const store = new MemoryHandStore()
    await store.putEstimates([
      { handNumber: 1, street: 'flop', guess: 40, actual: 52, boardSize: 3 },
      { handNumber: 2, street: 'turn', guess: 70, actual: 68, boardSize: 4 },
    ])

    const back = await store.allEstimates()
    expect(back).toHaveLength(2)
    expect(back[0]!.guess).toBe(40)

    // Clearing the history clears the guesses with it: they describe the same
    // hands and half a record is worse than none.
    await store.clear()
    expect(await store.allEstimates()).toEqual([])
  })

  it('moves a history between stores through an export', async () => {
    const source = new MemoryHandStore()
    const session = await playSession(3)
    await source.putMany(session.history.map((record) => toStored(record, 0)))

    await source.putEstimates([
      { handNumber: 1, street: 'flop', guess: 35, actual: 41, boardSize: 3 },
    ])

    const destination = new MemoryHandStore()
    const imported = await importIntoStore(destination, await exportStore(source))

    expect(imported.hands).toHaveLength(3)
    expect(imported.estimates).toHaveLength(1)
    expect(await destination.count()).toBe(3)
    expect(await destination.allEstimates()).toHaveLength(1)

    // Everything that came back must still replay.
    for (const hand of await destination.all()) {
      expect(fromStored(hand).state.result).not.toBeNull()
    }
  })

  it('will not double a history when the same backup is loaded twice', async () => {
    // Somebody who clicks load twice, or who keeps two copies of the same
    // file, must not end up with every hand counted twice.
    const source = new MemoryHandStore()
    const session = await playSession(4)
    await source.putMany(session.history.map((record, i) => toStored(record, 1_000 + i)))
    await source.putEstimates([
      { handNumber: 1, street: 'flop', guess: 35, actual: 41, boardSize: 3 },
    ])

    const backup = await exportStore(source)
    const destination = new MemoryHandStore()

    const first = await importIntoStore(destination, backup)
    const second = await importIntoStore(destination, backup)

    expect(first.hands).toHaveLength(4)
    expect(second.hands).toHaveLength(0)
    expect(second.estimates).toHaveLength(0)
    expect(await destination.count()).toBe(4)
    expect(await destination.allEstimates()).toHaveLength(1)
  })

  it('still takes hands it has not seen from a second file', async () => {
    const destination = new MemoryHandStore()
    const one = new MemoryHandStore()
    const two = new MemoryHandStore()
    const session = await playSession(6)
    await one.putMany(session.history.slice(0, 3).map((r, i) => toStored(r, 2_000 + i)))
    await two.putMany(session.history.slice(3).map((r, i) => toStored(r, 5_000 + i)))

    await importIntoStore(destination, await exportStore(one))
    const second = await importIntoStore(destination, await exportStore(two))

    expect(second.hands).toHaveLength(3)
    expect(await destination.count()).toBe(6)
  })

  it('recomputes statistics on read, so improvements apply to old hands', async () => {
    const store = new MemoryHandStore()
    const session = await playSession(4)
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

/**
 * The definitions behind the familiar tracker numbers.
 *
 * These are the denominators, and getting one wrong does not produce an
 * obviously broken figure — it produces a plausible one that means something
 * else. A player comparing their numbers with a friend's is entitled to have
 * them measure the same thing.
 */
describe('street participation', () => {
  const deck = (holeCards: string[], board: string): Card[] => {
    const chosen = [...holeCards.flatMap((h) => parseCards(h)), ...parseCards(board)]
    return [...chosen, ...freshDeck().filter((c) => !chosen.includes(c))]
  }

  const seats = (stacks: number[]) => ({
    seats: stacks.map((stack, i) => ({ name: `P${i}`, stack })),
    buttonSeat: 0,
    smallBlind: 1,
    bigBlind: 2,
  })

  const play = (state: HandState, actions: Action[]): HandState =>
    actions.reduce((s, action) => applyAction(s, action), state)

  it('counts a seat that saw the flop and folded on it', () => {
    // Three limps, then the big blind folds to a bet on the flop. It saw the
    // flop — that is what the denominator of showdown rates has to mean.
    const state = play(
      startHandWithDeck(seats([200, 200, 200]), deck(['Ac Ad', 'Kc Kd', '2c 2d'], 'Ah 7s 4d 9c 8h')),
      [
        { type: 'call' },
        { type: 'call' },
        { type: 'check' }, // to the flop three-handed
        { type: 'raise', to: 6 },
        { type: 'fold' },
        { type: 'call' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
      ],
    )
    const stats = deriveHandStats(state)
    expect(stats[2]!.sawFlop).toBe(true)
    expect(stats[2]!.wentToShowdown).toBe(false)
    expect(aggregate(stats, 2).wtsd).toBeCloseTo((2 / 3) * 100, 6)
  })

  it('does not count a seat that folded before the flop was dealt', () => {
    const state = play(
      startHandWithDeck(seats([200, 200, 200]), deck(['Ac Ad', 'Kc Kd', '2c 2d'], 'Ah 7s 4d 9c 8h')),
      [
        { type: 'fold' }, // button folds; the blinds play on to a showdown
        { type: 'call' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
        { type: 'check' },
      ],
    )
    const stats = deriveHandStats(state)
    expect(stats[0]!.sawFlop).toBe(false)
    expect(state.board).toHaveLength(5) // the flop came, just not for that seat
  })

  it('calls the second raise of the round the three-bet, and nothing else', () => {
    const state = play(
      startHandWithDeck(seats([400, 400, 400]), deck(['Ac Ad', 'Kc Kd', '2c 2d'], 'Ah 7s 4d 9c 8h')),
      [
        { type: 'raise', to: 6 }, // button opens
        { type: 'raise', to: 18 }, // small blind three-bets
        { type: 'fold' },
        { type: 'raise', to: 54 }, // button four-bets
        { type: 'fold' },
      ],
    )
    const stats = deriveHandStats(state)
    expect(stats[1]!.threeBet).toBe(true)
    expect(stats[0]!.threeBet).toBe(false) // the four-bet is not a three-bet
    expect(stats[0]!.pfr).toBe(true)
  })

  it('counts a limper who then faced a raise as having faced one', () => {
    const state = play(
      startHandWithDeck(seats([200, 200, 200]), deck(['Ac Ad', 'Kc Kd', '2c 2d'], 'Ah 7s 4d 9c 8h')),
      [
        { type: 'call' }, // button limps
        { type: 'raise', to: 10 }, // small blind raises behind
        { type: 'fold' },
        { type: 'fold' }, // button gives up the limp
      ],
    )
    const stats = deriveHandStats(state)
    expect(stats[0]!.facedPreflopRaise).toBe(true)
    expect(stats[0]!.foldedToPreflopRaise).toBe(true)
  })

  it('keeps showdowns inside the flops they came from, over a played session', async () => {
    const session = await playSession(60, 77)
    for (const record of session.history) {
      for (const seat of record.stats) {
        if (seat.wentToShowdown) expect(seat.sawFlop).toBe(true)
      }
    }
    const stats = aggregate(recordsForSeat(session, session.config.heroSeat), 2)
    expect(stats.wtsd).toBeLessThanOrEqual(100)
  })
})
