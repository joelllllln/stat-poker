/**
 * The betting engine: a pure reducer over hand state.
 *
 * `applyAction` is total and side-effect free — no randomness, no clock, no
 * I/O. The deck is shuffled outside and handed in, so a hand is fully
 * determined by `(seed, actions[])`. That property is what makes replay,
 * "run it again" analysis, and deterministic tests possible, and it is worth
 * more than any convenience that would break it.
 */

import { shuffledDeck, type Card, type Rng } from './cards'
import { evaluate } from './evaluator'
import {
  potSize,
  type Action,
  type ActionRecord,
  type HandConfig,
  type HandResult,
  type HandState,
  type LegalAction,
  type PotAward,
  type Seat,
  type Street,
} from './types'

const NEXT_STREET: Record<Street, Street | null> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: null,
}

const CARDS_DEALT: Record<Street, number> = { preflop: 0, flop: 3, turn: 1, river: 1 }

const cloneSeat = (seat: Seat): Seat => ({ ...seat })
const cloneState = (state: HandState): HandState => ({
  ...state,
  seats: state.seats.map(cloneSeat),
  board: [...state.board],
  actions: [...state.actions],
})

const seatsWhere = (state: HandState, predicate: (seat: Seat) => boolean): Seat[] =>
  state.seats.filter(predicate)

const contenders = (state: HandState): Seat[] => seatsWhere(state, (s) => s.status !== 'folded')
const actors = (state: HandState): Seat[] => seatsWhere(state, (s) => s.status === 'active')

/** Next seat clockwise that can still act voluntarily. */
function nextActor(state: HandState, from: number): number | null {
  const n = state.seats.length
  for (let step = 1; step <= n; step++) {
    const index = (from + step) % n
    if (state.seats[index]!.status === 'active') return index
  }
  return null
}

/** Move chips from a seat's stack into the pot, going all-in if it cannot cover. */
function commit(seat: Seat, amount: number): number {
  const paid = Math.min(amount, seat.stack)
  seat.stack -= paid
  seat.committed += paid
  seat.totalCommitted += paid
  if (seat.stack === 0) seat.status = 'allin'
  return paid
}

export function startHand(config: HandConfig, rng: Rng): HandState {
  return startHandWithDeck(config, shuffledDeck(rng))
}

/**
 * Start a hand from a specific deck. Seat `i` is dealt `deck[2i]` and
 * `deck[2i+1]`, and the board follows the last hole card.
 *
 * Used by replay (which reconstructs the deck from the seed) and by tests that
 * need a known runout.
 */
export function startHandWithDeck(config: HandConfig, deck: readonly Card[]): HandState {
  const { seats: seatConfigs, buttonSeat, smallBlind, bigBlind } = config
  if (seatConfigs.length < 2) throw new Error('A hand needs at least two seats')
  if (seatConfigs.some((s) => s.stack <= 0)) throw new Error('Every seat needs chips')
  if (deck.length < seatConfigs.length * 2 + 5) throw new Error('Deck too small for this table')

  const seats: Seat[] = seatConfigs.map((seat, index) => ({
    index,
    name: seat.name,
    stack: seat.stack,
    committed: 0,
    totalCommitted: 0,
    holeCards: null,
    status: 'active',
    hasActed: false,
    mayRaise: true,
  }))

  let deckIndex = 0
  for (const seat of seats) {
    seat.holeCards = [deck[deckIndex++]!, deck[deckIndex++]!]
  }

  const n = seats.length
  // Heads-up, the button posts the small blind and acts first preflop.
  const sbSeat = n === 2 ? buttonSeat : (buttonSeat + 1) % n
  const bbSeat = n === 2 ? (buttonSeat + 1) % n : (buttonSeat + 2) % n

  commit(seats[sbSeat]!, smallBlind)
  commit(seats[bbSeat]!, bigBlind)

  const state: HandState = {
    seats,
    buttonSeat,
    smallBlind,
    bigBlind,
    street: 'preflop',
    board: [],
    deck,
    deckIndex,
    // A big blind too short to post in full still sets the price at one big
    // blind for everyone behind; the shortfall becomes a side pot.
    currentBet: Math.max(bigBlind, ...seats.map((s) => s.committed)),
    lastRaiseSize: bigBlind,
    toAct: null,
    runoutFrom: null,
    actions: [],
    result: null,
  }

  // Action starts left of the big blind, which heads-up is the button again.
  state.toAct = nextActor(state, bbSeat)
  return advance(state)
}

export function legalActions(state: HandState): LegalAction[] {
  if (state.toAct === null) return []
  const seat = state.seats[state.toAct]!
  const toCall = state.currentBet - seat.committed
  const options: LegalAction[] = [{ type: 'fold' }]

  if (toCall <= 0) options.push({ type: 'check' })
  else options.push({ type: 'call', min: Math.min(toCall, seat.stack) })

  const maxTo = seat.committed + seat.stack
  if (seat.mayRaise && maxTo > state.currentBet) {
    // A raise must add at least the last full raise, except that a seat may
    // always move all-in for less.
    const minTo = Math.min(state.currentBet + state.lastRaiseSize, maxTo)
    options.push({ type: 'raise', min: minTo, max: maxTo })
  }

  return options
}

function assertLegal(state: HandState, action: Action): void {
  const options = legalActions(state)
  const option = options.find((o) => o.type === action.type)
  if (!option) throw new Error(`Illegal action ${action.type} for seat ${state.toAct}`)
  if (action.type === 'raise') {
    const { min = 0, max = 0 } = option
    if (action.to < min || action.to > max) {
      throw new Error(`Raise to ${action.to} outside legal range ${min}..${max}`)
    }
  }
}

export function applyAction(state: HandState, action: Action): HandState {
  if (state.toAct === null) throw new Error('Hand is complete')
  assertLegal(state, action)

  const next = cloneState(state)
  const seat = next.seats[next.toAct!]!
  const potBefore = potSize(state)
  const toCall = next.currentBet - seat.committed
  let cost = 0

  switch (action.type) {
    case 'fold':
      seat.status = 'folded'
      break

    case 'check':
      break

    case 'call':
      cost = commit(seat, toCall)
      break

    case 'raise': {
      const raiseSize = action.to - next.currentBet
      cost = commit(seat, action.to - seat.committed)
      const isFullRaise = raiseSize >= next.lastRaiseSize
      next.currentBet = seat.committed

      if (isFullRaise) {
        next.lastRaiseSize = raiseSize
        // A full raise reopens the betting for everyone still able to act.
        for (const other of next.seats) {
          if (other.index !== seat.index && other.status === 'active') {
            other.hasActed = false
            other.mayRaise = true
          }
        }
      } else {
        // A short all-in does not reopen betting: seats that already acted may
        // now only call or fold.
        for (const other of next.seats) {
          if (other.index !== seat.index && other.status === 'active' && other.hasActed) {
            other.mayRaise = false
          }
        }
      }
      break
    }
  }

  seat.hasActed = true
  next.actions.push({
    seat: seat.index,
    street: next.street,
    action,
    cost,
    potBefore,
    toCall,
  } satisfies ActionRecord)

  next.toAct = nextActor(next, seat.index)
  return advance(next)
}

/** True when nobody still has a decision to make on this street. */
function bettingRoundComplete(state: HandState): boolean {
  const canAct = actors(state)
  if (canAct.length === 0) return true
  if (canAct.some((s) => s.committed !== state.currentBet)) return false
  // One player left to act has nobody to bet into once everyone else is
  // all-in or folded, so a matched bet ends the round.
  if (canAct.length === 1) return true
  return canAct.every((s) => s.hasActed)
}

function beginStreet(state: HandState, street: Street): void {
  state.street = street
  for (let i = 0; i < CARDS_DEALT[street]; i++) {
    state.board.push(state.deck[state.deckIndex++]!)
  }
  for (const seat of state.seats) {
    seat.committed = 0
    seat.hasActed = false
    seat.mayRaise = true
  }
  state.currentBet = 0
  state.lastRaiseSize = state.bigBlind
  // Postflop, action starts with the first live seat left of the button.
  state.toAct = nextActor(state, state.buttonSeat)
}

/**
 * Drive the hand forward as far as it can go without further input: finish
 * streets, deal the board, run it out when everyone is all-in, and settle.
 */
function advance(state: HandState): HandState {
  for (;;) {
    if (contenders(state).length === 1) return settle(state)

    if (state.toAct !== null && !bettingRoundComplete(state)) return state

    const next = NEXT_STREET[state.street]
    if (next === null) return settle(state)

    // With at most one seat able to act, no further betting is possible. Note
    // where the board stood before dealing on: everything from here was the
    // deck's decision, not a player's, which is what all-in adjustment prices.
    if (actors(state).length <= 1) state.runoutFrom ??= state.board.length

    beginStreet(state, next)
    if (actors(state).length <= 1) state.toAct = null
  }
}

/**
 * Split the pot into main and side pots.
 *
 * Every seat contributes to each pot layer up to its own total commitment,
 * including seats that folded — their chips stay in the middle — but only
 * unfolded seats that reached a layer are eligible to win it.
 */
export function buildPots(state: HandState): PotAward[] {
  const levels = [...new Set(state.seats.map((s) => s.totalCommitted).filter((c) => c > 0))].sort(
    (a, b) => a - b,
  )

  const pots: PotAward[] = []
  let previous = 0
  for (const level of levels) {
    let amount = 0
    for (const seat of state.seats) {
      amount += Math.min(seat.totalCommitted, level) - Math.min(seat.totalCommitted, previous)
    }
    const eligible = state.seats
      .filter((s) => s.status !== 'folded' && s.totalCommitted >= level)
      .map((s) => s.index)

    if (amount > 0) pots.push({ amount, eligible, winners: [] })
    previous = level
  }
  return pots
}

/**
 * Chips nobody matched are returned rather than won — this is what makes a
 * shove into a shorter stack cost only what the short stack could call.
 */
function returnUncalledChips(state: HandState): void {
  const totals = state.seats.map((s) => s.totalCommitted)
  const highest = Math.max(...totals)
  const leaders = state.seats.filter((s) => s.totalCommitted === highest)
  if (leaders.length !== 1) return // Two seats matched it: nothing was uncalled.

  const leader = leaders[0]!
  const cap = Math.max(0, ...totals.filter((t) => t < highest))
  const excess = highest - cap
  if (excess > 0) {
    leader.stack += excess
    leader.totalCommitted -= excess
  }
}

/**
 * Split each pot among the best eligible hands.
 *
 * Returns chips won per seat rather than mutating, so the same rules can price
 * a hypothetical runout without disturbing the hand that was actually played.
 */
export function awardPots(
  pots: PotAward[],
  handValues: readonly (number | null)[],
  buttonSeat: number,
  numSeats: number,
): number[] {
  const winnings = new Array<number>(numSeats).fill(0)

  for (const pot of pots) {
    const best = Math.max(...pot.eligible.map((i) => handValues[i] ?? -1))
    const winners = pot.eligible.filter((i) => handValues[i] === best)
    pot.winners = winners

    const share = Math.floor(pot.amount / winners.length)
    let remainder = pot.amount - share * winners.length
    for (const index of winners) winnings[index]! += share

    // Odd chips go to the first winner left of the button, as at a table.
    for (let step = 1; step <= numSeats && remainder > 0; step++) {
      const index = (buttonSeat + step) % numSeats
      if (winners.includes(index)) {
        winnings[index]! += 1
        remainder -= 1
      }
    }
  }

  return winnings
}

function settle(state: HandState): HandState {
  returnUncalledChips(state)

  const startingStacks = state.seats.map((s) => s.stack + s.totalCommitted)
  const live = contenders(state)
  const pots = buildPots(state)
  const handValues: (number | null)[] = state.seats.map(() => null)
  const runoutFrom = state.runoutFrom ?? state.board.length

  if (live.length === 1) {
    // Everyone folded — the last player standing takes it without showing.
    const winner = live[0]!
    for (const pot of pots) {
      pot.winners = [winner.index]
      winner.stack += pot.amount
    }
  } else {
    // Deal any streets the hand never reached, then show down.
    while (NEXT_STREET[state.street] !== null) {
      const next = NEXT_STREET[state.street]!
      state.street = next
      for (let i = 0; i < CARDS_DEALT[next]; i++) {
        state.board.push(state.deck[state.deckIndex++]!)
      }
    }

    for (const seat of live) {
      handValues[seat.index] = evaluate([...seat.holeCards!, ...state.board])
    }

    const winnings = awardPots(pots, handValues, state.buttonSeat, state.seats.length)
    winnings.forEach((amount, index) => {
      state.seats[index]!.stack += amount
    })
  }

  state.toAct = null
  state.result = {
    net: state.seats.map((seat, i) => seat.stack - startingStacks[i]!),
    pots,
    showdown: live.length > 1,
    handValues,
    runoutFrom,
  } satisfies HandResult

  return state
}

/** Convenience for tests and bots: is the hand over? */
export const isComplete = (state: HandState): boolean => state.result !== null
