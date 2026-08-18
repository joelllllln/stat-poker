/**
 * Heads-up preflop, solved properly.
 *
 * The six-handed tree defeated the sampling solver: with a strategy stored per
 * hand per spot, a sampled deal trains only the hands it dealt, and two million
 * of them still left most spots with a handful of observations and a strategy
 * that did not raise aces. The fix is not more iterations, it is not sampling
 * hands at all.
 *
 * This solves the *public* betting tree once per iteration and updates all 169
 * hands at every node simultaneously, carrying each player's range down the
 * tree as a vector. Terminal values then come from the matchup matrix in one
 * pass, weighted by how many ways each pair of holdings can actually be dealt
 * together. It is the standard formulation, it converges in thousands of
 * iterations rather than millions, and — being two-player and zero-sum — its
 * distance from equilibrium can be measured rather than hoped for.
 *
 * Heads-up is not a lesser target than six-handed. Every hand folded to the
 * small blind *is* a heads-up preflop game with exactly these stakes, which
 * makes blind-versus-blind the most frequently repeated spot at the table.
 */

import type { Card } from '../engine/cards'
import { comboClass, parseRange } from '../equity/range'
import { CLASSES, CLASS_INDEX, MATCHUP } from './matchup-table'
import {
  ALL_IN,
  CALL,
  FOLD,
  contextOf,
  legalPreflopActions,
  type PreflopConfig,
  type PreflopState,
} from './preflop'

export const HAND_COUNT = 169

/** Heads-up, the small blind is the button and acts last after the flop. */
const BUTTON_SEAT = 0

/**
 * How much of its raw equity a hand keeps, by whether it will act last.
 *
 * Preflop equity is not what a hand is worth: the player who acts last on
 * every later street converts more of it, and the player who acts first
 * converts less.
 */
const IN_POSITION = 1.08
const OUT_OF_POSITION = 0.92

/**
 * Raw showdown equity, discounted for the position the hand will be played
 * from — but only where there is a hand left to play.
 *
 * Without the discount the model hands every pot straight to a showdown at
 * full equity, which makes seeing a cheap flop far too attractive and produces
 * the tell-tale artefact of a solution that limps aces. The button acts last
 * on every later street and keeps more of its share; the big blind acts first
 * and keeps less.
 *
 * `behind` is what the shallower stack still has when the betting ends, and at
 * zero the discount must vanish: realisation is a claim about converting
 * equity through later streets, and an all-in pot has no later streets to
 * convert it through. The board runs out and the equity is the answer.
 * Discounting anyway priced a coin flip as 54/46 to the button — four points
 * of nothing, applied at exactly the decisions most sensitive to it.
 */
export function realisedEquity(equity: number, player: number, behind: number): number {
  if (behind <= 0) return equity
  const mine = player === BUTTON_SEAT ? IN_POSITION : OUT_OF_POSITION
  const theirs = player === BUTTON_SEAT ? OUT_OF_POSITION : IN_POSITION
  const weighted = equity * mine
  return weighted / (weighted + (1 - equity) * theirs)
}

/** Combinations of each starting-hand class: 6 for a pair, 4 suited, 12 offsuit. */
export const COMBOS: readonly number[] = CLASSES.map((hand) =>
  hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12,
)

/**
 * How many ways two classes can be dealt to two players at once.
 *
 * Card removal is real and matters: two players cannot both hold aces six ways
 * each, and a class blocks itself far more than it blocks anything else.
 * Ignoring this is the usual shortcut, and it is exactly what makes solved
 * ranges wrong about pairs and about ace-blockers.
 */
export function buildCompatibility(): Float64Array {
  const combosByClass: Card[][][] = CLASSES.map(() => [])
  for (const combo of parseRange('random')) {
    combosByClass[CLASS_INDEX[comboClass(combo.cards)]!]!.push([combo.cards[0], combo.cards[1]])
  }

  const table = new Float64Array(HAND_COUNT * HAND_COUNT)
  for (let a = 0; a < HAND_COUNT; a++) {
    for (let b = a; b < HAND_COUNT; b++) {
      let count = 0
      for (const first of combosByClass[a]!) {
        for (const second of combosByClass[b]!) {
          if (
            first[0] !== second[0] &&
            first[0] !== second[1] &&
            first[1] !== second[0] &&
            first[1] !== second[1]
          ) {
            count++
          }
        }
      }
      table[a * HAND_COUNT + b] = count
      table[b * HAND_COUNT + a] = count
    }
  }
  return table
}

interface TerminalInfo {
  /** Seat that wins uncontested, or -1 when the hand goes to showdown. */
  winner: number
  pot: number
  committed: [number, number]
  /**
   * Chips still behind when the betting ended, at the shallower stack.
   *
   * Zero means the hand is all-in and there is no poker left to play: the
   * board simply runs out. That is the difference between a showdown whose
   * value position can influence and one where it cannot.
   */
  behind: number
}

export interface PublicNode {
  /** Seat to act, or -1 at a terminal. */
  toAct: number
  actions: number[]
  children: PublicNode[]
  terminal: TerminalInfo | null
  /** Regret and average strategy per hand per action, laid out hand-major. */
  regret: Float64Array
  strategySum: Float64Array
  context: string
}

/**
 * Build the betting tree without any cards in it.
 *
 * The tree's shape never depends on what anyone holds, which is the property
 * that makes solving all 169 hands in one traversal possible.
 */
export function buildPublicTree(config: PreflopConfig): PublicNode {
  const root: PreflopState = {
    hands: [0, 0],
    committed: [config.smallBlind, 1],
    folded: [false, false],
    allIn: [false, false],
    acted: [false, false],
    toAct: 0,
    currentBet: 1,
    raiseCount: 0,
    history: '',
  }

  const advance = (state: PreflopState, action: number): PreflopState => {
    const next: PreflopState = {
      ...state,
      committed: [...state.committed],
      folded: [...state.folded],
      allIn: [...state.allIn],
      acted: [...state.acted],
    }
    const seat = next.toAct
    const behind = config.stack - next.committed[seat]!

    if (action === FOLD) {
      next.folded[seat] = true
    } else if (action === CALL) {
      const toCall = Math.min(next.currentBet - next.committed[seat]!, behind)
      next.committed[seat]! += toCall
      if (next.committed[seat]! >= config.stack) next.allIn[seat] = true
    } else {
      const target =
        action === ALL_IN
          ? config.stack
          : Math.min(
              next.raiseCount === 0 ? 2.5 : next.currentBet * 3,
              config.stack,
            )
      next.committed[seat] = Math.min(target, config.stack)
      if (next.committed[seat]! >= config.stack) next.allIn[seat] = true
      next.currentBet = Math.max(next.currentBet, next.committed[seat]!)
      next.raiseCount += 1
      const other = 1 - seat
      if (!next.folded[other] && !next.allIn[other]) next.acted[other] = false
    }

    next.acted[seat] = true
    const other = 1 - seat
    next.toAct = !next.folded[other] && !next.allIn[other] ? other : seat
    return next
  }

  const isClosed = (state: PreflopState): boolean => {
    if (state.folded[0] || state.folded[1]) return true
    const actors = [0, 1].filter((seat) => !state.folded[seat] && !state.allIn[seat])
    if (actors.length === 0) return true
    if (actors.some((seat) => state.committed[seat] !== state.currentBet)) return false
    return actors.every((seat) => state.acted[seat])
  }

  const build = (state: PreflopState): PublicNode => {
    if (isClosed(state)) {
      const pot = state.committed[0]! + state.committed[1]!
      const folded = state.folded.findIndex(Boolean)
      return {
        toAct: -1,
        actions: [],
        children: [],
        terminal: {
          winner: folded < 0 ? -1 : 1 - folded,
          pot,
          committed: [state.committed[0]!, state.committed[1]!],
          behind: Math.min(
            config.stack - state.committed[0]!,
            config.stack - state.committed[1]!,
          ),
        },
        regret: new Float64Array(0),
        strategySum: new Float64Array(0),
        context: contextOf(state),
      }
    }

    const actions = headsUpActions(state, config)
    return {
      toAct: state.toAct,
      actions,
      children: actions.map((action) => build(advance(state, action))),
      terminal: null,
      regret: new Float64Array(HAND_COUNT * actions.length),
      strategySum: new Float64Array(HAND_COUNT * actions.length),
      context: contextOf(state),
    }
  }

  return build(root)
}

/**
 * The actions the heads-up tree offers.
 *
 * Limping is not modelled. With a single raise size and a showdown that costs
 * nothing to reach, calling the blind looks strong enough to trap with, and
 * the solve settles on limping aces almost always — an artefact of the
 * abstraction rather than a finding about poker, and one that would teach the
 * habit rather than correct it. Raise-or-fold is the abstraction most training
 * solutions use, and it is honest about what it leaves out.
 *
 * Exported so a live lookup reproduces exactly the choices the solve trained
 * on; a strategy indexed against a different action set is not a near miss,
 * it is the wrong answer.
 */
export function headsUpActions(state: PreflopState, config: PreflopConfig): number[] {
  const opening = state.raiseCount === 0 && state.committed[state.toAct]! < 1
  return legalPreflopActions(state, config).filter(
    (action) => !(opening && action === CALL),
  )
}

/** Regret matching for every hand at once. */
function strategyAt(node: PublicNode): Float64Array {
  const width = node.actions.length
  const strategy = new Float64Array(HAND_COUNT * width)
  for (let hand = 0; hand < HAND_COUNT; hand++) {
    const base = hand * width
    let total = 0
    for (let a = 0; a < width; a++) {
      const positive = Math.max(0, node.regret[base + a]!)
      strategy[base + a] = positive
      total += positive
    }
    if (total > 0) {
      for (let a = 0; a < width; a++) strategy[base + a]! /= total
    } else {
      for (let a = 0; a < width; a++) strategy[base + a] = 1 / width
    }
  }
  return strategy
}

export class HeadsUpPreflopSolver {
  readonly root: PublicNode
  private compatibility: Float64Array

  constructor(config: PreflopConfig) {
    this.root = buildPublicTree(config)
    this.compatibility = buildCompatibility()
  }

  /**
   * Counterfactual values for `player` at a terminal, one per hand.
   *
   * Both branches weight the opponent's range by how many ways each pairing
   * can be dealt, which is where card removal enters the solve.
   */
  private terminalValues(node: PublicNode, player: number, rOpp: Float64Array): Float64Array {
    const { winner, pot, committed, behind } = node.terminal!
    const values = new Float64Array(HAND_COUNT)
    const mine = committed[player]!

    for (let hand = 0; hand < HAND_COUNT; hand++) {
      let total = 0
      const row = hand * HAND_COUNT
      if (winner >= 0) {
        // Somebody folded, so the result does not depend on the cards.
        const payoff = winner === player ? pot - mine : -mine
        for (let other = 0; other < HAND_COUNT; other++) {
          total += rOpp[other]! * this.compatibility[row + other]! * payoff
        }
      } else {
        const equities = MATCHUP[hand]!
        for (let other = 0; other < HAND_COUNT; other++) {
          const weight = rOpp[other]! * this.compatibility[row + other]!
          if (weight === 0) continue
          total += weight * (this.realised(equities[other]!, player, behind) * pot - mine)
        }
      }
      values[hand] = total
    }
    return values
  }

  private realised(equity: number, player: number, behind: number): number {
    return realisedEquity(equity, player, behind)
  }

  private walk(
    node: PublicNode,
    player: number,
    rMe: Float64Array,
    rOpp: Float64Array,
    iteration: number,
  ): Float64Array {
    if (node.terminal) return this.terminalValues(node, player, rOpp)

    const width = node.actions.length
    const strategy = strategyAt(node)
    const values = new Float64Array(HAND_COUNT)

    if (node.toAct === player) {
      const childValues: Float64Array[] = []
      for (let a = 0; a < width; a++) {
        const nextReach = new Float64Array(HAND_COUNT)
        for (let hand = 0; hand < HAND_COUNT; hand++) {
          nextReach[hand] = rMe[hand]! * strategy[hand * width + a]!
        }
        childValues.push(this.walk(node.children[a]!, player, nextReach, rOpp, iteration))
      }

      for (let hand = 0; hand < HAND_COUNT; hand++) {
        let value = 0
        for (let a = 0; a < width; a++) {
          value += strategy[hand * width + a]! * childValues[a]![hand]!
        }
        values[hand] = value
        for (let a = 0; a < width; a++) {
          const index = hand * width + a
          // CFR+ keeps regrets non-negative so an action written off early can
          // come back the moment it stops being bad.
          node.regret[index] = Math.max(0, node.regret[index]! + childValues[a]![hand]! - value)
          node.strategySum[index]! += iteration * rMe[hand]! * strategy[index]!
        }
      }
      return values
    }

    // The opponent acts: their strategy shapes the range that arrives below,
    // and the values simply add up.
    for (let a = 0; a < width; a++) {
      const nextReach = new Float64Array(HAND_COUNT)
      for (let hand = 0; hand < HAND_COUNT; hand++) {
        nextReach[hand] = rOpp[hand]! * strategy[hand * width + a]!
      }
      const child = this.walk(node.children[a]!, player, rMe, nextReach, iteration)
      for (let hand = 0; hand < HAND_COUNT; hand++) values[hand]! += child[hand]!
    }
    return values
  }

  /** The prior over starting hands: how often each class is dealt. */
  private prior(): Float64Array {
    const prior = new Float64Array(HAND_COUNT)
    for (let hand = 0; hand < HAND_COUNT; hand++) prior[hand] = COMBOS[hand]! / 1326
    return prior
  }

  train(iterations: number, onProgress?: (done: number) => void): void {
    for (let t = 1; t <= iterations; t++) {
      for (const player of [0, 1]) {
        this.walk(this.root, player, this.prior(), this.prior(), t)
      }
      if (onProgress && t % 100 === 0) onProgress(t)
    }
  }

  /** Average strategy at a node, per hand. */
  strategyFor(node: PublicNode, hand: number): number[] {
    const width = node.actions.length
    const base = hand * width
    let total = 0
    for (let a = 0; a < width; a++) total += node.strategySum[base + a]!
    if (total <= 0) return node.actions.map(() => 1 / width)
    return node.actions.map((_, a) => node.strategySum[base + a]! / total)
  }

  /**
   * Best-response value for `player`, in big blinds per hand.
   *
   * The responder picks per hand and per public node — which is exactly one
   * choice per information set, since heads-up preflop a player knows only
   * their own hand and the betting so far.
   */
  private bestResponse(node: PublicNode, player: number, rOpp: Float64Array): Float64Array {
    if (node.terminal) return this.terminalValues(node, player, rOpp)

    const width = node.actions.length
    const values = new Float64Array(HAND_COUNT)

    if (node.toAct === player) {
      const childValues = node.children.map((child) => this.bestResponse(child, player, rOpp))
      for (let hand = 0; hand < HAND_COUNT; hand++) {
        let best = -Infinity
        for (let a = 0; a < width; a++) best = Math.max(best, childValues[a]![hand]!)
        values[hand] = best
      }
      return values
    }

    for (let a = 0; a < width; a++) {
      const nextReach = new Float64Array(HAND_COUNT)
      const strategy = this.averageStrategyVector(node)
      for (let hand = 0; hand < HAND_COUNT; hand++) {
        nextReach[hand] = rOpp[hand]! * strategy[hand * width + a]!
      }
      const child = this.bestResponse(node.children[a]!, player, nextReach)
      for (let hand = 0; hand < HAND_COUNT; hand++) values[hand]! += child[hand]!
    }
    return values
  }

  private averageStrategyVector(node: PublicNode): Float64Array {
    const width = node.actions.length
    const strategy = new Float64Array(HAND_COUNT * width)
    for (let hand = 0; hand < HAND_COUNT; hand++) {
      const base = hand * width
      let total = 0
      for (let a = 0; a < width; a++) total += node.strategySum[base + a]!
      for (let a = 0; a < width; a++) {
        strategy[base + a] = total > 0 ? node.strategySum[base + a]! / total : 1 / width
      }
    }
    return strategy
  }

  /**
   * Exploitability in big blinds per hand: what a perfect counter would win.
   * Zero is equilibrium, and it is the only honest measure of how solved this
   * strategy actually is.
   */
  exploitability(): number {
    const prior = this.prior()
    let total = 0
    for (const player of [0, 1]) {
      const values = this.bestResponse(this.root, player, prior)
      // Normalise by how much range weight each hand actually carries.
      let sum = 0
      let weight = 0
      for (let hand = 0; hand < HAND_COUNT; hand++) {
        let compatible = 0
        for (let other = 0; other < HAND_COUNT; other++) {
          compatible += prior[other]! * this.compatibility[hand * HAND_COUNT + other]!
        }
        sum += prior[hand]! * values[hand]!
        weight += prior[hand]! * compatible
      }
      total += sum / weight
    }
    return total / 2
  }

  /** Every decision node in the tree, with the seat and context that names it. */
  nodes(): PublicNode[] {
    const out: PublicNode[] = []
    const walk = (node: PublicNode) => {
      if (!node.terminal) out.push(node)
      for (const child of node.children) walk(child)
    }
    walk(this.root)
    return out
  }
}

