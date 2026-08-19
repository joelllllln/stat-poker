import type { Card } from './cards'

export type Street = 'preflop' | 'flop' | 'turn' | 'river'

export type SeatStatus = 'active' | 'folded' | 'allin'

export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Total chips this seat will have committed *on this street* once made. */
  | { type: 'raise'; to: number }

export interface LegalAction {
  type: Action['type']
  /** For `call`, the chips it costs. For `raise`, the smallest legal `to`. */
  min?: number
  /** For `raise`, the largest legal `to` (i.e. all-in). */
  max?: number
}

export interface Seat {
  index: number
  name: string
  /**
   * How this seat plays, as an archetype id, or null for a person.
   *
   * The engine never reads it: a hand plays out identically whoever is sitting
   * there. It rides along on the state because everything that prices a
   * decision — the live coach, the grader, a replayed hand out of storage —
   * gets a `HandState` and nothing else, and pricing a bet against opponents
   * whose style you do not know is what makes a coach model a table it is not
   * sitting at.
   */
  style: string | null
  /** Chips behind. */
  stack: number
  /** Chips put in on the current street. */
  committed: number
  /** Chips put in across the whole hand. */
  totalCommitted: number
  holeCards: readonly [Card, Card] | null
  status: SeatStatus
  /**
   * What this seat had committed when it last acted on this street, or null
   * if it has not acted yet.
   *
   * Two rules read it. A seat that has not acted still owes the street an
   * action even when the price is already matched — that is the big blind's
   * option. And a seat may raise again only when the price has climbed by at
   * least a full raise since it last acted, which is the rule that decides
   * whether a short all-in reopens the betting.
   */
  committedWhenLastActed: number | null
}

export interface ActionRecord {
  seat: number
  street: Street
  action: Action
  /** Chips this action moved from stack to pot. */
  cost: number
  /** Pot before the action, for pot-odds reconstruction in review. */
  potBefore: number
  /** What it cost this seat to continue, before acting. */
  toCall: number
}

export interface PotAward {
  amount: number
  /** Seats that could win this pot. */
  eligible: number[]
  /** Seats that actually won it. */
  winners: number[]
}

export interface HandResult {
  /** Net chips won or lost per seat across the hand. */
  net: number[]
  pots: PotAward[]
  /** True if two or more players saw a showdown. */
  showdown: boolean
  /** Evaluated hand value per seat at showdown, else null. */
  handValues: (number | null)[]
  /**
   * Board cards that were out when betting ended.
   *
   * Anything after this was dealt with no decisions left to make, which is
   * exactly the part of the result that luck decided rather than the players.
   */
  runoutFrom: number
}

export interface HandState {
  seats: Seat[]
  buttonSeat: number
  smallBlind: number
  bigBlind: number
  street: Street
  board: Card[]
  /** Shuffled deck; `deckIndex` is the next undealt card. */
  deck: readonly Card[]
  deckIndex: number
  /** Highest `committed` on the current street. */
  currentBet: number
  /** Size of the last full raise, which sets the minimum for the next one. */
  lastRaiseSize: number
  /** Seat to act, or null when the hand is complete. */
  toAct: number | null
  /**
   * Board size at the moment betting ended for good, or null while betting can
   * still happen. Cards dealt after this point were decided by the deck alone.
   */
  runoutFrom: number | null
  actions: ActionRecord[]
  result: HandResult | null
}

export interface HandConfig {
  seats: readonly { name: string; stack: number; style?: string | null }[]
  buttonSeat: number
  smallBlind: number
  bigBlind: number
}

/** Total chips in the middle, derived rather than tracked so it cannot drift. */
export const potSize = (state: HandState): number =>
  state.seats.reduce((sum, seat) => sum + seat.totalCommitted, 0)

const SIX_MAX_POSITIONS = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'] as const
const POSITIONS_BY_SIZE: Record<number, readonly string[]> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: SIX_MAX_POSITIONS,
  7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO'],
}

/** Position label for a seat, e.g. `CO`. Heads-up, the button is the small blind. */
export function positionName(seat: number, buttonSeat: number, numSeats: number): string {
  const offset = (seat - buttonSeat + numSeats) % numSeats
  return POSITIONS_BY_SIZE[numSeats]?.[offset] ?? `Seat ${seat}`
}
