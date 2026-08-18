/**
 * River solving.
 *
 * On the river nothing is left to chance: the board is complete, so a solve
 * here is exact rather than abstracted. What it is not is small — each player
 * holds one of 1,081 possible pairs of cards, and a showdown has to weigh every
 * one against every one of the opponent's.
 *
 * Done naively that is a million comparisons per terminal per traversal, which
 * is far too slow to iterate. The way round it is the standard one: sort the
 * holdings by strength once, then sweep them in that order keeping running
 * totals of the opponent's range — of everything seen so far, and of how much
 * of it uses each individual card. A holding's showdown value is then a
 * subtraction rather than a search, and card removal comes out of the same
 * sweep for free.
 */

import { NUM_CARDS, type Card } from '../engine/cards'
import { evaluate } from '../engine/evaluator'
import type { Range } from '../equity/range'

export const CHECK = 0
export const BET = 1
export const FOLD = 2
export const CALL = 3

export interface PostflopConfig {
  /** The complete five-card board. */
  board: readonly Card[]
  /** Chips already in the middle when the river betting starts. */
  pot: number
  /** Chips each player still has behind. */
  stack: number
  /** Bet sizes offered, as fractions of the pot. */
  betSizes: readonly number[]
  /** How many raises deep the tree may go. */
  maxRaises: number
}

export const DEFAULT_POSTFLOP: Omit<PostflopConfig, 'board'> = {
  pot: 10,
  stack: 40,
  betSizes: [0.33, 0.75],
  maxRaises: 2,
}

export interface Holdings {
  /** Every two-card holding the board leaves available. */
  combos: readonly (readonly [Card, Card])[]
  /** Hand strength of each, board included. */
  values: Int32Array
  /** Indices sorted by strength, weakest first. */
  byStrength: Int32Array
}

/** Enumerate the holdings a board leaves possible, with their strengths. */
export function holdingsFor(board: readonly Card[]): Holdings {
  const blocked = new Set(board)
  const combos: [Card, Card][] = []
  const scratch: Card[] = new Array(7)

  for (let a = 0; a < NUM_CARDS; a++) {
    if (blocked.has(a)) continue
    for (let b = a + 1; b < NUM_CARDS; b++) {
      if (blocked.has(b)) continue
      combos.push([b, a])
    }
  }

  const values = new Int32Array(combos.length)
  for (let i = 0; i < combos.length; i++) {
    scratch[0] = combos[i]![0]
    scratch[1] = combos[i]![1]
    for (let k = 0; k < 5; k++) scratch[k + 2] = board[k]!
    values[i] = evaluate(scratch)
  }

  const byStrength = Int32Array.from(
    Array.from({ length: combos.length }, (_, i) => i).sort((x, y) => values[x]! - values[y]!),
  )

  return { combos, values, byStrength }
}

/** Turn a range into weights over this board's holdings. */
export function weightsFor(holdings: Holdings, range: Range): Float64Array {
  const index = new Map<number, number>()
  holdings.combos.forEach((combo, i) => index.set(combo[0] * 52 + combo[1], i))

  const weights = new Float64Array(holdings.combos.length)
  for (const combo of range) {
    const high = Math.max(combo.cards[0], combo.cards[1])
    const low = Math.min(combo.cards[0], combo.cards[1])
    const at = index.get(high * 52 + low)
    if (at !== undefined) weights[at] = combo.weight
  }
  return weights
}

/**
 * Showdown value of every holding against a weighted opponent range.
 *
 * Returns, for each holding, the chips it wins on average: `pot` when ahead,
 * half when tied, nothing when behind, less what this player put in. Card
 * removal is exact — a holding never runs into an opponent using one of its
 * own cards.
 *
 * The sweep runs weakest to strongest, so everything already passed is beaten
 * by the current holding. Ties are handled a group at a time, which is what
 * makes a chopped pot come out right rather than approximately right.
 */
export function showdownValues(
  holdings: Holdings,
  opponent: Float64Array,
  pot: number,
  committed: number,
): Float64Array {
  const n = holdings.combos.length
  const out = new Float64Array(n)

  let total = 0
  const cardTotal = new Float64Array(NUM_CARDS)
  for (let i = 0; i < n; i++) {
    total += opponent[i]!
    cardTotal[holdings.combos[i]![0]]! += opponent[i]!
    cardTotal[holdings.combos[i]![1]]! += opponent[i]!
  }

  // Running totals of everything weaker than the group being processed.
  let worse = 0
  const cardWorse = new Float64Array(NUM_CARDS)

  const order = holdings.byStrength
  let i = 0
  while (i < n) {
    // Collect the whole tie group before scoring any of it.
    let j = i
    const value = holdings.values[order[i]!]!
    while (j < n && holdings.values[order[j]!]! === value) j++

    let groupWeight = 0
    const groupCard = new Map<Card, number>()
    for (let k = i; k < j; k++) {
      const index = order[k]!
      groupWeight += opponent[index]!
      const [a, b] = holdings.combos[index]!
      groupCard.set(a, (groupCard.get(a) ?? 0) + opponent[index]!)
      groupCard.set(b, (groupCard.get(b) ?? 0) + opponent[index]!)
    }

    for (let k = i; k < j; k++) {
      const index = order[k]!
      const [a, b] = holdings.combos[index]!
      const self = opponent[index]!

      // Opponent weight this holding can actually face: everything, less what
      // its own two cards block. The holding itself is subtracted once because
      // both cards would otherwise remove it twice.
      const blocked = cardTotal[a]! + cardTotal[b]! - self
      const live = total - blocked

      const blockedWorse = cardWorse[a]! + cardWorse[b]!
      const beaten = worse - blockedWorse

      const blockedTied = (groupCard.get(a) ?? 0) + (groupCard.get(b) ?? 0) - self
      const tied = groupWeight - blockedTied

      out[index] = pot * (beaten + tied / 2) - committed * live
    }

    // Only now does the group count as beaten by what comes after it.
    worse += groupWeight
    for (const [card, weight] of groupCard) cardWorse[card]! += weight
    i = j
  }

  return out
}

interface TerminalNode {
  kind: 'terminal'
  /** Seat that wins uncontested, or -1 for a showdown. */
  winner: number
  pot: number
  committed: [number, number]
}

export interface RiverNode {
  kind: 'decision'
  toAct: number
  actions: number[]
  /** Chips each player has put in on this street. */
  committed: [number, number]
  children: (RiverNode | TerminalNode)[]
  regret: Float64Array
  strategySum: Float64Array
  raises: number
}

type Node = RiverNode | TerminalNode

/**
 * Build the river betting tree.
 *
 * The out-of-position player acts first, as they do at a table.
 */
export function buildRiverTree(config: PostflopConfig, holdings: Holdings): Node {
  const width = holdings.combos.length

  const decision = (
    toAct: number,
    committed: [number, number],
    raises: number,
    facing: boolean,
  ): Node => {
    const behind = config.stack - committed[toAct]!
    const toCall = committed[1 - toAct]! - committed[toAct]!
    const actions: number[] = []

    if (facing) {
      actions.push(FOLD, CALL)
    } else {
      actions.push(CHECK)
    }

    if (behind > toCall && raises < config.maxRaises) {
      // One entry per offered size; a size that cannot be paid is skipped.
      for (let i = 0; i < config.betSizes.length; i++) {
        const potNow = config.pot + committed[0]! + committed[1]!
        const target = committed[toAct]! + toCall + potNow * config.betSizes[i]!
        if (target - committed[toAct]! <= behind) actions.push(BET + 100 * i)
      }
    }

    const node: RiverNode = {
      kind: 'decision',
      toAct,
      actions,
      committed,
      children: [],
      regret: new Float64Array(width * actions.length),
      strategySum: new Float64Array(width * actions.length),
      raises,
    }

    node.children = actions.map((action) => {
      const other = 1 - toAct
      if (action === FOLD) {
        return {
          kind: 'terminal',
          winner: other,
          pot: config.pot + committed[0]! + committed[1]!,
          committed: [...committed] as [number, number],
        }
      }
      if (action === CALL) {
        const matched: [number, number] = [...committed] as [number, number]
        matched[toAct] = committed[other]!
        return {
          kind: 'terminal',
          winner: -1,
          pot: config.pot + matched[0]! + matched[1]!,
          committed: matched,
        }
      }
      if (action === CHECK) {
        if (toAct === 1) {
          // Both have checked: the hand is over.
          return {
            kind: 'terminal',
            winner: -1,
            pot: config.pot + committed[0]! + committed[1]!,
            committed: [...committed] as [number, number],
          }
        }
        return decision(1, committed, raises, false)
      }

      const sizeIndex = Math.floor(action / 100)
      const potNow = config.pot + committed[0]! + committed[1]!
      const toCallHere = committed[other]! - committed[toAct]!
      const raiseTo = Math.min(
        committed[toAct]! + toCallHere + potNow * config.betSizes[sizeIndex]!,
        config.stack,
      )
      const next: [number, number] = [...committed] as [number, number]
      next[toAct] = raiseTo
      return decision(other, next, raises + 1, true)
    })

    return node
  }

  return decision(0, [0, 0], 0, false)
}

/** Regret matching across every holding at once. */
function strategyAt(node: RiverNode, width: number): Float64Array {
  const count = node.actions.length
  const strategy = new Float64Array(width * count)
  for (let hand = 0; hand < width; hand++) {
    const base = hand * count
    let total = 0
    for (let a = 0; a < count; a++) {
      const positive = Math.max(0, node.regret[base + a]!)
      strategy[base + a] = positive
      total += positive
    }
    if (total > 0) {
      for (let a = 0; a < count; a++) strategy[base + a]! /= total
    } else {
      for (let a = 0; a < count; a++) strategy[base + a] = 1 / count
    }
  }
  return strategy
}

export class RiverSolver {
  readonly holdings: Holdings
  readonly root: Node
  private width: number

  constructor(
    private config: PostflopConfig,
    private ranges: [Float64Array, Float64Array],
  ) {
    if (config.board.length !== 5) throw new Error('A river solve needs a complete board')
    this.holdings = holdingsFor(config.board)
    this.width = this.holdings.combos.length
    this.root = buildRiverTree(config, this.holdings)
  }

  private terminalValues(node: TerminalNode, player: number, opponent: Float64Array): Float64Array {
    const mine = node.committed[player]!
    if (node.winner >= 0) {
      // Somebody folded, so no cards are compared — only blockers matter.
      const payoff = node.winner === player ? node.pot - mine : -mine
      const out = new Float64Array(this.width)
      let total = 0
      const cardTotal = new Float64Array(NUM_CARDS)
      for (let i = 0; i < this.width; i++) {
        total += opponent[i]!
        cardTotal[this.holdings.combos[i]![0]]! += opponent[i]!
        cardTotal[this.holdings.combos[i]![1]]! += opponent[i]!
      }
      for (let i = 0; i < this.width; i++) {
        const [a, b] = this.holdings.combos[i]!
        out[i] = payoff * (total - (cardTotal[a]! + cardTotal[b]! - opponent[i]!))
      }
      return out
    }
    return showdownValues(this.holdings, opponent, node.pot, mine)
  }

  private walk(
    node: Node,
    player: number,
    mine: Float64Array,
    theirs: Float64Array,
    iteration: number,
  ): Float64Array {
    if (node.kind === 'terminal') return this.terminalValues(node, player, theirs)

    const count = node.actions.length
    const strategy = strategyAt(node, this.width)
    const values = new Float64Array(this.width)

    if (node.toAct === player) {
      const childValues: Float64Array[] = []
      for (let a = 0; a < count; a++) {
        const next = new Float64Array(this.width)
        for (let hand = 0; hand < this.width; hand++) {
          next[hand] = mine[hand]! * strategy[hand * count + a]!
        }
        childValues.push(this.walk(node.children[a]!, player, next, theirs, iteration))
      }

      for (let hand = 0; hand < this.width; hand++) {
        let value = 0
        for (let a = 0; a < count; a++) value += strategy[hand * count + a]! * childValues[a]![hand]!
        values[hand] = value
        for (let a = 0; a < count; a++) {
          const index = hand * count + a
          node.regret[index] = Math.max(0, node.regret[index]! + childValues[a]![hand]! - value)
          node.strategySum[index]! += iteration * mine[hand]! * strategy[index]!
        }
      }
      return values
    }

    for (let a = 0; a < count; a++) {
      const next = new Float64Array(this.width)
      for (let hand = 0; hand < this.width; hand++) {
        next[hand] = theirs[hand]! * strategy[hand * count + a]!
      }
      const child = this.walk(node.children[a]!, player, mine, next, iteration)
      for (let hand = 0; hand < this.width; hand++) values[hand]! += child[hand]!
    }
    return values
  }

  train(iterations: number, onProgress?: (done: number) => void): void {
    for (let t = 1; t <= iterations; t++) {
      for (const player of [0, 1]) {
        this.walk(this.root, player, this.ranges[player]!, this.ranges[1 - player]!, t)
      }
      if (onProgress && t % 50 === 0) onProgress(t)
    }
  }

  /** Average strategy for one holding at a node. */
  strategyFor(node: RiverNode, hand: number): number[] {
    const count = node.actions.length
    const base = hand * count
    let total = 0
    for (let a = 0; a < count; a++) total += node.strategySum[base + a]!
    if (total <= 0) return node.actions.map(() => 1 / count)
    return node.actions.map((_, a) => node.strategySum[base + a]! / total)
  }

  private averageStrategy(node: RiverNode): Float64Array {
    const count = node.actions.length
    const strategy = new Float64Array(this.width * count)
    for (let hand = 0; hand < this.width; hand++) {
      const base = hand * count
      let total = 0
      for (let a = 0; a < count; a++) total += node.strategySum[base + a]!
      for (let a = 0; a < count; a++) {
        strategy[base + a] = total > 0 ? node.strategySum[base + a]! / total : 1 / count
      }
    }
    return strategy
  }

  private bestResponse(node: Node, player: number, theirs: Float64Array): Float64Array {
    if (node.kind === 'terminal') return this.terminalValues(node, player, theirs)

    const count = node.actions.length
    const values = new Float64Array(this.width)

    if (node.toAct === player) {
      const childValues = node.children.map((child) => this.bestResponse(child, player, theirs))
      for (let hand = 0; hand < this.width; hand++) {
        let best = -Infinity
        for (let a = 0; a < count; a++) best = Math.max(best, childValues[a]![hand]!)
        values[hand] = best
      }
      return values
    }

    const strategy = this.averageStrategy(node)
    for (let a = 0; a < count; a++) {
      const next = new Float64Array(this.width)
      for (let hand = 0; hand < this.width; hand++) {
        next[hand] = theirs[hand]! * strategy[hand * count + a]!
      }
      const child = this.bestResponse(node.children[a]!, player, next)
      for (let hand = 0; hand < this.width; hand++) values[hand]! += child[hand]!
    }
    return values
  }

  /**
   * Total weight of the (hero, villain) pairings that can actually be dealt.
   *
   * Counterfactual values are sums over the opponent's range, so they carry
   * that range's weight. Turning them into chips per hand means dividing by
   * the weight of every pairing the two ranges can produce together — with
   * the ones that share a card left out, because they never happen.
   */
  private pairWeight(): number {
    const [first, second] = this.ranges
    let total = 0
    const cardTotal = new Float64Array(NUM_CARDS)
    for (let i = 0; i < this.width; i++) {
      total += second[i]!
      cardTotal[this.holdings.combos[i]![0]]! += second[i]!
      cardTotal[this.holdings.combos[i]![1]]! += second[i]!
    }

    let weight = 0
    for (let i = 0; i < this.width; i++) {
      if (first[i]! === 0) continue
      const [a, b] = this.holdings.combos[i]!
      weight += first[i]! * (total - (cardTotal[a]! + cardTotal[b]! - second[i]!))
    }
    return weight
  }

  /**
   * Exploitability in chips per hand: what a perfect counter-strategy takes
   * beyond its equilibrium share. Zero means solved.
   *
   * The river is constant-sum rather than zero-sum. Chips already in the
   * middle when the street began belong to whoever wins them, so the two
   * players' values add up to that starting pot rather than cancelling — and
   * a pair of best responses can only exceed it. That excess, halved, is what
   * either player is leaving on the table.
   */
  exploitability(): number {
    const weight = this.pairWeight()
    if (weight === 0) return 0

    let total = 0
    for (const player of [0, 1]) {
      const values = this.bestResponse(this.root, player, this.ranges[1 - player]!)
      let sum = 0
      for (let hand = 0; hand < this.width; hand++) {
        sum += this.ranges[player]![hand]! * values[hand]!
      }
      total += sum / weight
    }
    return (total - this.config.pot) / 2
  }

  /** Every decision node, for reading a strategy out. */
  nodes(): RiverNode[] {
    const out: RiverNode[] = []
    const walk = (node: Node) => {
      if (node.kind === 'terminal') return
      out.push(node)
      for (const child of node.children) walk(child)
    }
    walk(this.root)
    return out
  }

  /** A readable label for an action, e.g. `bet 7.5`. */
  labelFor(node: RiverNode, action: number): string {
    if (action === FOLD) return 'fold'
    if (action === CALL) return 'call'
    if (action === CHECK) return 'check'
    const sizeIndex = Math.floor(action / 100)
    const potNow = this.config.pot + node.committed[0]! + node.committed[1]!
    const size = potNow * this.config.betSizes[sizeIndex]!
    return `bet ${size.toFixed(1)}`
  }
}
