/**
 * The preflop game, as a solvable tree.
 *
 * What this models honestly, and what it does not:
 *
 * The betting is real — positions, blinds, a capped ladder of raise sizes, and
 * all-ins. What is abstracted is everything after it. When two or more players
 * see a flop, the pot is split by their all-in equity rather than played out,
 * because modelling postflop play here would mean solving postflop play here.
 *
 * That abstraction is why the output is a *blueprint* and not a solution. It
 * prices hands by how they run against each other rather than by how well they
 * play, so it slightly overvalues hands that realise less of their equity than
 * raw showdown suggests — big offsuit cards out of position — and undervalues
 * hands that realise more, like suited connectors. The equity-realisation
 * factor below leans against that; it does not remove it.
 */

import { CHANCE, type Game } from './cfr'
import { CLASSES, CLASS_INDEX, MATCHUP } from './matchup-table'
import { NUM_CARDS, rankOf, suitOf, RANKS, type Card } from '../engine/cards'
import { positionName } from '../engine/types'

export const FOLD = 0
export const CALL = 1
export const RAISE = 2
export const ALL_IN = 3
export const ACTION_NAMES = ['fold', 'call', 'raise', 'all-in']

/**
 * How much of its raw showdown equity a hand actually keeps, by position.
 *
 * A hand that has to act first for the rest of the hand realises less than its
 * share; one that acts last realises more. Without this the solve produces
 * ranges that are too wide out of position and too tight on the button.
 */
const OUT_OF_POSITION_REALISATION = 0.94
const IN_POSITION_REALISATION = 1.06

/** Raise ladder, as a multiple of the current bet. The first is in blinds. */
const OPEN_SIZE = 2.5
const RAISE_MULTIPLES = [3, 2.2, 2.2]
const MAX_RAISES = 3

export interface PreflopConfig {
  players: number
  /** Starting stack in big blinds; equal for everyone, so no side pots arise. */
  stack: number
  smallBlind: number
}

export const DEFAULT_CONFIG: PreflopConfig = { players: 6, stack: 100, smallBlind: 0.5 }

export interface PreflopState {
  /** Hand class index per player, or null before the deal. */
  hands: number[] | null
  committed: number[]
  folded: boolean[]
  allIn: boolean[]
  acted: boolean[]
  toAct: number
  currentBet: number
  raiseCount: number
  history: string
}

/**
 * Position labels, seat 0 being the small blind.
 *
 * Delegates to the engine's own naming so a seat is never called `CO` on the
 * table and something else in a solved range.
 */
export function positionsFor(players: number): string[] {
  // Heads-up the small blind is the button; otherwise the button acts last.
  const buttonSeat = players === 2 ? 0 : players - 1
  return Array.from({ length: players }, (_, seat) =>
    positionName(seat, buttonSeat, players),
  )
}

const liveCount = (state: PreflopState): number =>
  state.folded.filter((f) => !f).length

const canAct = (state: PreflopState, seat: number): boolean =>
  !state.folded[seat] && !state.allIn[seat]

function nextToAct(state: PreflopState, from: number): number {
  const n = state.committed.length
  for (let step = 1; step <= n; step++) {
    const seat = (from + step) % n
    if (canAct(state, seat)) return seat
  }
  return -1
}

function bettingClosed(state: PreflopState): boolean {
  if (liveCount(state) <= 1) return true
  const actors = state.committed.map((_, seat) => seat).filter((seat) => canAct(state, seat))
  if (actors.length === 0) return true
  if (actors.some((seat) => state.committed[seat]! !== state.currentBet)) return false
  if (actors.length === 1) {
    // One player left with everyone else all-in has nothing left to bet into,
    // but still gets their option if they have not acted.
    return state.acted[actors[0]!]!
  }
  return actors.every((seat) => state.acted[seat]!)
}

/** Share of the pot each live hand takes at an equity showdown. */
function showdownShares(state: PreflopState, config: PreflopConfig): number[] {
  const live = state.committed.map((_, seat) => seat).filter((seat) => !state.folded[seat])
  const shares = new Array<number>(state.committed.length).fill(0)
  if (live.length === 1) {
    shares[live[0]!] = 1
    return shares
  }

  // Multiway equity is approximated by chaining the pairwise matchups: a hand
  // that beats each opponent often takes the pot often. It is not exact —
  // exact multiway equity is not a product of pairwise equities — but it
  // preserves the ordering that matters for a preflop decision.
  const raw = live.map((seat) => {
    const mine = state.hands![seat]!
    let product = 1
    for (const other of live) {
      if (other === seat) continue
      product *= MATCHUP[mine]![state.hands![other]!]!
    }
    // Position is fixed preflop, so realisation can be applied here: the later
    // a seat acts, the more of its equity it keeps.
    const isLate = seat >= config.players - 2
    return product * (isLate ? IN_POSITION_REALISATION : OUT_OF_POSITION_REALISATION)
  })

  const total = raw.reduce((a, b) => a + b, 0)
  live.forEach((seat, i) => {
    shares[seat] = total === 0 ? 1 / live.length : raw[i]! / total
  })
  return shares
}

function raiseTarget(state: PreflopState, config: PreflopConfig): number {
  if (state.raiseCount === 0) return OPEN_SIZE
  const multiple = RAISE_MULTIPLES[Math.min(state.raiseCount - 1, RAISE_MULTIPLES.length - 1)]!
  return Math.min(state.currentBet * multiple, config.stack)
}

/**
 * The actions available to the seat to act.
 *
 * Exported because the information-set key depends on it: a lookup against the
 * solved blueprint has to reproduce exactly the choices the solve was trained
 * on, not the ones the live table happens to offer.
 */
export function legalPreflopActions(
  state: PreflopState,
  config: PreflopConfig = DEFAULT_CONFIG,
): number[] {
  const seat = state.toAct
  const toCall = state.currentBet - state.committed[seat]!
  const behind = config.stack - state.committed[seat]!
  const options: number[] = []

  if (toCall > 0) options.push(FOLD)
  options.push(CALL)

  if (behind > toCall && state.raiseCount < MAX_RAISES) {
    const target = raiseTarget(state, config)
    // Only offer a sized raise when it is a real raise and not effectively
    // the whole stack; otherwise all-in already covers it.
    if (target > state.currentBet && target < config.stack) options.push(RAISE)
    options.push(ALL_IN)
  } else if (behind > toCall) {
    options.push(ALL_IN)
  }

  return options
}

export function createPreflopGame(config: PreflopConfig = DEFAULT_CONFIG): Game<PreflopState> {
  const n = config.players
  const legalActions = (state: PreflopState) => legalPreflopActions(state, config)

  const root = (): PreflopState => {
    const committed = new Array<number>(n).fill(0)
    // Heads-up the button posts the small blind; seat 0 is always the small
    // blind, so the labelling holds either way.
    committed[0] = config.smallBlind
    committed[1] = 1

    const state: PreflopState = {
      hands: null,
      committed,
      folded: new Array<boolean>(n).fill(false),
      allIn: new Array<boolean>(n).fill(false),
      acted: new Array<boolean>(n).fill(false),
      toAct: n === 2 ? 0 : 2 % n,
      currentBet: 1,
      raiseCount: 0,
      history: '',
    }
    return state
  }

  const clone = (state: PreflopState): PreflopState => ({
    ...state,
    committed: [...state.committed],
    folded: [...state.folded],
    allIn: [...state.allIn],
    acted: [...state.acted],
  })

  return {
    players: n,
    root,

    // The deal is sampled rather than enumerated: there are far too many ways
    // to give six players two cards each to walk them all.
    sampleChance(state, random) {
      const deck: Card[] = []
      for (let card = 0; card < NUM_CARDS; card++) deck.push(card)
      for (let i = 0; i < n * 2; i++) {
        const j = i + Math.floor(random() * (deck.length - i))
        const tmp = deck[i]!
        deck[i] = deck[j]!
        deck[j] = tmp
      }

      const hands: number[] = []
      for (let seat = 0; seat < n; seat++) {
        const a = deck[seat * 2]!
        const b = deck[seat * 2 + 1]!
        const high = Math.max(rankOf(a), rankOf(b))
        const low = Math.min(rankOf(a), rankOf(b))
        const label =
          high === low
            ? `${RANKS[high]}${RANKS[low]}`
            : `${RANKS[high]}${RANKS[low]}${suitOf(a) === suitOf(b) ? 's' : 'o'}`
        hands.push(CLASS_INDEX[label]!)
      }
      return { ...clone(state), hands }
    },

    chanceOutcomes: () => {
      throw new Error('The preflop deal is sampled, not enumerated')
    },

    isTerminal: (state) => state.hands !== null && bettingClosed(state),

    currentPlayer: (state) => (state.hands === null ? CHANCE : state.toAct),

    actions: legalActions,

    next(state, action) {
      const next = clone(state)
      const seat = next.toAct
      const behind = config.stack - next.committed[seat]!

      switch (action) {
        case FOLD:
          next.folded[seat] = true
          next.history += 'f'
          break

        case CALL: {
          const toCall = Math.min(next.currentBet - next.committed[seat]!, behind)
          next.committed[seat]! += toCall
          if (next.committed[seat]! >= config.stack) next.allIn[seat] = true
          next.history += 'c'
          break
        }

        case RAISE:
        case ALL_IN: {
          const target = action === ALL_IN ? config.stack : raiseTarget(next, config)
          next.committed[seat] = Math.min(target, config.stack)
          if (next.committed[seat]! >= config.stack) next.allIn[seat] = true
          next.currentBet = Math.max(next.currentBet, next.committed[seat]!)
          next.raiseCount += 1
          // A raise puts everyone else back in the decision.
          for (let other = 0; other < n; other++) {
            if (other !== seat && canAct(next, other)) next.acted[other] = false
          }
          next.history += action === ALL_IN ? 'a' : 'r'
          break
        }
      }

      next.acted[seat] = true
      next.toAct = nextToAct(next, seat)
      if (next.toAct < 0) next.toAct = seat
      return next
    },

    /**
     * What the acting seat actually knows, abstracted to the shape of the
     * decision rather than the literal sequence that produced it.
     *
     * The raw history separates `fold, call, raise` from `call, fold, raise`
     * even though the seat now facing a raise sees exactly the same problem.
     * Keeping the sequence produced three quarters of a million information
     * sets, almost all of them visited too rarely to learn anything from. The
     * betting context — who is still in, who raised last, how many raises
     * there have been, and the price — is what the decision depends on.
     */
    infoSet: (state) => infoSetFor(state, legalActions(state)),

    payoff(state, player) {
      const pot = state.committed.reduce((a, b) => a + b, 0)
      const shares = showdownShares(state, config)
      return shares[player]! * pot - state.committed[player]!
    },
  }
}

/**
 * Price buckets, in big blinds, for what it costs to continue.
 *
 * The price has to be part of the context. Without it, an open to 2.5 blinds
 * and a hundred-blind shove both read as "one raise so far" and collapse into
 * the same decision — which is not an approximation, it is two unrelated spots
 * sharing a strategy.
 */
const PRICE_BUCKETS = [0, 1, 2, 3.5, 6, 10, 18, 35, 70]

const priceBucket = (toCall: number): number => {
  let bucket = 0
  for (let i = 0; i < PRICE_BUCKETS.length; i++) {
    if (toCall >= PRICE_BUCKETS[i]!) bucket = i
  }
  return bucket
}

/**
 * The betting context a seat faces, independent of the order it arose in.
 *
 * `live` is a bitmask of seats still in the hand, so position is preserved
 * exactly; `aggressor` is the seat of the last raise, or `-` when the pot is
 * unraised; and the price bucket separates a small open from a shove.
 */
export function contextOf(state: PreflopState): string {
  let live = 0
  for (let seat = 0; seat < state.folded.length; seat++) {
    if (!state.folded[seat]) live |= 1 << seat
  }
  let aggressor = '-'
  for (let seat = 0; seat < state.committed.length; seat++) {
    if (!state.folded[seat] && state.committed[seat] === state.currentBet && state.raiseCount > 0) {
      aggressor = String(seat)
    }
  }
  const toCall = state.currentBet - state.committed[state.toAct]!
  return `${live.toString(36)}.${aggressor}.${state.raiseCount}.${priceBucket(toCall)}`
}

/**
 * The information set key.
 *
 * The legal actions are appended so that states sharing a key always offer the
 * same choices. Two states that look alike but differ in what can be done in
 * them are not the same decision, and merging them lets the solver hand back a
 * strategy over actions that are not available.
 */
export const infoSetFor = (state: PreflopState, actions: readonly number[]): string =>
  `${state.toAct}|${CLASSES[state.hands![state.toAct]!]}|${contextOf(state)}|${actions.join('')}`

/** Key for a seat holding `hand` in a given betting context. */
export const infoSetKey = (seat: number, hand: string, context: string): string =>
  `${seat}|${hand}|${context}`
