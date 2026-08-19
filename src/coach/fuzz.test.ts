import { describe, expect, it } from 'vitest'
import { Rng } from '../engine/cards'
import { legalActions } from '../engine/hand'
import type { Action, HandState } from '../engine/types'
import { createSession, heroAct, runBotsUntilHero, startNextHand } from '../game/session'
import { sessionConfigFor, type TableConfig } from '../game/table'
import { adviseOn, decisionsTaken } from './advise'
import { gradeHand } from './grade'

/**
 * The coach, at tables nobody designed it for.
 *
 * Everything the coach does is arithmetic over the seats at the table, and
 * until recently there was one table: six seats, 1/2, a hundred big blinds.
 * Now there are a few hundred thousand. Heads-up there is one opponent to
 * enumerate rather than five; nine-handed on ten big blinds nearly every
 * decision is for a stack rather than for a bet; at 25/50 the numbers are an
 * order of magnitude larger and a tolerance written in chips stops meaning
 * what it meant.
 *
 * So this asks for advice at every decision of every table shape and checks
 * that what comes back is a thing a player could act on: a legal action, a
 * finite price, a share between nothing and certain.
 */

const TABLES: TableConfig[] = [
  { seats: 2, smallBlind: 1, bigBlind: 2, buyIn: 200, opponents: ['tag'] },
  { seats: 2, smallBlind: 25, bigBlind: 50, buyIn: 500, opponents: ['maniac'] },
  { seats: 3, smallBlind: 1, bigBlind: 3, buyIn: 300, opponents: ['nit', 'station'] },
  { seats: 6, smallBlind: 1, bigBlind: 2, buyIn: 200, opponents: ['nit', 'tag', 'lag', 'station', 'maniac'] },
  { seats: 9, smallBlind: 2, bigBlind: 5, buyIn: 50, opponents: ['lag'] },
  { seats: 9, smallBlind: 25, bigBlind: 50, buyIn: 25_000, opponents: ['nit', 'maniac'] },
]

/** Advice a player could act on, whatever the table. */
function checkAdvice(state: HandState, heroSeat: number, where: string) {
  const advice = adviseOn(state, heroSeat, decisionsTaken(state, heroSeat))
  const legal = legalActions(state)

  expect(advice.options.length, `${where}: something to do`).toBeGreaterThan(0)
  expect(advice.equity, `${where}: equity`).toBeGreaterThanOrEqual(0)
  expect(advice.equity, `${where}: equity`).toBeLessThanOrEqual(1)
  expect(advice.requiredEquity, `${where}: required equity`).toBeGreaterThanOrEqual(0)
  expect(advice.requiredEquity, `${where}: required equity`).toBeLessThanOrEqual(1)
  expect(advice.toCall, `${where}: the price of continuing`).toBeLessThanOrEqual(
    state.seats[heroSeat]!.stack,
  )

  for (const option of advice.options) {
    expect(Number.isFinite(option.ev), `${where}: ${option.label} is priced`).toBe(true)
    expect(option.label.length, `${where}: ${option.action.type} is named`).toBeGreaterThan(0)
    const rule = legal.find((o) => o.type === option.action.type)
    expect(rule, `${where}: ${option.label} is legal`).toBeDefined()
    if (option.action.type === 'raise') {
      expect(option.action.to, `${where}: ${option.label} is at least the minimum`).toBeGreaterThanOrEqual(rule!.min!)
      expect(option.action.to, `${where}: ${option.label} is within the stack`).toBeLessThanOrEqual(rule!.max!)
    }
  }

  // Folding is the floor: nothing the coach recommends can be worth less than
  // giving up, because giving up is always available and always costs nothing
  // more than what is already in.
  const best = advice.options[0]!
  expect(best.ev, `${where}: the best option beats folding`).toBeGreaterThanOrEqual(-1e-9)
  return best.action
}

/** Play the hand the way the coach says to play it. */
function coachAction(state: HandState, heroSeat: number, where: string): Action {
  const best = checkAdvice(state, heroSeat, where)
  return best.type === 'raise' ? { type: 'raise', to: best.to } : { type: best.type }
}

describe('the coach at every table', () => {
  it.each(TABLES.map((table) => [`${table.seats}-handed ${table.smallBlind}/${table.bigBlind} for ${table.buyIn}`, table] as const))(
    'gives advice a player could act on: %s',
    (where, table) => {
      const session = createSession(sessionConfigFor(table, 77))
      const rng = new Rng(4242)

      for (let hand = 0; hand < 4; hand++) {
        startNextHand(session)
        runBotsUntilHero(session)

        let guard = 0
        while (session.current!.result === null && guard++ < 60) {
          if (session.current!.toAct !== session.config.heroSeat) break
          // Follow the coach half the time and defy it the other half, so the
          // hands reach spots taking its advice would never produce.
          const action =
            rng.nextInt(2) === 0
              ? coachAction(session.current!, session.config.heroSeat, where)
              : (() => {
                  checkAdvice(session.current!, session.config.heroSeat, where)
                  const options = legalActions(session.current!)
                  const pick = options[rng.nextInt(options.length)]!
                  return pick.type === 'raise'
                    ? ({ type: 'raise', to: pick.max! } as Action)
                    : ({ type: pick.type } as Action)
                })()
          heroAct(session, action)
          if (session.current!.result === null) runBotsUntilHero(session)
        }

        expect(session.current!.result, `${where}: the hand finished`).not.toBeNull()
      }

      // Then grade what was played, which is the same arithmetic run backwards.
      for (const record of session.history) {
        const graded = gradeHand(record, session.config.heroSeat)
        expect(Number.isFinite(graded.totalEvLossBB), `${where}: the hand has a price`).toBe(true)
        expect(graded.totalEvLossBB, `${where}: the price is a loss, not a gain`).toBeGreaterThanOrEqual(0)
        for (const decision of graded.decisions) {
          expect(Number.isFinite(decision.evLossBB), `${where}: ${decision.street} is priced`).toBe(true)
          expect(decision.explanation.length, `${where}: ${decision.street} is explained`).toBeGreaterThan(0)
          expect(decision.equity).toBeGreaterThanOrEqual(0)
          expect(decision.equity).toBeLessThanOrEqual(1)
        }
      }
    },
  )
})
