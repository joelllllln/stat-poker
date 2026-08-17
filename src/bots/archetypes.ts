/**
 * Opponent archetypes.
 *
 * Bots are built to be *readable*: each has a stable, nameable style with a
 * distinct statistical signature, because an opponent with no exploitable
 * tendency teaches nothing. These are the styles the player will learn to spot
 * and, eventually, to attack.
 *
 * The numbers here are inputs to a policy, not target stats. What a bot's VPIP
 * actually comes out at is measured by simulation rather than asserted — see
 * `policy.test.ts`.
 */

export interface Archetype {
  id: string
  name: string
  blurb: string
  /** Share of hands opened from the button, tightened for earlier seats. */
  openWidth: number
  /**
   * Share of hands that limp in when nobody has raised. This is what separates
   * a passive player from a tight one: both play few pots aggressively, but
   * only one of them enters cheaply and often.
   */
  limpWidth: number
  /** Share of hands that continue against a raise. */
  defendWidth: number
  /** Share of hands strong enough to reraise. */
  reraiseWidth: number
  /**
   * Multiplier on the equity a call needs. Below 1 is a station calling too
   * wide; above 1 is a nit folding hands that are getting the right price.
   */
  callDiscipline: number
  /** How often a strong hand raises rather than just calling. */
  aggression: number
  /** How often a weak hand bets anyway. */
  bluffFrequency: number
  /** Bet size as a fraction of the pot. */
  betSizing: number
}

export const ARCHETYPES: Record<string, Archetype> = {
  nit: {
    id: 'nit',
    name: 'The Rock',
    blurb: 'Plays almost nothing, and means it when it bets. Punish by folding to its aggression and stealing everything else.',
    openWidth: 0.24,
    limpWidth: 0,
    defendWidth: 0.09,
    reraiseWidth: 0.03,
    callDiscipline: 1.35,
    aggression: 0.55,
    bluffFrequency: 0.04,
    betSizing: 0.6,
  },
  tag: {
    id: 'tag',
    name: 'The Eagle',
    blurb: 'Tight, aggressive and balanced. The benchmark: beating it means playing genuinely well.',
    openWidth: 0.52,
    limpWidth: 0,
    defendWidth: 0.22,
    reraiseWidth: 0.07,
    callDiscipline: 1.0,
    aggression: 0.75,
    bluffFrequency: 0.22,
    betSizing: 0.66,
  },
  lag: {
    id: 'lag',
    name: 'The Hawk',
    blurb: 'Loose and relentless. Applies real pressure; punish by calling down lighter than feels comfortable.',
    openWidth: 0.7,
    limpWidth: 0.05,
    defendWidth: 0.38,
    reraiseWidth: 0.14,
    callDiscipline: 0.9,
    aggression: 0.85,
    bluffFrequency: 0.4,
    betSizing: 0.8,
  },
  station: {
    id: 'station',
    name: 'The Fish',
    blurb: 'Calls far too much and raises almost never. Value bet relentlessly and never bluff.',
    openWidth: 0.28,
    limpWidth: 0.45,
    defendWidth: 0.55,
    reraiseWidth: 0.04,
    callDiscipline: 0.6,
    aggression: 0.2,
    bluffFrequency: 0.05,
    betSizing: 0.45,
  },
  maniac: {
    id: 'maniac',
    name: 'The Maniac',
    blurb: 'Raises with anything and everything. Wait for a hand and let it pay you off.',
    openWidth: 0.88,
    limpWidth: 0.1,
    defendWidth: 0.55,
    reraiseWidth: 0.3,
    callDiscipline: 0.75,
    aggression: 0.95,
    bluffFrequency: 0.6,
    betSizing: 0.95,
  },
}

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES)

export const archetype = (id: string): Archetype => {
  const found = ARCHETYPES[id]
  if (!found) throw new Error(`Unknown archetype: ${id}`)
  return found
}

/**
 * Positional tightening: a seat that has to act before more players opens a
 * narrower range than the button does.
 */
export function positionalOpenWidth(width: number, seatsLeftToAct: number): number {
  return width * Math.pow(0.82, seatsLeftToAct)
}
