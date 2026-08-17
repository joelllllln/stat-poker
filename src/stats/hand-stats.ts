/**
 * Per-hand statistics.
 *
 * Derived from a completed hand rather than stored alongside it, so improving
 * a definition here retroactively improves every hand already in the history.
 */

import { potSize, type HandState, type Street } from '../engine/types'

export interface SeatHandStats {
  seat: number
  /** Put chips in preflop by choice — blinds and a checked option do not count. */
  vpip: boolean
  /** Raised preflop. */
  pfr: boolean
  /** Reraised preflop. */
  threeBet: boolean
  /** Faced a preflop raise at all, which is the denominator for defence stats. */
  facedPreflopRaise: boolean
  foldedToPreflopRaise: boolean
  sawFlop: boolean
  wentToShowdown: boolean
  wonAtShowdown: boolean
  /** Bets and raises after the flop. */
  aggressiveActions: number
  /** Calls after the flop. */
  calls: number
  /** Postflop checks and folds. */
  passiveActions: number
  wonHand: boolean
  /** Chips won or lost. */
  net: number
  /** Chips voluntarily committed, for sizing analysis. */
  committed: number
}

const POSTFLOP: Street[] = ['flop', 'turn', 'river']

export function deriveHandStats(state: HandState): SeatHandStats[] {
  if (state.result === null) throw new Error('Hand is not complete')
  const result = state.result

  return state.seats.map((seat) => {
    const mine = state.actions.filter((a) => a.seat === seat.index)
    const preflop = mine.filter((a) => a.street === 'preflop')
    const postflop = mine.filter((a) => POSTFLOP.includes(a.street))

    // A raise before this seat's first preflop action means it faced one.
    const firstIndex = state.actions.findIndex((a) => a.seat === seat.index)
    const facedPreflopRaise = state.actions
      .slice(0, firstIndex < 0 ? state.actions.length : firstIndex)
      .some((a) => a.street === 'preflop' && a.action.type === 'raise')

    const vpip = preflop.some((a) => a.action.type === 'call' || a.action.type === 'raise')
    const pfr = preflop.some((a) => a.action.type === 'raise')
    const showedDown = result.showdown && seat.status !== 'folded'

    return {
      seat: seat.index,
      vpip,
      pfr,
      threeBet: facedPreflopRaise && pfr,
      facedPreflopRaise,
      foldedToPreflopRaise: facedPreflopRaise && preflop.some((a) => a.action.type === 'fold'),
      sawFlop: state.board.length >= 3 && seat.status !== 'folded',
      wentToShowdown: showedDown,
      wonAtShowdown: showedDown && result.pots.some((p) => p.winners.includes(seat.index)),
      aggressiveActions: postflop.filter((a) => a.action.type === 'raise').length,
      calls: postflop.filter((a) => a.action.type === 'call').length,
      passiveActions: postflop.filter(
        (a) => a.action.type === 'check' || a.action.type === 'fold',
      ).length,
      wonHand: result.pots.some((p) => p.winners.includes(seat.index)),
      net: result.net[seat.index]!,
      committed: seat.totalCommitted,
    }
  })
}

export interface AggregateStats {
  hands: number
  vpip: number
  pfr: number
  threeBet: number
  foldToPreflopRaise: number
  wtsd: number
  wonAtShowdown: number
  /** Bets and raises per call after the flop. */
  aggressionFactor: number
  /** Net chips per hand, in big blinds per 100 hands. */
  bbPer100: number
}

/**
 * Roll per-hand records up into the familiar tracker stats.
 *
 * Every rate is reported alongside the hand count that produced it, because a
 * rate without its sample size is the main way poker statistics mislead.
 */
export function aggregate(records: SeatHandStats[], bigBlind: number): AggregateStats {
  const hands = records.length
  if (hands === 0) {
    return {
      hands: 0,
      vpip: 0,
      pfr: 0,
      threeBet: 0,
      foldToPreflopRaise: 0,
      wtsd: 0,
      wonAtShowdown: 0,
      aggressionFactor: 0,
      bbPer100: 0,
    }
  }

  const rate = (count: number, of: number) => (of === 0 ? 0 : (count / of) * 100)
  const count = (predicate: (r: SeatHandStats) => boolean) => records.filter(predicate).length

  const faced = count((r) => r.facedPreflopRaise)
  const flops = count((r) => r.sawFlop)
  const showdowns = count((r) => r.wentToShowdown)
  const aggressive = records.reduce((sum, r) => sum + r.aggressiveActions, 0)
  const calls = records.reduce((sum, r) => sum + r.calls, 0)
  const net = records.reduce((sum, r) => sum + r.net, 0)

  return {
    hands,
    vpip: rate(count((r) => r.vpip), hands),
    pfr: rate(count((r) => r.pfr), hands),
    threeBet: rate(count((r) => r.threeBet), faced),
    foldToPreflopRaise: rate(count((r) => r.foldedToPreflopRaise), faced),
    wtsd: rate(showdowns, flops),
    wonAtShowdown: rate(count((r) => r.wonAtShowdown), showdowns),
    aggressionFactor: calls === 0 ? aggressive : aggressive / calls,
    bbPer100: (net / bigBlind / hands) * 100,
  }
}

/** Final pot of a completed hand, for display in the history list. */
export const finalPot = (state: HandState): number => potSize(state)
