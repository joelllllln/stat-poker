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
} from '../game/session'
import { adviseOn, decisionsTaken } from './advise'
import { gradeHand, replayHand } from './grade'

/**
 * The live coach and the post-hand verdict are one claim, made twice.
 *
 * The app tells you what to do while the decision is live and then tells you
 * how you did once it is over. Those are two code paths over the same model,
 * and if they disagree the app contradicts itself in front of the person it is
 * teaching — the advice would recommend a line the review then marks down.
 *
 * These tests hold them to the same numbers rather than to the same method.
 */

const breathe = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Play one hand with the hero calling or checking, and return its record. */
async function playOneHand(seed: number): Promise<HandRecord> {
  const session = createSession(defaultSessionConfig(seed))
  const rng = new Rng(seed + 1)

  for (let attempt = 0; attempt < 40; attempt++) {
    await breathe()
    startNextHand(session)
    runBotsUntilHero(session)

    let guard = 0
    while (session.current!.result === null && guard++ < 40) {
      if (session.current!.toAct !== session.config.heroSeat) break
      const options = legalActions(session.current!)
      const choice =
        options.find((option) => option.type === 'check') ??
        options.find((option) => option.type === 'call') ??
        options[rng.nextInt(options.length)]!
      heroAct(
        session,
        choice.type === 'raise' ? { type: 'raise', to: choice.min! } : { type: choice.type },
      )
      if (session.current!.result === null) runBotsUntilHero(session)
    }

    const record = session.history[session.history.length - 1]
    // A hand the hero never acted in proves nothing either way.
    if (record && record.state.actions.some((entry) => entry.seat === record.heroSeat)) {
      return record
    }
  }

  throw new Error('The hero never got a decision to make')
}

/** Every moment the hero was on the clock, in the order they happened. */
function heroDecisions(record: HandRecord) {
  return replayHand(record).filter((step) => step.state.toAct === record.heroSeat)
}

describe('the advice and the verdict', () => {
  it('price the same decision identically', async () => {
    const record = await playOneHand(17)
    const grade = gradeHand(record, record.heroSeat)
    const moments = heroDecisions(record)

    expect(moments.length).toBeGreaterThan(0)
    expect(grade.decisions).toHaveLength(moments.length)

    for (const [index, moment] of moments.entries()) {
      const advice = adviseOn(moment.state, record.heroSeat, index)
      const verdict = grade.decisions[index]!

      // The equity behind both, then every option's price.
      expect(advice.equity).toBeCloseTo(verdict.equity, 12)
      expect(advice.options).toHaveLength(verdict.options.length)

      for (const option of advice.options) {
        const same = verdict.options.find((other) => other.label === option.label)
        expect(same, `the verdict priced ${option.label}`).toBeDefined()
        expect(option.ev).toBeCloseTo(same!.ev, 12)
      }

      // And so the recommendation and the mark cannot contradict each other.
      const best = advice.options[0]!
      const bestGraded = verdict.options.reduce((a, b) => (b.ev > a.ev ? b : a))
      expect(best.label).toBe(bestGraded.label)
    }
  })

  it('says the same thing however many times it is asked', async () => {
    const record = await playOneHand(23)
    const moment = heroDecisions(record)[0]!

    const once = adviseOn(moment.state, record.heroSeat, 0)
    const twice = adviseOn(moment.state, record.heroSeat, 0)

    expect(twice.equity).toBe(once.equity)
    expect(twice.options.map((option) => [option.label, option.ev])).toEqual(
      once.options.map((option) => [option.label, option.ev]),
    )
  })

  it('counts the decisions a seat has taken, which is what seeds them', async () => {
    const record = await playOneHand(31)
    const moments = heroDecisions(record)

    for (const [index, moment] of moments.entries()) {
      expect(decisionsTaken(moment.state, record.heroSeat)).toBe(index)
    }
  })

  it('never quotes a price the stack cannot pay', async () => {
    const record = await playOneHand(41)
    for (const [index, moment] of heroDecisions(record).entries()) {
      const advice = adviseOn(moment.state, record.heroSeat, index)
      expect(advice.toCall).toBeLessThanOrEqual(moment.state.seats[record.heroSeat]!.stack)
      expect(advice.requiredEquity).toBeGreaterThanOrEqual(0)
      expect(advice.requiredEquity).toBeLessThanOrEqual(1)
    }
  })
})
