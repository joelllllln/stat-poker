/**
 * The player profile: two independent axes, deliberately not one label.
 *
 * **Style** is descriptive. Where you sit on the VPIP/PFR plane says how you
 * play, and no position on it is wrong — tight-aggressive and loose-aggressive
 * both win. Not knowing which one you are is the problem.
 *
 * **Mastery** is a ranking, and it is measured in expected value given up per
 * 100 hands rather than in winrate. Winrate depends on who you sat with and
 * needs tens of thousands of hands to mean anything; EV lost is visible in a
 * few hundred and is purely about you.
 *
 * Collapsing the two into a single animal hides the second question behind the
 * first.
 */

import type { AggregateStats, SeatHandStats } from './hand-stats'

export type StyleAxis = 'tight' | 'loose'
export type AggressionAxis = 'passive' | 'aggressive'

export interface Style {
  id: string
  name: string
  tight: StyleAxis
  aggression: AggressionAxis
  blurb: string
}

/** VPIP at or below this is tight play; above it is loose. */
const TIGHT_VPIP = 28
/** Share of played hands that are raised, above which a player reads as aggressive. */
const AGGRESSIVE_PFR_SHARE = 0.6

export const STYLES: Record<string, Style> = {
  rock: {
    id: 'rock',
    name: 'Rock',
    tight: 'tight',
    aggression: 'passive',
    blurb: 'You play few hands and rarely lead with them. Safe, and easy to play against.',
  },
  eagle: {
    id: 'eagle',
    name: 'Eagle',
    tight: 'tight',
    aggression: 'aggressive',
    blurb: 'Tight and aggressive — the shape most winning players have.',
  },
  fish: {
    id: 'fish',
    name: 'Fish',
    tight: 'loose',
    aggression: 'passive',
    blurb: 'You enter a lot of pots and let others do the betting. The most expensive shape there is.',
  },
  hawk: {
    id: 'hawk',
    name: 'Hawk',
    tight: 'loose',
    aggression: 'aggressive',
    blurb: 'Loose and aggressive. It wins when the reads are good and bleeds when they are not.',
  },
}

export function classifyStyle(stats: AggregateStats): Style {
  const tight: StyleAxis = stats.vpip <= TIGHT_VPIP ? 'tight' : 'loose'
  const share = stats.vpip === 0 ? 0 : stats.pfr / stats.vpip
  const aggression: AggressionAxis = share >= AGGRESSIVE_PFR_SHARE ? 'aggressive' : 'passive'

  return Object.values(STYLES).find((s) => s.tight === tight && s.aggression === aggression)!
}

export interface MasteryTier {
  id: string
  name: string
  /** Upper bound of EV lost per 100 hands, in big blinds. */
  upTo: number
}

/**
 * Mastery bands.
 *
 * These thresholds are estimates. They have not been calibrated against a
 * population of real players, and until they are, the tier should be read as a
 * rough placement rather than a rating.
 */
export const MASTERY_TIERS: MasteryTier[] = [
  { id: 'elite', name: 'Elite', upTo: 1.5 },
  { id: 'strong', name: 'Strong', upTo: 4 },
  { id: 'solid', name: 'Solid', upTo: 8 },
  { id: 'amateur', name: 'Amateur', upTo: 15 },
  { id: 'fish', name: 'Fish', upTo: Infinity },
]

export const classifyMastery = (evLostPer100: number): MasteryTier =>
  MASTERY_TIERS.find((tier) => evLostPer100 <= tier.upTo)!

export interface Profile {
  style: Style
  mastery: MasteryTier
  evLostPer100: number
  hands: number
  /** True once there are enough hands for the placement to mean anything. */
  reliable: boolean
  /** A single line, e.g. `Loose-Aggressive · Solid`. */
  label: string
}

/** Hands needed before a style placement is worth showing. */
export const STYLE_SAMPLE = 100
/** Hands needed before a mastery placement is worth showing. */
export const MASTERY_SAMPLE = 200

export function buildProfile(stats: AggregateStats, evLostPer100: number): Profile {
  const style = classifyStyle(stats)
  const mastery = classifyMastery(evLostPer100)
  const shape = `${style.tight === 'tight' ? 'Tight' : 'Loose'}-${
    style.aggression === 'aggressive' ? 'Aggressive' : 'Passive'
  }`

  return {
    style,
    mastery,
    evLostPer100,
    hands: stats.hands,
    reliable: stats.hands >= STYLE_SAMPLE,
    label: `${shape} · ${mastery.name}`,
  }
}

export interface StreetStyle {
  street: string
  decisions: number
  /** Share of decisions that were a bet or a raise. */
  aggression: number
  /** Share of decisions that were a fold. */
  folding: number
  /** A one-word style, e.g. `passive` or `wild`. */
  label: string
}

/** Decisions needed on a street before its style is worth naming. */
export const STREET_SAMPLE = 25

/**
 * Style, street by street.
 *
 * The single label hides the most useful thing a profile can say. Almost
 * nobody plays the same way on every street, and "tight before the flop, wild
 * on turns" is a diagnosis a player can act on tomorrow — where "loose
 * aggressive" is only a description to nod at.
 */
export function styleByStreet(
  decisions: readonly { street: string; action: string }[],
): StreetStyle[] {
  const groups = new Map<string, { street: string; action: string }[]>()
  for (const decision of decisions) {
    const group = groups.get(decision.street)
    if (group) group.push(decision)
    else groups.set(decision.street, [decision])
  }

  const order = ['preflop', 'flop', 'turn', 'river']
  const out: StreetStyle[] = []

  for (const street of order) {
    const group = groups.get(street)
    if (!group || group.length === 0) continue

    const aggression = group.filter((d) => d.action === 'raise').length / group.length
    const folding = group.filter((d) => d.action === 'fold').length / group.length

    out.push({
      street,
      decisions: group.length,
      aggression,
      folding,
      label:
        aggression >= 0.45
          ? 'wild'
          : aggression >= 0.22
            ? 'aggressive'
            : folding >= 0.5
              ? 'tight'
              : 'passive',
    })
  }

  return out
}

/**
 * The sharpest thing the per-street breakdown has to say: the two streets
 * furthest apart in style, where there are enough decisions to be sure.
 */
export function styleContradiction(styles: readonly StreetStyle[]): string | null {
  const solid = styles.filter((style) => style.decisions >= STREET_SAMPLE)
  if (solid.length < 2) return null

  let widest: [StreetStyle, StreetStyle] | null = null
  let gap = 0
  for (const first of solid) {
    for (const second of solid) {
      if (first.street === second.street) continue
      const distance = second.aggression - first.aggression
      if (distance > gap) {
        gap = distance
        widest = [first, second]
      }
    }
  }

  // A small difference between streets is normal play, not a contradiction.
  if (!widest || gap < 0.2) return null
  return `${widest[0].label} on the ${widest[0].street}, ${widest[1].label} on the ${widest[1].street}`
}

/**
 * Wilson score interval for a rate.
 *
 * The normal approximation collapses at the extremes — it happily reports a
 * negative lower bound for a stat observed twice in ten hands — and small
 * samples are exactly where a poker stat needs an honest error bar.
 */
export function rateInterval(successes: number, trials: number, z = 1.96): [number, number] {
  if (trials === 0) return [0, 100]
  const p = successes / trials
  const denominator = 1 + (z * z) / trials
  const centre = p + (z * z) / (2 * trials)
  const spread = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))
  return [
    Math.max(0, ((centre - spread) / denominator) * 100),
    Math.min(100, ((centre + spread) / denominator) * 100),
  ]
}

/**
 * Confidence interval on a winrate in bb/100, from the observed spread of
 * results rather than an assumed one.
 */
export function winrateInterval(
  records: SeatHandStats[],
  bigBlind: number,
  z = 1.96,
): { bbPer100: number; low: number; high: number; standardDeviation: number } {
  const n = records.length
  if (n === 0) return { bbPer100: 0, low: 0, high: 0, standardDeviation: 0 }

  const perHand = records.map((r) => r.net / bigBlind)
  const mean = perHand.reduce((a, b) => a + b, 0) / n
  const variance =
    n < 2 ? 0 : perHand.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (n - 1)
  const standardDeviation = Math.sqrt(variance)
  const margin = n < 2 ? Infinity : (z * standardDeviation) / Math.sqrt(n)

  return {
    bbPer100: mean * 100,
    low: (mean - margin) * 100,
    high: (mean + margin) * 100,
    standardDeviation: standardDeviation * 100,
  }
}

/**
 * Hands needed before a winrate interval is narrower than `targetWidth` bb/100.
 *
 * This is the number that makes the point: at a realistic spread, telling
 * whether you win or lose takes tens of thousands of hands.
 */
export function handsForPrecision(
  standardDeviationPer100: number,
  targetWidth = 10,
  z = 1.96,
): number {
  if (standardDeviationPer100 <= 0) return 0
  // width = 2 * z * sd / sqrt(n)  →  n = (2 z sd / width)^2
  return Math.ceil(((2 * z * standardDeviationPer100) / targetWidth) ** 2)
}
