/**
 * A session: a table, a stack of hands, and the history they leave behind.
 *
 * The engine knows about one hand. This layer knows about the table across
 * hands — the button moving, stacks carrying over, rebuys, and the record kept
 * for later analysis.
 */

import { Rng } from '../engine/cards'
import { applyAction, startHand } from '../engine/hand'
import type { Action, HandState } from '../engine/types'
import { archetype, type Archetype } from '../bots/archetypes'
import { decide } from '../bots/policy'
import { deriveHandStats, type SeatHandStats } from '../stats/hand-stats'

export interface SeatConfig {
  name: string
  /** Archetype id, or null for the human. */
  bot: string | null
}

export interface SessionConfig {
  seats: readonly SeatConfig[]
  heroSeat: number
  buyIn: number
  smallBlind: number
  bigBlind: number
  seed: number
}

export interface HandRecord {
  handNumber: number
  /** The seed this hand's deck came from: replay needs nothing else. */
  seed: number
  buttonSeat: number
  state: HandState
  stats: SeatHandStats[]
}

export interface SessionState {
  config: SessionConfig
  stacks: number[]
  buttonSeat: number
  handNumber: number
  rng: Rng
  /** The hand in progress, or null between hands. */
  current: HandState | null
  /** Seed of the hand in progress: replay needs nothing else. */
  currentSeed: number
  history: HandRecord[]
  /** Chips added to each seat by rebuys, so net results stay honest. */
  rebuys: number[]
}

const DEFAULT_SEATS: SeatConfig[] = [
  { name: 'You', bot: null },
  { name: 'Rock', bot: 'nit' },
  { name: 'Eagle', bot: 'tag' },
  { name: 'Hawk', bot: 'lag' },
  { name: 'Fish', bot: 'station' },
  { name: 'Maniac', bot: 'maniac' },
]

export function defaultSessionConfig(seed = 1): SessionConfig {
  return {
    seats: DEFAULT_SEATS,
    heroSeat: 0,
    buyIn: 200,
    smallBlind: 1,
    bigBlind: 2,
    seed,
  }
}

export function createSession(config: SessionConfig): SessionState {
  return {
    config,
    stacks: config.seats.map(() => config.buyIn),
    // Start the button to the right of the hero so the first hand deals it the
    // button, which is the friendliest seat to learn in.
    buttonSeat: (config.heroSeat - 1 + config.seats.length) % config.seats.length,
    handNumber: 0,
    rng: new Rng(config.seed),
    current: null,
    currentSeed: 0,
    history: [],
    rebuys: config.seats.map(() => 0),
  }
}

/** Top every short stack back up to the buy-in, as a cash game would. */
function rebuy(session: SessionState): void {
  session.stacks = session.stacks.map((stack, seat) => {
    if (stack >= session.config.bigBlind) return stack
    session.rebuys[seat]! += session.config.buyIn - stack
    return session.config.buyIn
  })
}

export function startNextHand(session: SessionState): SessionState {
  if (session.current !== null && session.current.result === null) {
    throw new Error('A hand is still in progress')
  }

  rebuy(session)
  session.buttonSeat = (session.buttonSeat + 1) % session.config.seats.length
  session.handNumber += 1

  const seed = session.rng.nextUint32()
  session.currentSeed = seed
  session.current = startHand(
    {
      seats: session.config.seats.map((seat, i) => ({
        name: seat.name,
        stack: session.stacks[i]!,
      })),
      buttonSeat: session.buttonSeat,
      smallBlind: session.config.smallBlind,
      bigBlind: session.config.bigBlind,
    },
    new Rng(seed),
  )

  return finishIfComplete(session)
}

/** The archetype driving a seat, or null when it is the human. */
export function botFor(session: SessionState, seat: number): Archetype | null {
  const id = session.config.seats[seat]?.bot
  return id ? archetype(id) : null
}

/** True when the hand is waiting on the human. */
export const waitingOnHero = (session: SessionState): boolean =>
  session.current !== null &&
  session.current.result === null &&
  session.current.toAct === session.config.heroSeat

function finishIfComplete(session: SessionState): SessionState {
  const state = session.current
  if (state === null || state.result === null) return session

  session.stacks = state.seats.map((s) => s.stack)
  session.history.push({
    handNumber: session.handNumber,
    seed: session.currentSeed,
    buttonSeat: session.buttonSeat,
    state,
    stats: deriveHandStats(state),
  })
  return session
}

/** Apply the human's action. */
export function heroAct(session: SessionState, action: Action): SessionState {
  const state = session.current
  if (state === null || state.result !== null) throw new Error('No hand in progress')
  if (state.toAct !== session.config.heroSeat) throw new Error('Not your turn')

  session.current = applyAction(state, action)
  return finishIfComplete(session)
}

/**
 * Let one bot act. Returns false when the hand is over or it is the human's
 * turn, so a caller can drive it in a loop and stop naturally.
 */
export function stepBot(session: SessionState): boolean {
  const state = session.current
  if (state === null || state.result !== null || state.toAct === null) return false
  if (state.toAct === session.config.heroSeat) return false

  const bot = botFor(session, state.toAct)
  if (!bot) return false

  const action = decide(state, state.toAct, bot, session.rng)
  session.current = applyAction(state, action)
  finishIfComplete(session)
  return true
}

/** Run bots until the human is on the clock or the hand ends. */
export function runBotsUntilHero(session: SessionState): SessionState {
  let guard = 0
  while (stepBot(session)) {
    if (++guard > 200) throw new Error('Bots failed to yield')
  }
  return session
}

/** Every stat record belonging to one seat across the session. */
export const recordsForSeat = (session: SessionState, seat: number): SeatHandStats[] =>
  session.history.map((hand) => hand.stats[seat]!)
