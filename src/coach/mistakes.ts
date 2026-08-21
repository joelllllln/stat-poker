/**
 * What kind of mistake it was.
 *
 * A leak finder that cuts by street and position says where to look. It does
 * not say what to change: "you give up most on the turn" is a map reference,
 * and "you fold too much on the turn" is a lesson. The difference is one
 * comparison — what you did against what the arithmetic preferred — and it is
 * the most actionable thing the record can be cut by.
 */

import type { Action } from '../engine/types'
import type { GradedDecision } from './grade'

export type Mistake =
  | 'folding too much'
  | 'calling too much'
  | 'not raising enough'
  | 'raising too much'
  | 'the wrong size'

/**
 * How committing an action is, on the only scale that matters here.
 *
 * Folding gives up, checking and calling stay in for the least they can, and
 * raising puts money in. Two actions on the same rung differ in size, not in
 * kind.
 */
const COMMITMENT: Record<Action['type'], number> = {
  fold: 0,
  check: 1,
  call: 1,
  raise: 2,
}

/**
 * Below this a decision is not a mistake worth naming.
 *
 * Actions inside a mixed strategy have nearly identical value — that is why
 * they are mixed — so a hundredth of a big blind between two of them is the
 * sampling talking, not the player. Naming it would fill the record with
 * errors nobody made.
 */
export const WORTH_NAMING_BB = 0.1

/** What kind of mistake this decision was, or null where it was not one. */
export function mistakeIn(decision: GradedDecision): Mistake | null {
  if (decision.evLossBB < WORTH_NAMING_BB) return null

  const chosen = COMMITMENT[decision.chosen.type]
  const best = COMMITMENT[decision.best.type]

  if (chosen < best) {
    // Too passive. Folding a hand worth playing is a different habit from
    // calling one worth raising, and they are fixed differently.
    return best === 2 && chosen === 1 ? 'not raising enough' : 'folding too much'
  }
  if (chosen > best) {
    // Too loose. Calling when folding was right and raising when calling was
    // right are both "putting in money you should not have", one rung apart.
    return chosen === 2 ? 'raising too much' : 'calling too much'
  }
  // Same rung: the only way left to be wrong is by how much.
  if (decision.chosen.type === 'raise' && decision.best.type === 'raise') return 'the wrong size'
  return null
}

/**
 * The direction somebody's mistakes lean, over a whole record.
 *
 * Counted by what they cost rather than by how often they happen: a habit that
 * shows up twice a session and costs a stack matters more than one that shows
 * up constantly and costs nothing.
 */
export function leaning(
  decisions: readonly GradedDecision[],
): { mistake: Mistake; costBB: number; count: number }[] {
  const totals = new Map<Mistake, { costBB: number; count: number }>()
  for (const decision of decisions) {
    const mistake = mistakeIn(decision)
    if (mistake === null) continue
    const running = totals.get(mistake) ?? { costBB: 0, count: 0 }
    running.costBB += decision.evLossBB
    running.count += 1
    totals.set(mistake, running)
  }
  return [...totals.entries()]
    .map(([mistake, running]) => ({ mistake, ...running }))
    .sort((a, b) => b.costBB - a.costBB)
}
