/**
 * What to do, at a decision that has not been made yet.
 *
 * The same pricing that grades the hand afterwards, applied to the position as
 * it stands. That is the whole claim of the live coach, and it only holds if
 * both sides price the spot identically — same model, same sizes, same seed —
 * so the seed is shared with the grader and this lives beside it rather than
 * inside the worker, where nothing could test it.
 */

import type { Card } from '../engine/cards'
import { applyAction, startHandWithDeck, winnablePot } from '../engine/hand'
import { potSize, type Action, type HandState } from '../engine/types'
import { evContext, evaluateActions, type ActionEV } from './ev'
import { GRADE_SEED, sizingsFor } from './grade'
import { requiredEquity } from './odds'

export interface Advice {
  /** Every option priced in chips relative to folding, best first. */
  options: ActionEV[]
  /** Equity against the modelled ranges at this moment. */
  equity: number
  /** Share of what a call plays for that it has to win to break even. */
  requiredEquity: number
  pot: number
  /** What continuing costs this stack, which is never more than it has. */
  toCall: number
}

/**
 * Price the decision in front of `heroSeat`.
 *
 * `decisionsSoFar` is how many decisions this player has already made in the
 * hand: the grader seeds each decision by its index, so quoting the same index
 * here is what makes the advice and the verdict the same number rather than
 * merely the same method.
 */
export function adviseOn(state: HandState, heroSeat: number, decisionsSoFar: number): Advice {
  const priced = evaluateActions(
    evContext(state, heroSeat, GRADE_SEED + decisionsSoFar),
    sizingsFor(state, heroSeat),
  )

  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  const toCall = Math.min(Math.max(0, state.currentBet - hero.committed), hero.stack)

  return {
    options: [...priced.options].sort((a, b) => b.ev - a.ev),
    equity: priced.equity,
    requiredEquity: requiredEquity(toCall, winnablePot(state, heroSeat, toCall)),
    pot,
    toCall,
  }
}

/** How many decisions this seat has already made in the hand. */
export const decisionsTaken = (state: HandState, heroSeat: number): number =>
  state.actions.filter((entry) => entry.seat === heroSeat).length

/**
 * A decision, in a form that can cross a thread boundary.
 *
 * Pricing runs in a worker, so the position has to be sent rather than shared,
 * and a `HandState` full of derived fields is not what you want to send. The
 * deck and the actions replay to the same hand exactly — but only if everything
 * the pricing reads travels with them, and who was sitting in each seat is now
 * one of those things.
 *
 * Writing the two halves of that by hand in two files is how the styles got
 * left behind on the way out in the first place, so the packing and the
 * unpacking live here together, next to the thing that reads them, with a test
 * holding the round trip to the position it started from.
 */
export interface AdviseInput {
  deck: number[]
  actions: { seat: number; type: Action['type']; to?: number }[]
  seatNames: string[]
  seatStyles: (string | null)[]
  startingStacks: number[]
  buttonSeat: number
  smallBlind: number
  bigBlind: number
  heroSeat: number
}

/** Pack the position in front of `heroSeat` for the worker. */
export function toAdviseInput(
  state: HandState,
  startingStacks: readonly number[],
  heroSeat: number,
): AdviseInput {
  return {
    deck: [...state.deck],
    actions: state.actions.map((entry) =>
      entry.action.type === 'raise'
        ? { seat: entry.seat, type: entry.action.type, to: entry.action.to }
        : { seat: entry.seat, type: entry.action.type },
    ),
    seatNames: state.seats.map((seat) => seat.name),
    seatStyles: state.seats.map((seat) => seat.style),
    startingStacks: [...startingStacks],
    buttonSeat: state.buttonSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    heroSeat,
  }
}

/** Replay it back into the position it was packed from. */
export function fromAdviseInput(input: AdviseInput): HandState {
  let state = startHandWithDeck(
    {
      seats: input.seatNames.map((name, i) => ({
        name,
        style: input.seatStyles[i] ?? null,
        stack: input.startingStacks[i]!,
      })),
      buttonSeat: input.buttonSeat,
      smallBlind: input.smallBlind,
      bigBlind: input.bigBlind,
    },
    input.deck as Card[],
  )

  for (const entry of input.actions) {
    const action: Action =
      entry.type === 'raise' ? { type: 'raise', to: entry.to! } : { type: entry.type }
    state = applyAction(state, action)
  }
  return state
}
