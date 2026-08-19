import { describe, expect, it } from 'vitest'
import { Rng } from '../engine/cards'
import { applyAction, legalActions } from '../engine/hand'
import { potSize, type Action, type HandState } from '../engine/types'
import {
  createSession,
  heroAct,
  runBotsUntilHero,
  startNextHand,
  type SessionState,
} from './session'
import { MAX_SEATS, MAX_STACK_BB, MIN_SEATS, MIN_STACK_BB, sessionConfigFor, type TableConfig } from './table'
import { ARCHETYPE_IDS } from '../bots/archetypes'

/**
 * Trying to break it, rather than confirming that it works.
 *
 * The table became a choice, which multiplied the number of games this app can
 * deal by a few hundred. Tests that play the game the way it is meant to be
 * played will not find what is wrong with the ones nobody thought about: a
 * nine-handed table on ten-big-blind stacks where the blinds put two players
 * all in before a card is dealt, a heads-up game where the button posts the
 * small blind, a raise to exactly one chip more than the minimum.
 *
 * So this plays badly on purpose, at random tables, and checks the invariants
 * after every single action rather than at the end of the hand — because a
 * fault that heals itself before showdown is still a fault, and the end of the
 * hand is where it would hide.
 */

const STAKES = [
  { smallBlind: 1, bigBlind: 2 },
  { smallBlind: 1, bigBlind: 3 },
  { smallBlind: 2, bigBlind: 5 },
  { smallBlind: 25, bigBlind: 50 },
]

/** A table drawn at random from everything the setup screen can produce. */
function anyTable(rng: Rng): TableConfig {
  const stake = STAKES[rng.nextInt(STAKES.length)]!
  const depth = MIN_STACK_BB + rng.nextInt(MAX_STACK_BB - MIN_STACK_BB + 1)
  const howMany = 1 + rng.nextInt(ARCHETYPE_IDS.length)
  return {
    seats: MIN_SEATS + rng.nextInt(MAX_SEATS - MIN_SEATS + 1),
    smallBlind: stake.smallBlind,
    bigBlind: stake.bigBlind,
    buyIn: depth * stake.bigBlind,
    opponents: Array.from({ length: howMany }, () => ARCHETYPE_IDS[rng.nextInt(ARCHETYPE_IDS.length)]!),
  }
}

/** Everything that has to be true of a hand at every moment of it. */
function check(state: HandState, startingStacks: readonly number[], where: string) {
  // Mid-hand the chips are split between stacks and the pot; once the hand is
  // settled the pot has been paid back into the stacks and counting what was
  // committed as well would count the pot twice.
  const chips = state.seats.reduce(
    (sum, seat) => sum + seat.stack + (state.result === null ? seat.totalCommitted : 0),
    0,
  )
  const started = startingStacks.reduce((sum, chips) => sum + chips, 0)
  expect(chips, `${where}: chips conserved`).toBe(started)

  for (const seat of state.seats) {
    expect(seat.stack, `${where}: ${seat.name} stack`).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(seat.stack), `${where}: ${seat.name} stack is a number`).toBe(true)
    expect(seat.committed, `${where}: ${seat.name} committed`).toBeGreaterThanOrEqual(0)
    // Chips in front of a seat this street are part of what it has put in
    // across the hand, never more than it.
    expect(seat.totalCommitted, `${where}: ${seat.name} in front`).toBeGreaterThanOrEqual(seat.committed)
    // A seat with chips behind it cannot be all in — until the hand is over
    // and it has been paid, when being all in is history rather than a state.
    if (seat.status === 'allin' && state.result === null) {
      expect(seat.stack, `${where}: ${seat.name} all in`).toBe(0)
    }
  }

  // Everything drawn in front of the seats has to be in the pot that is drawn
  // in the middle: chips returned uncalled are off the felt, not on it twice.
  const inFront = state.seats.reduce((sum, seat) => sum + seat.committed, 0)
  expect(inFront, `${where}: chips in front are in the pot`).toBeLessThanOrEqual(potSize(state))

  expect(state.currentBet, `${where}: current bet`).toBeGreaterThanOrEqual(0)
  expect(potSize(state), `${where}: pot`).toBeGreaterThanOrEqual(0)

  if (state.toAct !== null) {
    const seat = state.seats[state.toAct]
    expect(seat, `${where}: seat to act exists`).toBeDefined()
    expect(seat!.status, `${where}: seat to act is live`).toBe('active')
    expect(legalActions(state).length, `${where}: something is legal`).toBeGreaterThan(0)
  }

  if (state.result !== null) {
    const net = state.result.net.reduce((sum, chips) => sum + chips, 0)
    expect(Math.abs(net), `${where}: the hand pays out what went in`).toBeLessThan(1e-9)
    const awarded = state.result.pots.reduce((sum, pot) => sum + pot.amount, 0)
    expect(awarded, `${where}: every chip in the pot is awarded`).toBe(potSize(state))
    for (const pot of state.result.pots) {
      expect(pot.winners.length, `${where}: a pot has a winner`).toBeGreaterThan(0)
      for (const winner of pot.winners) {
        expect(pot.eligible, `${where}: winners are eligible`).toContain(winner)
      }
    }
  }
}

/** The most awkward legal action available, chosen to stress the rules. */
function awkward(state: HandState, rng: Rng): Action {
  const options = legalActions(state)
  const raise = options.find((o) => o.type === 'raise')
  // Raises are where the rules live: minimum, one over the minimum, all in,
  // and one under all in are the sizes that break things.
  if (raise && rng.nextInt(2) === 0) {
    const { min, max } = { min: raise.min!, max: raise.max! }
    const sizes = [min, Math.min(max, min + 1), max, Math.max(min, max - 1)]
    return { type: 'raise', to: sizes[rng.nextInt(sizes.length)]! }
  }
  const choice = options[rng.nextInt(options.length)]!
  return choice.type === 'raise' ? { type: 'raise', to: choice.min! } : { type: choice.type }
}

describe('playing badly at random tables', () => {
  it('holds every invariant through 300 hands of hostile play', () => {
    const rng = new Rng(20_260_819)
    let hands = 0
    let allIns = 0

    for (let attempt = 0; attempt < 30; attempt++) {
      const config = anyTable(rng)
      const session: SessionState = createSession(sessionConfigFor(config, rng.nextUint32()))
      const where = `${config.seats}-handed ${config.smallBlind}/${config.bigBlind} for ${config.buyIn}`

      for (let hand = 0; hand < 10; hand++) {
        startNextHand(session)
        const started = [...session.currentStartingStacks]
        check(session.current!, started, `${where} on the deal`)

        runBotsUntilHero(session)
        check(session.current!, started, `${where} after the bots`)

        let guard = 0
        while (session.current!.result === null && guard++ < 120) {
          if (session.current!.toAct !== session.config.heroSeat) break
          heroAct(session, awkward(session.current!, rng))
          check(session.current!, started, `${where} after acting`)
          if (session.current!.result === null) {
            runBotsUntilHero(session)
            check(session.current!, started, `${where} after the bots replied`)
          }
        }

        expect(session.current!.result, `${where}: the hand finished`).not.toBeNull()
        check(session.current!, started, `${where} at the end`)
        if (session.current!.seats.some((seat) => seat.status === 'allin')) allIns += 1
        hands += 1
      }
    }

    expect(hands).toBe(300)
    // If nothing ever went all in, the awkward sizes were not being used and
    // this test is quietly proving nothing.
    expect(allIns, 'hostile play reaches all-in spots').toBeGreaterThan(20)
  })
})

describe('the spots that are meant to be hard', () => {
  it('deals a table where the blinds put people all in', () => {
    // Ten big blinds is the shortest table the app offers. Nine-handed, that
    // is a lot of stacks and a lot of forced all-ins.
    const config: TableConfig = {
      seats: 9,
      smallBlind: 25,
      bigBlind: 50,
      buyIn: 500,
      opponents: ['maniac'],
    }
    const session = createSession(sessionConfigFor(config, 5))
    for (let hand = 0; hand < 40; hand++) {
      startNextHand(session)
      const started = [...session.currentStartingStacks]
      runBotsUntilHero(session)
      let guard = 0
      while (session.current!.result === null && guard++ < 120) {
        if (session.current!.toAct !== session.config.heroSeat) break
        const options = legalActions(session.current!)
        // Shove whenever possible: the fastest way to a table of side pots.
        const raise = options.find((o) => o.type === 'raise')
        const shove: Action = raise
          ? { type: 'raise', to: raise.max! }
          : { type: options[0]!.type === 'raise' ? 'call' : options[0]!.type }
        heroAct(session, shove)
        if (session.current!.result === null) runBotsUntilHero(session)
      }
      check(session.current!, started, 'short-stacked nine-handed')
      expect(session.current!.result).not.toBeNull()
    }
    // Side pots are the point of the exercise.
    const withSidePots = session.history.filter((record) => record.state.result!.pots.length > 1)
    expect(withSidePots.length, 'side pots happen').toBeGreaterThan(0)
  })

  it('posts the blinds correctly heads-up, where the button is the small blind', () => {
    const session = createSession(
      sessionConfigFor(
        { seats: 2, smallBlind: 5, bigBlind: 10, buyIn: 1_000, opponents: ['tag'] },
        9,
      ),
    )
    for (let hand = 0; hand < 8; hand++) {
      startNextHand(session)
      const state = session.current!
      const button = state.seats[state.buttonSeat]!
      const other = state.seats.find((seat) => seat.index !== state.buttonSeat)!
      // Heads-up, the button posts the small blind and acts first before the
      // flop — getting this backwards is the classic heads-up bug.
      expect(button.committed, 'the button posts the small blind').toBe(5)
      expect(other.committed, 'the other seat posts the big blind').toBe(10)
      expect(state.toAct, 'the button acts first preflop').toBe(state.buttonSeat)
      while (session.current!.result === null) {
        if (session.current!.toAct === session.config.heroSeat) {
          heroAct(session, { type: 'fold' })
        } else {
          runBotsUntilHero(session)
        }
      }
    }
  })

  it('refuses an illegal action rather than half-applying it', () => {
    const session = createSession(
      sessionConfigFor(
        { seats: 3, smallBlind: 1, bigBlind: 2, buyIn: 200, opponents: ['nit'] },
        13,
      ),
    )
    startNextHand(session)
    runBotsUntilHero(session)
    if (session.current!.toAct !== session.config.heroSeat) return

    const before = JSON.stringify(session.current)
    const raise = legalActions(session.current!).find((o) => o.type === 'raise')
    if (raise) {
      // Under the minimum, over the maximum, and a nonsense number.
      for (const to of [raise.min! - 1, raise.max! + 1, -5]) {
        expect(() => applyAction(session.current!, { type: 'raise', to }), `raise to ${to}`).toThrow()
      }
    }
    expect(JSON.stringify(session.current), 'the state is untouched').toBe(before)
  })
})
