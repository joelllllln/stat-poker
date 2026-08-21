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
import type { DecisionGrade } from './grade'
import {
  MIN_SAMPLE,
  biggestLeak,
  describeLeak,
  findLeaks,
  tagDecisions,
  type TaggedDecision,
} from './leaks'
import type { HandRecord } from '../game/session'

/** A decision grade with only the fields the leak finder reads. */
const decision = (
  street: DecisionGrade['street'],
  evLossBB: number,
  toCall = 0,
): DecisionGrade =>
  ({
    street,
    potBefore: 10,
    toCall,
    equity: 0.5,
    requiredEquity: 0.3,
    options: [],
    chosen: { type: 'check' },
    best: { type: 'check' },
    chosenLabel: 'Check',
    bestLabel: 'Check',
    evLoss: evLossBB * 2,
    evLossBB,
    evLossErrorBB: 0,
    verdict: evLossBB > 2 ? 'blunder' : evLossBB > 0.5 ? 'mistake' : 'optimal',
    explanation: '',
  }) as DecisionGrade

/** Play a short session so there are real records to tag. */
function playSession(hands: number, seed = 12) {
  const session = createSession(defaultSessionConfig(seed))
  const rng = new Rng(seed + 3)
  for (let i = 0; i < hands; i++) {
    startNextHand(session)
    runBotsUntilHero(session)
    let guard = 0
    while (session.current!.result === null && guard++ < 40) {
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

describe('tagging decisions with the shape of the spot', () => {
  it('records street, position and whether a bet was faced', () => {
    const session = playSession(4)
    const tagged = tagDecisions(session.history, session.config.heroSeat)

    expect(tagged.length).toBeGreaterThan(0)
    for (const item of tagged) {
      expect(['preflop', 'flop', 'turn', 'river']).toContain(item.street)
      expect(item.position).toBeTruthy()
      expect(item.facingBet).toBe(item.grade.toCall > 0)
      expect(item.handNumber).toBeGreaterThan(0)
    }
  }, 300_000)

  it('accepts grades that have already been computed', () => {
    const session = playSession(3)
    let called = 0
    const tagged = tagDecisions(session.history, session.config.heroSeat, () => {
      called++
      return [decision('flop', 1)]
    })
    expect(called).toBe(session.history.length)
    expect(tagged).toHaveLength(session.history.length)
  }, 120_000)
})

describe('finding the leak', () => {
  /** A player who is fine everywhere except turns, where they bleed. */
  const lopsided = (): HandRecord[] => []

  const taggedFrom = (grades: DecisionGrade[]) =>
    grades.map((grade, i) => ({
      grade,
      street: grade.street,
      position: 'BTN',
      facingBet: grade.toCall > 0,
      raisedPot: true,
      handNumber: i + 1,
    }))

  it('names the street that costs the most', () => {
    const grades = [
      ...Array.from({ length: 40 }, () => decision('flop', 0.02)),
      ...Array.from({ length: 40 }, () => decision('turn', 1.5)),
    ]
    const leaks = findLeaks(taggedFrom(grades))
    const worst = biggestLeak(leaks)

    expect(worst).not.toBeNull()
    expect(worst!.label).toContain('turn')
    expect(worst!.lossPerDecisionBB).toBeGreaterThan(1)
  })

  it('ignores a grouping that covers every decision', () => {
    // Every decision here came from the button, so "from the BTN" is the whole
    // sample and cannot be the thing going wrong.
    const grades = [
      ...Array.from({ length: 40 }, () => decision('flop', 0.02)),
      ...Array.from({ length: 40 }, () => decision('turn', 1.5)),
    ]
    const leaks = findLeaks(taggedFrom(grades))
    const everything = leaks.find((leak) => leak.label === 'from the BTN')!

    expect(everything.decisions).toBe(80)
    expect(everything.excessLossBB).toBeCloseTo(0, 6)
    expect(leaks[0]!.label).not.toBe('from the BTN')
  })

  it('ranks a small mistake made constantly above a big one made twice', () => {
    const grades = [
      ...Array.from({ length: 60 }, () => decision('flop', 0.4)),
      ...Array.from({ length: 2 }, () => decision('river', 5)),
    ]
    const leaks = findLeaks(taggedFrom(grades))
    // 24bb from flops against 10bb from rivers.
    const flop = leaks.find((leak) => leak.label === 'on the flop')!
    const river = leaks.find((leak) => leak.label === 'on the river')!
    expect(flop.totalLossBB).toBeGreaterThan(river.totalLossBB)
    expect(leaks[0]!.excessLossBB).toBeGreaterThanOrEqual(leaks.at(-1)!.excessLossBB)
  })

  it('refuses to call a handful of hands a leak', () => {
    const grades = Array.from({ length: MIN_SAMPLE - 1 }, () => decision('river', 4))
    const leaks = findLeaks(taggedFrom(grades))

    // The group is there and it is expensive, but it is not yet a habit.
    expect(leaks.some((leak) => leak.label === 'on the river')).toBe(true)
    expect(leaks.every((leak) => !leak.reliable)).toBe(true)
    expect(biggestLeak(leaks)).toBeNull()
  })

  it('says nothing when the player is not leaking', () => {
    const grades = Array.from({ length: 100 }, () => decision('flop', 0.01))
    expect(biggestLeak(findLeaks(taggedFrom(grades)))).toBeNull()
  })

  it('reports the error rate of a group', () => {
    const grades = [
      ...Array.from({ length: 25 }, () => decision('turn', 3)), // blunders
      ...Array.from({ length: 25 }, () => decision('turn', 0.01)), // fine
    ]
    const turn = findLeaks(taggedFrom(grades)).find((leak) => leak.label === 'on the turn')!
    expect(turn.errorRate).toBeCloseTo(0.5, 6)
    expect(turn.decisions).toBe(50)
  })

  it('separates facing a bet from having the lead', () => {
    const grades = [
      ...Array.from({ length: 30 }, () => decision('flop', 2, 10)), // facing a bet
      ...Array.from({ length: 30 }, () => decision('flop', 0.01, 0)), // leading
    ]
    const leaks = findLeaks(taggedFrom(grades))
    const facing = leaks.find((leak) => leak.label === 'facing a bet')!
    const leading = leaks.find((leak) => leak.label === 'when nobody has bet')!

    expect(facing.totalLossBB).toBeGreaterThan(leading.totalLossBB)
  })

  it('finds nothing when every spot is equally bad', () => {
    // A player leaking uniformly has no particular leak to name — the overall
    // rate is the story, and the mastery tier already tells it.
    const grades = Array.from({ length: 40 }, () => decision('turn', 1.2, 8))
    expect(biggestLeak(findLeaks(taggedFrom(grades)))).toBeNull()
  })

  it('writes a sentence a player can act on', () => {
    const grades = [
      ...Array.from({ length: 30 }, () => decision('turn', 1.2, 8)),
      ...Array.from({ length: 30 }, () => decision('flop', 0.02, 0)),
    ]
    const worst = biggestLeak(findLeaks(taggedFrom(grades)))!
    expect(worst).toBeTruthy()
    const text = describeLeak(worst)

    expect(text).toContain('bb per decision')
    expect(text).toMatch(/\d+ decisions/)
    expect(text).toMatch(/\d+% of them mistakes/)
  })

  it('handles a player with no history at all', () => {
    expect(findLeaks([])).toEqual([])
    expect(biggestLeak([])).toBeNull()
    expect(lopsided()).toEqual([])
  })
})

/**
 * The test that makes a leak worth naming.
 *
 * A history is carved up a dozen ways, and the worst of a dozen groups looks
 * bad in every history — including one from a player with nothing wrong with
 * them. So the finder is pointed at players who have no leak at all, and
 * required to say so.
 */
describe('what the finder says about a player with no leak', () => {
  const STREETS = ['preflop', 'flop', 'turn', 'river'] as const
  const POSITIONS = ['BTN', 'SB', 'BB', 'CO']

  /** Decisions whose cost has nothing to do with the spot they happened in. */
  const evenPlayer = (rng: Rng, count: number): TaggedDecision[] =>
    Array.from({ length: count }, (_, i) => {
      const street = STREETS[rng.nextInt(STREETS.length)]!
      // Most decisions cost nothing and a few cost a lot, as they really do.
      const roll = rng.nextFloat()
      const loss = roll < 0.7 ? 0 : roll < 0.95 ? rng.nextFloat() : rng.nextFloat() * 8
      return {
        grade: decision(street, loss, rng.nextFloat() < 0.5 ? 4 : 0),
        street,
        position: POSITIONS[rng.nextInt(POSITIONS.length)]!,
        facingBet: rng.nextFloat() < 0.5,
        raisedPot: rng.nextFloat() < 0.5,
        handNumber: i + 1,
      }
    })

  it('names a leak no more than one time in twenty', () => {
    const rng = new Rng(31337)
    const TRIALS = 40
    let named = 0
    for (let trial = 0; trial < TRIALS; trial++) {
      if (biggestLeak(findLeaks(evenPlayer(rng, 150))) !== null) named++
    }
    expect(named / TRIALS).toBeLessThanOrEqual(0.05)
  }, 300_000)

  it('still finds a leak that is really there', () => {
    // The same player, except that every turn decision costs two blinds more.
    const rng = new Rng(4242)
    const tagged = evenPlayer(rng, 150).map((item) =>
      item.street === 'turn'
        ? { ...item, grade: { ...item.grade, evLossBB: item.grade.evLossBB + 2 } }
        : item,
    )
    const worst = biggestLeak(findLeaks(tagged))
    expect(worst).not.toBeNull()
    expect(worst!.label).toContain('turn')
  }, 300_000)
})
