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
import { GRADE_SEED, gradeHand, sizingsFor, type DecisionGrade } from '../coach/grade'
import { evContext, evaluateActions, type ActionEV } from '../coach/ev'
import { requiredEquity } from '../coach/odds'
import { applyAction, startHandWithDeck, winnablePot } from '../engine/hand'
import { potSize, type Action } from '../engine/types'
import { luckCurve } from '../stats/all-in-adjusted'
import { hydrate } from '../stats/archive'
import type { StoredHand } from '../stats/serialize'
import { handEquity } from '../equity/equity'
import { findOuts } from '../equity/outs'
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
  /** Also work out which cards would put the hand ahead. */
  withOuts?: boolean
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

/**
 * Grade stored hands.
 *
 * Grading costs roughly a third of a second a hand — far too much for the
 * thread that draws the table, and the reason a session's history is graded
 * here, a few hands at a time, rather than all at once when the page loads.
 */
export interface GradeRequest {
  kind: 'grade'
  id: number
  hands: StoredHand[]
}

/**
 * The luck curve over a history.
 *
 * Each hand is re-dealt to price what it was worth when the chips went in,
 * which is milliseconds a hand: cheap once, expensive across a few thousand.
 */
export interface LuckRequest {
  kind: 'luck'
  id: number
  hands: StoredHand[]
  bigBlind: number
}

/**
 * What to do, right now.
 *
 * The hand in progress, sent as the deck and the actions so far, because that
 * is all replay needs and it keeps the message small. The worker plays it
 * forward to the decision the person is facing and prices every option they
 * have — the same pricing the coach uses to grade the hand afterwards, so live
 * advice and the post-hand verdict can never disagree.
 */
export interface AdviseRequest {
  kind: 'advise'
  id: number
  deck: number[]
  actions: { seat: number; type: Action['type']; to?: number }[]
  seatNames: string[]
  startingStacks: number[]
  buttonSeat: number
  smallBlind: number
  bigBlind: number
  heroSeat: number
}

export type AnalysisRequest =
  | EquityRequest
  | SolveRequest
  | GradeRequest
  | LuckRequest
  | AdviseRequest

export interface EquityReply {
  kind: 'equity'
  id: number
  equity: number
  win: number
  tie: number
  exact: boolean
  errorMargin: number
  /** Present when outs were asked for and there are cards still to come. */
  outs: {
    cards: Card[]
    byNextCard: number
    byRiver: number
    toCome: number
  } | null
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

export interface GradedHand {
  /** The hand's storage identity, so the caller can file the result. */
  key: string
  evLostBB: number
  decisions: DecisionGrade[]
}

export interface GradeReply {
  kind: 'grade'
  id: number
  graded: GradedHand[]
  /** Hands that would not replay or grade, counted rather than dropped silently. */
  failed: number
}

export interface LuckReply {
  kind: 'luck'
  id: number
  actual: number[]
  adjusted: number[]
  luckBB: number
  allInHands: number
}

export interface AdviseReply {
  kind: 'advise'
  id: number
  /** Every option priced in chips relative to folding, best first. */
  options: ActionEV[]
  /** Equity against the modelled ranges at this moment. */
  equity: number
  /** Share of the pot a call has to win to break even, or 0 facing no bet. */
  requiredEquity: number
  /** Chips in the pot before the action. */
  pot: number
  toCall: number
}

export interface AnalysisError {
  kind: 'error'
  id: number
  message: string
}

export type AnalysisReply =
  | EquityReply
  | SolveReply
  | GradeReply
  | LuckReply
  | AdviseReply
  | AnalysisError

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
  // Outs come from the same call rather than a second round trip: the caller
  // wants them at the same moment and they cost a few milliseconds.
  let outs: EquityReply['outs'] = null
  if (request.withOuts && request.board.length >= 3 && request.board.length < 5) {
    const found = findOuts(request.hero, request.board, request.villains.map(rangeFor))
    outs = {
      cards: found.outs,
      byNextCard: found.byNextCard,
      byRiver: found.byRiver,
      toCome: found.toCome,
    }
  }

  return {
    kind: 'equity',
    id: request.id,
    equity: result.equity,
    win: result.win,
    tie: result.tie,
    exact: result.exact,
    errorMargin: result.errorMargin,
    outs,
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

function runGrade(request: GradeRequest): GradeReply {
  const { hands } = hydrate(request.hands)
  const graded: GradedHand[] = []
  let failed = request.hands.length - hands.length

  for (const hand of hands) {
    try {
      const grade = gradeHand(hand.record, hand.record.heroSeat)
      graded.push({ key: hand.key, evLostBB: grade.totalEvLossBB, decisions: grade.decisions })
    } catch {
      // One hand that will not grade costs that hand's verdict and nothing
      // else: the rest of the batch is still worth having.
      failed += 1
    }
  }

  return { kind: 'grade', id: request.id, graded, failed }
}

function runLuck(request: LuckRequest): LuckReply {
  const { hands } = hydrate(request.hands)
  const curve = luckCurve(
    hands.map((hand) => ({
      state: hand.record.state,
      bigBlind: hand.record.bigBlind || request.bigBlind,
      seat: hand.record.heroSeat,
    })),
    0,
  )
  return {
    kind: 'luck',
    id: request.id,
    actual: curve.actual,
    adjusted: curve.adjusted,
    luckBB: curve.luckBB,
    allInHands: curve.allInHands,
  }
}

function runAdvise(request: AdviseRequest): AdviseReply {
  let state = startHandWithDeck(
    {
      seats: request.seatNames.map((name, i) => ({
        name,
        stack: request.startingStacks[i]!,
      })),
      buttonSeat: request.buttonSeat,
      smallBlind: request.smallBlind,
      bigBlind: request.bigBlind,
    },
    request.deck as Card[],
  )

  for (const entry of request.actions) {
    const action: Action =
      entry.type === 'raise' ? { type: 'raise', to: entry.to! } : { type: entry.type }
    state = applyAction(state, action)
  }

  if (state.result !== null || state.toAct !== request.heroSeat) {
    throw new Error('That decision has already been made')
  }

  // Seeded by which decision this is rather than by which request asked, so
  // asking twice gives one answer — and so it is the *same* answer the coach
  // reaches when it grades the hand afterwards. Live advice and the verdict
  // that follows it are then the same number, not merely the same method.
  const decisions = request.actions.filter((entry) => entry.seat === request.heroSeat).length
  const context = evContext(state, request.heroSeat, GRADE_SEED + decisions)
  const priced = evaluateActions(context, sizingsFor(state, request.heroSeat))

  const hero = state.seats[request.heroSeat]!
  const pot = potSize(state)
  // What continuing costs this stack, and what it can win by paying it.
  const toCall = Math.min(Math.max(0, state.currentBet - hero.committed), hero.stack)

  return {
    kind: 'advise',
    id: request.id,
    options: [...priced.options].sort((a, b) => b.ev - a.ev),
    equity: priced.equity,
    requiredEquity: requiredEquity(toCall, winnablePot(state, request.heroSeat, toCall)),
    pot,
    toCall,
  }
}

function run(request: AnalysisRequest): AnalysisReply {
  switch (request.kind) {
    case 'equity':
      return runEquity(request)
    case 'solve':
      return runSolve(request)
    case 'grade':
      return runGrade(request)
    case 'luck':
      return runLuck(request)
    case 'advise':
      return runAdvise(request)
  }
}

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const request = event.data
  try {
    self.postMessage(run(request))
  } catch (error) {
    const reply: AnalysisError = {
      kind: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(reply)
  }
}
