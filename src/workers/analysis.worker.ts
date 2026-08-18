/**
 * Analysis off the main thread.
 *
 * The design rule this exists to keep: the interface thread never computes
 * equity or solves anything. A river solve takes seconds; even a live equity
 * query costs milliseconds that would show up as a table that stutters when it
 * should feel instant.
 *
 * Requests carry an id and results carry it back, so a caller can drop a reply
 * that arrived after the player already acted rather than showing numbers for
 * a decision that has passed.
 */

import type { Card } from '../engine/cards'
import { Rng } from '../engine/cards'
import { handEquity } from '../equity/equity'
import { parseRange, type Range } from '../equity/range'
import {
  DEFAULT_POSTFLOP,
  RiverSolver,
  holdingsFor,
  weightsFor,
  type RiverNode,
} from '../solver/postflop'

export interface EquityRequest {
  kind: 'equity'
  id: number
  hero: [Card, Card]
  /** Opponent ranges, as text so the message stays small. */
  villains: string[]
  board: Card[]
  iterations?: number
}

export interface SolveRequest {
  kind: 'solve'
  id: number
  board: Card[]
  heroRange: string
  villainRange: string
  pot: number
  stack: number
  iterations?: number
}

export type AnalysisRequest = EquityRequest | SolveRequest

export interface EquityReply {
  kind: 'equity'
  id: number
  equity: number
  win: number
  tie: number
  exact: boolean
  errorMargin: number
}

export interface SolveAction {
  label: string
  frequency: number
}

export interface SolveReply {
  kind: 'solve'
  id: number
  /** The first player's options at the top of the river. */
  actions: SolveAction[]
  /** Frequencies for the hero's specific holding, when it is in the range. */
  forHand: SolveAction[] | null
  exploitability: number
  iterations: number
  milliseconds: number
}

export interface AnalysisError {
  kind: 'error'
  id: number
  message: string
}

export type AnalysisReply = EquityReply | SolveReply | AnalysisError

const ranges = new Map<string, Range>()
const rangeFor = (text: string): Range => {
  const cached = ranges.get(text)
  if (cached) return cached
  const parsed = parseRange(text)
  ranges.set(text, parsed)
  return parsed
}

function runEquity(request: EquityRequest): EquityReply {
  const result = handEquity(
    request.hero,
    request.villains.map(rangeFor),
    request.board,
    { rng: new Rng(request.id * 7919 + 13), iterations: request.iterations ?? 8_000 },
  )
  return {
    kind: 'equity',
    id: request.id,
    equity: result.equity,
    win: result.win,
    tie: result.tie,
    exact: result.exact,
    errorMargin: result.errorMargin,
  }
}

function runSolve(request: SolveRequest): SolveReply {
  const started = Date.now()
  const board = request.board
  const holdings = holdingsFor(board)
  const heroWeights = weightsFor(holdings, rangeFor(request.heroRange))
  const villainWeights = weightsFor(holdings, rangeFor(request.villainRange))

  const iterations = request.iterations ?? 400
  const solver = new RiverSolver(
    { ...DEFAULT_POSTFLOP, board, pot: request.pot, stack: request.stack },
    [heroWeights, villainWeights],
  )
  solver.train(iterations)

  const root = solver.root as RiverNode
  const width = holdings.combos.length

  // The range-wide strategy: each action weighted by how much of the range
  // takes it, which is what "the solver bets 62% here" actually means.
  const totals = new Array<number>(root.actions.length).fill(0)
  let weight = 0
  for (let hand = 0; hand < width; hand++) {
    const w = heroWeights[hand]!
    if (w === 0) continue
    weight += w
    const strategy = solver.strategyFor(root, hand)
    for (let a = 0; a < totals.length; a++) totals[a]! += w * strategy[a]!
  }

  const actions: SolveAction[] = root.actions.map((action, a) => ({
    label: solver.labelFor(root, action),
    frequency: weight > 0 ? totals[a]! / weight : 0,
  }))

  return {
    kind: 'solve',
    id: request.id,
    actions,
    forHand: null,
    exploitability: solver.exploitability(),
    iterations,
    milliseconds: Date.now() - started,
  }
}

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const request = event.data
  try {
    const reply = request.kind === 'equity' ? runEquity(request) : runSolve(request)
    self.postMessage(reply)
  } catch (error) {
    const reply: AnalysisError = {
      kind: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(reply)
  }
}
