/**
 * Equity: how often a hand wins against a range, given the board so far.
 *
 * Two engines, picked automatically. When the remaining work is small enough
 * the answer is enumerated exactly; otherwise it is sampled. Sampling reports
 * its own margin of error so the UI never presents a noisy number as if it
 * were exact.
 */

import { NUM_CARDS, Rng, type Card } from '../engine/cards'
import { evaluate } from '../engine/evaluator'
import { removeBlocked, type Range } from './range'

export interface EquityResult {
  /** Share of the pot this hand wins on average, ties split. */
  equity: number
  win: number
  tie: number
  lose: number
  /** Board runouts examined. */
  trials: number
  /** True when every runout was enumerated rather than sampled. */
  exact: boolean
  /** 95% margin of error on `equity`; zero when exact. */
  errorMargin: number
}

/**
 * Showdowns we are willing to enumerate before falling back to sampling.
 *
 * Sized for the live HUD, which must answer in well under a frame: this covers
 * every river and turn spot and most flops exactly, and hands preflop over to
 * the sampler. Offline callers such as the post-hand coach can raise it.
 */
const DEFAULT_EXACT_BUDGET = 250_000
const DEFAULT_ITERATIONS = 20_000

const BOARD_SIZE = 5

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1)
  return Math.round(result)
}

// Scratch buffers: equity is the hottest path in the app and must not allocate.
const heroHand: Card[] = new Array(7)
const villainHand: Card[] = new Array(7)

/**
 * Score one showdown. Returns 1 for a hero win, 0 for a loss, or the split
 * share when tied.
 */
function showdownShare(
  hero: readonly [Card, Card],
  villains: readonly (readonly [Card, Card])[],
  board: readonly Card[],
): number {
  heroHand[0] = hero[0]
  heroHand[1] = hero[1]
  for (let i = 0; i < BOARD_SIZE; i++) heroHand[i + 2] = board[i]!
  const heroValue = evaluate(heroHand)

  let tied = 1
  for (const villain of villains) {
    villainHand[0] = villain[0]
    villainHand[1] = villain[1]
    for (let i = 0; i < BOARD_SIZE; i++) villainHand[i + 2] = board[i]!
    const value = evaluate(villainHand)
    if (value > heroValue) return 0
    if (value === heroValue) tied++
  }
  return 1 / tied
}

/** Cards not yet visible to anyone. */
function availableCards(used: readonly Card[]): Card[] {
  const taken = new Set(used)
  const out: Card[] = []
  for (let card = 0; card < NUM_CARDS; card++) if (!taken.has(card)) out.push(card)
  return out
}

/**
 * Exact equity against a single villain range: every villain combo crossed
 * with every board runout, each weighted by the combo's weight.
 */
function exactEquity(
  hero: readonly [Card, Card],
  villainRange: Range,
  board: readonly Card[],
): EquityResult {
  const needed = BOARD_SIZE - board.length
  const fullBoard: Card[] = [...board, ...new Array<Card>(needed)]

  let win = 0
  let tie = 0
  let lose = 0
  let equitySum = 0
  let weightTotal = 0

  for (const combo of villainRange) {
    const deck = availableCards([...hero, ...board, ...combo.cards])
    const villains = [combo.cards]
    const weight = combo.weight

    // Walk every k-subset of the remaining deck by index.
    const walk = (depth: number, start: number): void => {
      if (depth === needed) {
        const share = showdownShare(hero, villains, fullBoard)
        if (share === 1) win += weight
        else if (share === 0) lose += weight
        else tie += weight
        equitySum += share * weight
        weightTotal += weight
        return
      }
      for (let i = start; i < deck.length; i++) {
        fullBoard[board.length + depth] = deck[i]!
        walk(depth + 1, i + 1)
      }
    }
    walk(0, 0)
  }

  if (weightTotal === 0) {
    return { equity: 0, win: 0, tie: 0, lose: 0, trials: 0, exact: true, errorMargin: 0 }
  }

  return {
    equity: equitySum / weightTotal,
    win: win / weightTotal,
    tie: tie / weightTotal,
    lose: lose / weightTotal,
    trials: weightTotal,
    exact: true,
    errorMargin: 0,
  }
}

/**
 * Cumulative weights for sampling, memoised per range.
 *
 * Ranges are shared and long-lived (the opponent model hands back the same
 * object for the same width), so building this table per call was costing more
 * than the sampling it supports.
 */
const cumulativeCache = new WeakMap<Range, number[]>()

function cumulativeWeights(range: Range): number[] {
  const cached = cumulativeCache.get(range)
  if (cached) return cached
  const out: number[] = []
  let running = 0
  for (const combo of range) {
    running += combo.weight
    out.push(running)
  }
  cumulativeCache.set(range, out)
  return out
}

/** Weighted uniform sample from a range, using a precomputed cumulative table. */
function sampleCombo(range: Range, cumulative: number[], rng: Rng): Combo2 | null {
  if (range.length === 0) return null
  const total = cumulative[cumulative.length - 1]!
  const target = rng.nextFloat() * total
  let low = 0
  let high = cumulative.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (cumulative[mid]! < target) low = mid + 1
    else high = mid
  }
  return range[low]!.cards as Combo2
}

type Combo2 = readonly [Card, Card]

function monteCarloEquity(
  hero: readonly [Card, Card],
  villainRanges: readonly Range[],
  board: readonly Card[],
  iterations: number,
  rng: Rng,
  targetError = 0,
  maxIterations = 0,
): EquityResult {
  const needed = BOARD_SIZE - board.length
  const fullBoard: Card[] = [...board, ...new Array<Card>(needed)]

  const cumulatives = villainRanges.map(cumulativeWeights)

  let win = 0
  let tie = 0
  let lose = 0
  let trials = 0

  const villains: Combo2[] = new Array(villainRanges.length)

  // The cards nobody can see are fixed for the whole run, so the deck is built
  // once. Per iteration only the few cards the villains draw change, tracked in
  // a bitmap that is cleared by touching just those entries — rebuilding either
  // structure per iteration is what makes a naive sampler too slow to run
  // inside a bot's decision.
  const deck = availableCards([...hero, ...board])
  const blocked = new Uint8Array(NUM_CARDS)
  const touched: Card[] = []

  // Cards the hero and the board hold stay blocked for the whole run, which
  // also means villain combos using them are rejected as they are drawn —
  // no need to filter every range up front.
  for (const card of hero) blocked[card] = 1
  for (const card of board) blocked[card] = 1

  // Two-stage sampling: the first batch is a pilot, and how many more runs the
  // asked-for precision needs is worked out from it. Sizing the run from the
  // pilot alone — rather than stopping the moment the running error dips under
  // the target — keeps the estimate unbiased.
  let budget = iterations

  for (let iteration = 0; iteration < budget; iteration++) {
    if (iteration === iterations - 1 && targetError > 0 && trials > 0) {
      const seen = (win + tie) / trials
      const needed = Math.ceil((seen * (1 - seen)) / (targetError * targetError))
      budget = Math.min(Math.max(maxIterations, iterations), Math.max(iterations, needed))
    }

    for (const card of touched) blocked[card] = 0
    touched.length = 0

    // Draw one hand per villain, rejecting hands that collide with cards
    // already dealt. A range can be exhausted by blockers, so give up rather
    // than spin forever.
    let ok = true
    for (let v = 0; v < villainRanges.length; v++) {
      let attempts = 0
      let combo: Combo2 | null = null
      while (attempts++ < 100) {
        const candidate = sampleCombo(villainRanges[v]!, cumulatives[v]!, rng)
        if (!candidate) break
        if (!blocked[candidate[0]] && !blocked[candidate[1]]) {
          combo = candidate
          break
        }
      }
      if (!combo) {
        ok = false
        break
      }
      villains[v] = combo
      blocked[combo[0]] = 1
      blocked[combo[1]] = 1
      touched.push(combo[0], combo[1])
    }
    if (!ok) continue

    // Draw the remaining board from the live deck, rejecting cards a villain
    // already holds. Only a handful of the ~45 cards are ever blocked, so
    // rejection costs less than filtering the deck would.
    for (let i = 0; i < needed; i++) {
      let card: Card
      do {
        card = deck[rng.nextInt(deck.length)]!
      } while (blocked[card])
      blocked[card] = 1
      touched.push(card)
      fullBoard[board.length + i] = card
    }

    const share = showdownShare(hero, villains, fullBoard)
    if (share === 1) win++
    else if (share === 0) lose++
    else tie += share
    trials++
  }

  if (trials === 0) {
    return { equity: 0, win: 0, tie: 0, lose: 0, trials: 0, exact: false, errorMargin: 1 }
  }

  const equity = (win + tie) / trials
  // Standard error of a proportion, doubled for a ~95% interval.
  const errorMargin = 2 * Math.sqrt((equity * (1 - equity)) / trials)

  return {
    equity,
    win: win / trials,
    tie: tie / trials,
    lose: lose / trials,
    trials,
    exact: false,
    errorMargin,
  }
}

export interface EquityOptions {
  rng?: Rng
  iterations?: number
  /** Enumerate exactly when the work fits in this many showdowns. */
  exactBudget?: number
  /**
   * Standard error to aim for, in share of the pot.
   *
   * Sampling more is only worth paying for where the answer is close enough
   * that the noise decides it, so callers state the precision they need and
   * the sampler works out the runs rather than guessing an iteration count.
   */
  targetError?: number
  /** Ceiling on runs when chasing `targetError`. */
  maxIterations?: number
}

/**
 * Equity for `hero` against one or more villain ranges on `board`.
 *
 * Combos blocked by the hero's cards or the board are removed first — a
 * villain cannot hold a card you can see, and ignoring that is the classic
 * way equity displays end up subtly wrong.
 */
export function handEquity(
  hero: readonly [Card, Card],
  villainRanges: readonly Range[],
  board: readonly Card[] = [],
  options: EquityOptions = {},
): EquityResult {
  if (villainRanges.length === 0) throw new Error('Need at least one villain range')
  if (board.length > BOARD_SIZE) throw new Error('Board cannot exceed five cards')

  const blockers = [...hero, ...board]
  const needed = BOARD_SIZE - board.length
  const budget = options.exactBudget ?? DEFAULT_EXACT_BUDGET

  // Only the exact path needs a pre-filtered range; the sampler rejects
  // blocked combos as it draws them, which avoids copying every range on
  // every decision.
  if (villainRanges.length === 1) {
    const filtered = removeBlocked(villainRanges[0]!, blockers)
    if (filtered.length === 0) {
      throw new Error('A villain range has no combos left after removing blockers')
    }
    const runouts = binomial(NUM_CARDS - blockers.length - 2, needed)
    if (filtered.length * runouts <= budget) return exactEquity(hero, filtered, board)
  }

  const rng = options.rng ?? new Rng(0x5eed)
  const result = monteCarloEquity(
    hero,
    villainRanges,
    board,
    options.iterations ?? DEFAULT_ITERATIONS,
    rng,
    options.targetError ?? 0,
    options.maxIterations ?? 0,
  )
  if (result.trials === 0) {
    throw new Error('A villain range has no combos left after removing blockers')
  }
  return result
}
