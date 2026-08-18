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
import type { HandRecord } from '../game/session'
import { gradeHand, type GradedDecision } from './grade'

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
   * Big blinds this group costs *beyond* the player's own average.
   *
   * Ranking on total loss alone always crowns whichever group happens to be
   * biggest — a dimension that covers every decision tops the list by
   * definition, which tells the player nothing. What identifies a leak is a
   * spot handled worse than the player handles everything else.
   */
  excessLossBB: number
  /** Share of the group's decisions that were mistakes or blunders. */
  errorRate: number
  /** Enough decisions to mean something. */
  reliable: boolean
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
  label: (decision: TaggedDecision) => string
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

  // The player's own average is the yardstick: a leak is a spot played worse
  // than they play in general, not simply one where chips were lost.
  const baseline =
    decisions.reduce((sum, d) => sum + d.grade.evLossBB, 0) / decisions.length

  const groups = new Map<string, TaggedDecision[]>()

  for (const decision of decisions) {
    for (const dimension of DIMENSIONS) {
      const label = dimension.label(decision)
      const group = groups.get(label)
      if (group) group.push(decision)
      else groups.set(label, [decision])
    }
  }

  const leaks: Leak[] = []
  for (const [label, group] of groups) {
    const totalLossBB = group.reduce((sum, d) => sum + d.grade.evLossBB, 0)
    const errors = group.filter(
      (d) => d.grade.verdict === 'mistake' || d.grade.verdict === 'blunder',
    ).length

    const lossPerDecisionBB = totalLossBB / group.length
    leaks.push({
      label,
      decisions: group.length,
      totalLossBB,
      lossPerDecisionBB,
      excessLossBB: (lossPerDecisionBB - baseline) * group.length,
      errorRate: errors / group.length,
      reliable: group.length >= MIN_SAMPLE,
    })
  }

  return leaks.sort((a, b) => b.excessLossBB - a.excessLossBB)
}

/**
 * The one thing worth telling a player to work on.
 *
 * Only a group with enough decisions behind it and a real cost qualifies;
 * otherwise the honest answer is that there is nothing to say yet.
 */
export function biggestLeak(leaks: readonly Leak[]): Leak | null {
  const candidates = leaks.filter(
    (leak) => leak.reliable && leak.excessLossBB > 0 && leak.lossPerDecisionBB > 0.1,
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
