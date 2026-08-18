/**
 * What to do, at a decision that has not been made yet.
 *
 * The same pricing that grades the hand afterwards, applied to the position as
 * it stands. That is the whole claim of the live coach, and it only holds if
 * both sides price the spot identically — same model, same sizes, same seed —
 * so the seed is shared with the grader and this lives beside it rather than
 * inside the worker, where nothing could test it.
 */

import { winnablePot } from '../engine/hand'
import { potSize, type HandState } from '../engine/types'
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
