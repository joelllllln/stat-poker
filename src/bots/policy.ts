/**
 * Bot decision-making.
 *
 * The policy is the same shape as the coach's: estimate equity against the
 * opponents' modelled ranges, compare it with the price being offered, and act.
 * Archetypes distort that comparison rather than replacing it, which is why the
 * bots stay believable — a station is not random, it is a player calling with
 * the wrong threshold.
 */

import type { Rng } from '../engine/cards'
import { legalActions } from '../engine/hand'
import { potSize, type Action, type HandState } from '../engine/types'
import { handEquity } from '../equity/equity'
import { liveOpponentRanges } from '../equity/opponent'
import { preflopStrength } from '../equity/preflop'
import { parseRange } from '../equity/range'
import { requiredEquity } from '../coach/odds'
import { positionalOpenWidth, type Archetype } from './archetypes'

/** Rollouts per postflop decision. Enough to rank actions, cheap enough to be instant. */
const BOT_ITERATIONS = 400

/** Clamp a desired raise size into what the rules actually allow. */
function raiseWithin(state: HandState, target: number): Action | null {
  const option = legalActions(state).find((o) => o.type === 'raise')
  if (!option) return null
  const to = Math.max(option.min!, Math.min(option.max!, Math.round(target)))
  return { type: 'raise', to }
}

const passive = (state: HandState): Action =>
  legalActions(state).some((o) => o.type === 'check') ? { type: 'check' } : { type: 'call' }

const giveUp = (state: HandState): Action =>
  legalActions(state).some((o) => o.type === 'check') ? { type: 'check' } : { type: 'fold' }

/** Seats still to act behind this one, which is what tightens an opening range. */
function seatsBehind(state: HandState, seat: number): number {
  const n = state.seats.length
  let count = 0
  for (let step = 1; step < n; step++) {
    const other = state.seats[(seat + step) % n]!
    if (other.status === 'active' && !state.actions.some((a) => a.seat === other.index)) count++
  }
  return count
}

function decidePreflop(
  state: HandState,
  seat: number,
  bot: Archetype,
  rng: Rng,
): Action {
  const me = state.seats[seat]!
  const strength = preflopStrength(me.holeCards!).percentile
  const toCall = state.currentBet - me.committed
  const raisesSoFar = state.actions.filter(
    (a) => a.street === 'preflop' && a.action.type === 'raise',
  ).length

  // Nobody has raised: this is an opening decision.
  if (raisesSoFar === 0) {
    const width = positionalOpenWidth(bot.openWidth, seatsBehind(state, seat))
    if (strength >= 1 - width) {
      const open = raiseWithin(state, state.bigBlind * 2.5 + potSize(state) * 0.25)
      if (open) return open
    }
    // Passive players come along for the ride rather than folding or raising.
    if (toCall > 0 && strength >= 1 - bot.limpWidth) return { type: 'call' }
    return giveUp(state)
  }

  // Facing a raise: reraise the top of the range, continue with the rest of it.
  const defendWidth = bot.defendWidth / Math.max(1, raisesSoFar)
  const reraiseWidth = bot.reraiseWidth / Math.max(1, raisesSoFar)

  if (strength >= 1 - reraiseWidth && rng.nextFloat() < bot.aggression) {
    const threeBet = raiseWithin(state, state.currentBet * 3)
    if (threeBet) return threeBet
  }

  if (strength >= 1 - defendWidth) return toCall > 0 ? { type: 'call' } : passive(state)
  return giveUp(state)
}

function decidePostflop(state: HandState, seat: number, bot: Archetype, rng: Rng): Action {
  const me = state.seats[seat]!
  const pot = potSize(state)
  const toCall = state.currentBet - me.committed

  let opponents = liveOpponentRanges(state, seat)
  if (opponents.length === 0) return passive(state)

  let equity: number
  try {
    equity = handEquity(me.holeCards!, opponents, state.board, {
      rng,
      iterations: BOT_ITERATIONS,
    }).equity
  } catch {
    // A modelled range can be wiped out by blockers on a paired, coordinated
    // board. Fall back to the widest possible read rather than guessing.
    opponents = opponents.map(() => parseRange('random'))
    equity = handEquity(me.holeCards!, opponents, state.board, {
      rng,
      iterations: BOT_ITERATIONS,
    }).equity
  }

  // Facing a bet.
  if (toCall > 0) {
    const needed = requiredEquity(toCall, pot) * bot.callDiscipline
    if (equity > 0.78 && rng.nextFloat() < bot.aggression) {
      const raise = raiseWithin(state, state.currentBet + (pot + toCall) * bot.betSizing)
      if (raise) return raise
    }
    return equity >= needed ? { type: 'call' } : { type: 'fold' }
  }

  // Checked to, or first to act. The bar for value rises with the number of
  // players still to get through: a hand good enough to bet into one opponent
  // is not good enough to bet into three. Betting too rarely is what makes
  // bots check hands down to showdown far more often than real players do.
  const valueBar = 0.5 + 0.06 * opponents.length
  const wantsValue = equity > valueBar && rng.nextFloat() < bot.aggression
  const wantsBluff = equity < 0.35 && rng.nextFloat() < bot.bluffFrequency
  if (wantsValue || wantsBluff) {
    const bet = raiseWithin(state, pot * bot.betSizing)
    if (bet) return bet
  }
  return passive(state)
}

/** Choose an action for `seat`. The result is always legal. */
export function decide(state: HandState, seat: number, bot: Archetype, rng: Rng): Action {
  if (state.toAct !== seat) throw new Error(`Seat ${seat} is not to act`)
  const action =
    state.street === 'preflop'
      ? decidePreflop(state, seat, bot, rng)
      : decidePostflop(state, seat, bot, rng)

  // A policy bug must never crash a hand; fall back to the safest legal move.
  const options = legalActions(state)
  if (!options.some((o) => o.type === action.type)) return giveUp(state)
  return action
}
