/**
 * The leak finder.
 *
 * A total of expected value given up says how much a player is losing; it says
 * nothing about where. This groups graded decisions by the features of the spot
 * they happened in — street, position, whether the pot was raised, whether the
 * player was facing a bet — and reports the groups that cost the most.
 *
 * The rule that makes it useful rather than noise: a group is only reported
 * once it has enough decisions behind it to distinguish a habit from a bad
 * afternoon. A leak found in four hands is not a leak.
 */

import { positionName, type Street } from '../engine/types'
import { compareMeans, holm } from '../stats/inference'
import type { HandRecord } from '../game/session'
import { gradeHand, type GradedDecision } from './grade'
import { mistakeIn } from './mistakes'

/** Decisions a group needs before it is worth naming. */
export const MIN_SAMPLE = 20

export interface TaggedDecision {
  grade: GradedDecision
  street: Street
  /** Position label, e.g. `BTN`. */
  position: string
  /** True when the hero faced a bet rather than acting into a checked pot. */
  facingBet: boolean
  /** True when the pot had been raised before the flop. */
  raisedPot: boolean
  handNumber: number
}

export interface Leak {
  /** A short description of the spot, e.g. `facing a bet on the turn`. */
  label: string
  decisions: number
  /** Total big blinds given up in this group. */
  totalLossBB: number
  /** Big blinds given up per decision. */
  lossPerDecisionBB: number
  /**
   * Big blinds this group costs *beyond* the rest of the player's game.
   *
   * Ranking on total loss alone always crowns whichever group happens to be
   * biggest — a dimension that covers every decision tops the list by
   * definition, which tells the player nothing. What identifies a leak is a
   * spot handled worse than the player handles everything else.
   *
   * The comparison is against the decisions *outside* the group, not against
   * an average that includes it. A group compared with a baseline it is part
   * of is compared with itself, and the difference is pulled towards zero by
   * exactly the share of the history the group occupies.
   */
  excessLossBB: number
  /** That excess, per decision. */
  excessPerDecisionBB: number
  /** Share of the group's decisions that were mistakes or blunders. */
  errorRate: number
  /** Enough decisions to mean something. */
  reliable: boolean
  /**
   * Whether the gap survives being one of several groups tested at once.
   *
   * A history is carved up a dozen ways here, and the worst of a dozen groups
   * looks bad in any history, including one with nothing wrong with it. This is
   * a permutation test against the rest of the player's decisions, corrected
   * across every group tested — the same standard the trend view is held to.
   */
  significant: boolean
  /** How likely a gap this large is from a player with no such leak. */
  p: number
}

/**
 * Attach the features of each decision's spot.
 *
 * Grading is the expensive part, so a caller with grades already in hand
 * should pass them rather than paying for them twice.
 */
export function tagDecisions(
  records: readonly HandRecord[],
  heroSeat: number,
  gradeOf: (record: HandRecord) => GradedDecision[] = (record) =>
    gradeHand(record, heroSeat).decisions,
): TaggedDecision[] {
  const tagged: TaggedDecision[] = []

  for (const record of records) {
    const seats = record.state.seats.length
    const position = positionName(heroSeat, record.buttonSeat, seats)
    const raisedPot = record.state.actions.some(
      (entry) => entry.street === 'preflop' && entry.action.type === 'raise',
    )

    for (const grade of gradeOf(record)) {
      tagged.push({
        grade,
        street: grade.street,
        position,
        facingBet: grade.toCall > 0,
        raisedPot,
        handNumber: record.handNumber,
      })
    }
  }

  return tagged
}

interface Dimension {
  /** The group this decision belongs to, or null where the cut does not apply. */
  label: (decision: TaggedDecision) => string | null
}

/**
 * The ways a spot is carved up.
 *
 * Each dimension is scanned separately rather than crossed with the others: a
 * player wants "you bleed on turns" or "you bleed out of position", not the
 * empty intersection of six conditions.
 */
const DIMENSIONS: Dimension[] = [
  { label: (d) => `on the ${d.street}` },
  { label: (d) => `from the ${d.position}` },
  { label: (d) => (d.facingBet ? 'facing a bet' : 'when nobody has bet') },
  { label: (d) => (d.raisedPot ? 'in raised pots' : 'in unraised pots') },
  { label: (d) => `${d.facingBet ? 'facing a bet' : 'with the betting lead'} on the ${d.street}` },
  // What kind of mistake, rather than where it happened. Every cut above
  // says which spots cost the most; these say what the player did in them,
  // which is the only cut somebody can act on directly. Decisions that gave
  // up nothing belong to no habit, so they join no group.
  { label: (d) => mistakeIn(d.grade) },
  { label: (d) => (mistakeIn(d.grade) === null ? null : `${mistakeIn(d.grade)} on the ${d.street}`) },
]

/**
 * Rank the spots costing the most, worst first.
 *
 * Ranking is by excess cost over the player's own baseline, which is what
 * makes a group a leak rather than merely a large slice of the game. Within
 * that, a small mistake made constantly outranks a large one made twice —
 * it costs more and it is the one worth fixing first.
 */
export function findLeaks(decisions: readonly TaggedDecision[]): Leak[] {
  if (decisions.length === 0) return []

  const groups = new Map<string, Set<number>>()
  decisions.forEach((decision, index) => {
    for (const dimension of DIMENSIONS) {
      const label = dimension.label(decision)
      if (label === null) continue
      const group = groups.get(label)
      if (group) group.add(index)
      else groups.set(label, new Set([index]))
    }
  })

  const losses = decisions.map((d) => d.grade.evLossBB)
  const found: Leak[] = []

  for (const [label, members] of groups) {
    const inside: number[] = []
    const outside: number[] = []
    losses.forEach((loss, index) => (members.has(index) ? inside : outside).push(loss))

    const totalLossBB = inside.reduce((sum, loss) => sum + loss, 0)
    const lossPerDecisionBB = totalLossBB / inside.length
    const errors = [...members].filter(
      (index) =>
        decisions[index]!.grade.verdict === 'mistake' ||
        decisions[index]!.grade.verdict === 'blunder',
    ).length

    // Against the rest of the player's game, with the interval left out: the
    // ranking uses the gap itself and the reporting rule uses the p-value, and
    // bootstrapping an interval for every group would cost more than both.
    const against =
      outside.length >= 2 && inside.length >= 2
        ? compareMeans(outside, inside, { interval: false })
        : null

    found.push({
      label,
      decisions: inside.length,
      totalLossBB,
      lossPerDecisionBB,
      excessLossBB: (against?.change ?? 0) * inside.length,
      excessPerDecisionBB: against?.change ?? 0,
      errorRate: errors / inside.length,
      reliable: inside.length >= MIN_SAMPLE,
      significant: false,
      p: against?.p ?? 1,
    })
  }

  // Every group was tested against the same history, so the worst of them
  // looking bad is much less surprising than one group looking bad would be.
  const survives = holm(found.map((leak) => leak.p))
  found.forEach((leak, index) => {
    leak.significant = survives[index]! && leak.excessPerDecisionBB > 0
  })

  return found.sort((a, b) => b.excessLossBB - a.excessLossBB)
}

/**
 * The one thing worth telling a player to work on.
 *
 * Only a group with enough decisions behind it and a real cost qualifies;
 * otherwise the honest answer is that there is nothing to say yet.
 */
export function biggestLeak(leaks: readonly Leak[]): Leak | null {
  const candidates = leaks.filter(
    // Three bars, and they are different questions: enough decisions to be
    // worth looking at, a gap the sample can actually support, and a cost big
    // enough to be worth a player's attention.
    (leak) => leak.reliable && leak.significant && leak.lossPerDecisionBB > 0.1,
  )
  return candidates[0] ?? null
}

/** A sentence a player can act on. */
export function describeLeak(leak: Leak): string {
  return (
    `You give up ${leak.lossPerDecisionBB.toFixed(2)}bb per decision ${leak.label}` +
    ` — ${leak.totalLossBB.toFixed(1)}bb across ${leak.decisions} decisions,` +
    ` ${(leak.errorRate * 100).toFixed(0)}% of them mistakes.`
  )
}
