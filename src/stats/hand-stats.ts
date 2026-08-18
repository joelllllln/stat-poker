/**
 * Per-hand statistics.
 *
 * Derived from a completed hand rather than stored alongside it, so improving
 * a definition here retroactively improves every hand already in the history.
 */

import type { HandState, Street } from '../engine/types'

export interface SeatHandStats {
  seat: number
  /** Put chips in preflop by choice — blinds and a checked option do not count. */
  vpip: boolean
  /** Raised preflop. */
  pfr: boolean
  /** Made the second raise of the preflop round, which is what a 3-bet is. */
  threeBet: boolean
  /** Faced a preflop raise at all, which is the denominator for defence stats. */
  facedPreflopRaise: boolean
  foldedToPreflopRaise: boolean
  /**
   * Was still in the hand when the flop was dealt.
   *
   * This is a fact about when the seat left, which lives in the actions —
   * reading it off the seat's status at the end instead would exclude everyone
   * who saw a flop and later folded, which is most of the people who see one.
   */
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

  // Whose raise was the second of the preflop round: that seat, and only that
  // seat, three-bet. A fourth bet by the original raiser is not a 3-bet.
  const preflopRaises = state.actions.filter(
    (a) => a.street === 'preflop' && a.action.type === 'raise',
  )
  const threeBettor = preflopRaises[1]?.seat ?? null

  return state.seats.map((seat) => {
    const mine = state.actions.filter((a) => a.seat === seat.index)
    const preflop = mine.filter((a) => a.street === 'preflop')
    const postflop = mine.filter((a) => POSTFLOP.includes(a.street))

    // Decisions this seat took with a raise already outstanding. A player who
    // limped and then had the pot raised behind them faced a raise every bit
    // as much as one who faced it first time round.
    const facingRaise = state.actions.filter(
      (entry, index) =>
        entry.seat === seat.index &&
        entry.street === 'preflop' &&
        state.actions
          .slice(0, index)
          .some((a) => a.street === 'preflop' && a.action.type === 'raise'),
    )
    const facedPreflopRaise = facingRaise.length > 0

    const vpip = preflop.some((a) => a.action.type === 'call' || a.action.type === 'raise')
    const pfr = preflop.some((a) => a.action.type === 'raise')
    const showedDown = result.showdown && seat.status !== 'folded'
    // The street this seat gave up on, which is what decides the streets it saw.
    const foldedOn = mine.find((a) => a.action.type === 'fold')?.street ?? null

    return {
      seat: seat.index,
      vpip,
      pfr,
      threeBet: threeBettor === seat.index,
      facedPreflopRaise,
      foldedToPreflopRaise: facingRaise.some((a) => a.action.type === 'fold'),
      sawFlop: state.board.length >= 3 && foldedOn !== 'preflop',
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
