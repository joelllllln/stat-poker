/**
 * Looking a live decision up in the solved preflop strategy.
 *
 * The solve covers heads-up preflop, which in a six-handed game is the spot
 * reached whenever everyone folds to the blinds — the most frequently repeated
 * situation at the table. A hand is only looked up when it translates into that
 * game: two players left, no dead money from anyone who folded, and an
 * effective stack near one of the depths that was solved.
 *
 * Depth is part of the game rather than a detail of it — twenty blinds is a
 * shove-or-fold game and a hundred is not — so several depths are solved and a
 * hand is answered from the nearest, or from none. Anything that does not
 * translate returns nothing rather than a near miss: a strategy borrowed from a
 * different spot is not an approximation, it is the wrong answer delivered with
 * the same confidence as a right one.
 */

import { rankOf, suitOf, RANKS, type Card } from '../engine/cards'
import type { HandState } from '../engine/types'
import {
  BLUEPRINTS,
  BLUEPRINT_DEPTHS,
  BLUEPRINT_EXPLOITABILITY,
} from './blueprint-table'
import { CLASS_INDEX } from './matchup-table'
import { ACTION_NAMES, contextOf, type PreflopConfig, type PreflopState } from './preflop'
import { headsUpActions } from './preflop-hu'

/** Stacks may sit this far from a solved depth and still use its strategy. */
const DEPTH_TOLERANCE = 0.25

const configFor = (stack: number): PreflopConfig => ({ players: 2, stack, smallBlind: 0.5 })

/**
 * The solved depth closest to what is actually behind, or null.
 *
 * "What is actually behind" is the effective stack — the shorter of the two —
 * because that is the one that can be lost, and a game where one player covers
 * the other by miles is the shorter player's game at their depth.
 */
function nearestDepth(effective: number): number | null {
  let best: number | null = null
  let bestGap = Infinity
  for (const depth of BLUEPRINT_DEPTHS) {
    const gap = Math.abs(effective - depth) / depth
    if (gap < bestGap) {
      bestGap = gap
      best = depth
    }
  }
  return best !== null && bestGap <= DEPTH_TOLERANCE ? best : null
}

export interface BlueprintAction {
  action: number
  label: string
  frequency: number
}

export interface BlueprintAdvice {
  actions: BlueprintAction[]
  /** The most frequent action, for a one-line summary. */
  primary: BlueprintAction
  /** True when the strategy genuinely mixes rather than always doing one thing. */
  mixed: boolean
  /** How far from equilibrium the solve that produced this got, in bb/hand. */
  exploitability: number
  /** The depth this advice was solved at, in big blinds. */
  stack: number
}

/** The 169-class label for a holding, e.g. `AKs`. */
export function classOf(cards: readonly [Card, Card]): string {
  const high = Math.max(rankOf(cards[0]), rankOf(cards[1]))
  const low = Math.min(rankOf(cards[0]), rankOf(cards[1]))
  if (high === low) return `${RANKS[high]}${RANKS[low]}`
  return `${RANKS[high]}${RANKS[low]}${suitOf(cards[0]) === suitOf(cards[1]) ? 's' : 'o'}`
}

/**
 * Translate a live hand into the solved heads-up game, or return null.
 *
 * The checks are deliberately strict. Dead money left behind by a player who
 * limped and folded changes the price of every subsequent decision, and a
 * strategy solved for a hundred blinds is simply a different strategy from the
 * one that is right for twenty.
 */
export function toHeadsUpState(
  state: HandState,
  seat: number,
): { state: PreflopState; config: PreflopConfig } | null {
  if (state.street !== 'preflop') return null
  if (state.toAct !== seat) return null

  const hero = state.seats[seat]
  if (!hero?.holeCards) return null

  const n = state.seats.length
  const bigBlind = state.bigBlind
  const sbSeat = n === 2 ? state.buttonSeat : (state.buttonSeat + 1) % n
  const bbSeat = n === 2 ? (state.buttonSeat + 1) % n : (state.buttonSeat + 2) % n

  const live = state.seats.filter((s) => s.status !== 'folded')
  if (live.length !== 2) return null
  // The two survivors must be the blinds themselves, not a late seat that
  // stole: the solved game starts from a pot of exactly the two blinds.
  if (!live.some((s) => s.index === sbSeat) || !live.some((s) => s.index === bbSeat)) return null
  // Nobody who folded may have put chips in, or the pot is bigger than solved.
  if (state.seats.some((s) => s.status === 'folded' && s.totalCommitted > 0)) return null

  const depths = live.map((s) => (s.stack + s.totalCommitted) / bigBlind)
  const depth = nearestDepth(Math.min(...depths))
  if (depth === null) return null
  const config = configFor(depth)

  const toSolverSeat = (engineSeat: number) => (engineSeat === sbSeat ? 0 : 1)
  const committed: number[] = [0, 0]
  const folded: boolean[] = [false, false]
  const allIn: boolean[] = [false, false]
  const acted: boolean[] = [false, false]

  for (const s of live) {
    const index = toSolverSeat(s.index)
    committed[index] = s.committed / bigBlind
    allIn[index] = s.status === 'allin'
    acted[index] = s.committedWhenLastActed !== null
  }

  const raiseCount = state.actions.filter(
    (entry) => entry.street === 'preflop' && entry.action.type === 'raise',
  ).length

  const hands = [0, 0]
  hands[toSolverSeat(seat)] = CLASS_INDEX[classOf(hero.holeCards)]!

  return {
    config,
    state: {
      hands,
      committed,
      folded,
      allIn,
      acted,
      toAct: toSolverSeat(seat),
      currentBet: state.currentBet / bigBlind,
      raiseCount,
      history: '',
    },
  }
}

/** The solved strategy for this spot, or null when it is not covered. */
export function lookupPreflop(state: HandState, seat: number): BlueprintAdvice | null {
  const translated = toHeadsUpState(state, seat)
  if (!translated) return null

  const { state: solved, config } = translated
  const table = BLUEPRINTS[config.stack]
  if (!table) return null

  const actions = headsUpActions(solved, config)
  const key = `${solved.toAct}|${classOf(state.seats[seat]!.holeCards!)}|${contextOf(solved)}|${actions.join('')}`
  const frequencies = table[key]
  if (!frequencies || frequencies.length !== actions.length) return null

  const entries: BlueprintAction[] = actions.map((action, i) => ({
    action,
    label: ACTION_NAMES[action]!,
    frequency: frequencies[i]!,
  }))

  const primary = entries.reduce((a, b) => (b.frequency > a.frequency ? b : a))
  return {
    actions: entries,
    primary,
    // A strategy that plays one action more than nine times in ten is not
    // meaningfully mixing, whatever the remaining fraction says.
    mixed: primary.frequency < 0.9,
    exploitability: BLUEPRINT_EXPLOITABILITY[config.stack] ?? 0,
    stack: config.stack,
  }
}

/** How many spots the shipped blueprint covers, across every depth. */
export const blueprintSize = (): number =>
  BLUEPRINT_DEPTHS.reduce((sum, depth) => sum + Object.keys(BLUEPRINTS[depth] ?? {}).length, 0)
