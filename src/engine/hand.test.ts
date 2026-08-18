import { describe, expect, it } from 'vitest'
import { freshDeck, parseCards, Rng, type Card } from './cards'
import {
  applyAction,
  legalActions,
  startHand,
  startHandWithDeck,
  winnablePot,
} from './hand'
import { positionName, potSize, type Action, type HandConfig, type HandState } from './types'

const table = (stacks: number[], buttonSeat = 0): HandConfig => ({
  seats: stacks.map((stack, i) => ({ name: `P${i}`, stack })),
  buttonSeat,
  smallBlind: 1,
  bigBlind: 2,
})

/**
 * Build a deck where seat `i` holds `holeCards[i]` and the board runs out as
 * given. Remaining cards fill in from the rest of the deck.
 */
function stackedDeck(holeCards: string[], board: string): Card[] {
  const chosen = [...holeCards.flatMap((h) => parseCards(h)), ...parseCards(board)]
  const rest = freshDeck().filter((c) => !chosen.includes(c))
  return [...chosen, ...rest]
}

const play = (state: HandState, actions: Action[]): HandState =>
  actions.reduce((s, action) => applyAction(s, action), state)

const fold: Action = { type: 'fold' }
const check: Action = { type: 'check' }
const call: Action = { type: 'call' }
const raiseTo = (to: number): Action => ({ type: 'raise', to })

describe('hand setup', () => {
  it('posts blinds and starts action under the gun', () => {
    const state = startHand(table([100, 100, 100, 100, 100, 100]), new Rng(1))
    expect(state.seats[1]!.committed).toBe(1) // small blind
    expect(state.seats[2]!.committed).toBe(2) // big blind
    expect(state.toAct).toBe(3) // under the gun
    expect(state.currentBet).toBe(2)
    expect(potSize(state)).toBe(3)
  })

  it('deals two cards to everyone', () => {
    const state = startHand(table([100, 100, 100]), new Rng(2))
    const dealt = state.seats.flatMap((s) => s.holeCards!)
    expect(dealt).toHaveLength(6)
    expect(new Set(dealt).size).toBe(6)
  })

  it('heads-up, the button is the small blind and acts first preflop', () => {
    const state = startHand(table([100, 100]), new Rng(3))
    expect(state.seats[0]!.committed).toBe(1)
    expect(state.seats[1]!.committed).toBe(2)
    expect(state.toAct).toBe(0)
  })

  it('heads-up, the big blind acts first postflop', () => {
    const state = play(startHand(table([100, 100]), new Rng(3)), [call, check])
    expect(state.street).toBe('flop')
    expect(state.toAct).toBe(1)
  })

  it('names six-max positions', () => {
    expect(positionName(0, 0, 6)).toBe('BTN')
    expect(positionName(3, 0, 6)).toBe('UTG')
    expect(positionName(5, 0, 6)).toBe('CO')
  })
})

describe('betting rules', () => {
  it('gives the big blind an option after limps', () => {
    const state = play(startHand(table([100, 100, 100]), new Rng(4)), [call, call])
    expect(state.street).toBe('preflop')
    expect(state.toAct).toBe(2)
    expect(legalActions(state).map((a) => a.type)).toContain('check')
  })

  it('ends the street when the big blind checks', () => {
    const state = play(startHand(table([100, 100, 100]), new Rng(4)), [call, call, check])
    expect(state.street).toBe('flop')
    expect(state.board).toHaveLength(3)
  })

  it('enforces the minimum raise', () => {
    const opened = applyAction(startHand(table([100, 100, 100]), new Rng(5)), raiseTo(6))
    const raise = legalActions(opened).find((a) => a.type === 'raise')
    expect(raise?.min).toBe(10) // 6 + the 4-chip raise size
    expect(() => applyAction(opened, raiseTo(9))).toThrow()
    expect(() => applyAction(opened, raiseTo(10))).not.toThrow()
  })

  it('sets the minimum postflop bet at one big blind', () => {
    const state = play(startHand(table([100, 100, 100]), new Rng(6)), [call, call, check])
    const raise = legalActions(state).find((a) => a.type === 'raise')
    expect(raise?.min).toBe(2)
  })

  it('rejects a check when facing a bet', () => {
    const state = startHand(table([100, 100, 100]), new Rng(7))
    expect(() => applyAction(state, check)).toThrow()
  })

  it('allows an all-in below the minimum raise', () => {
    // Seat 2 has 25 behind and cannot make a full raise over the open to 20.
    const state = play(startHand(table([200, 200, 25], 0), new Rng(8)), [raiseTo(20), call])
    const raise = legalActions(state).find((a) => a.type === 'raise')
    expect(raise?.max).toBe(25)
    expect(raise?.min).toBe(25) // clamped to the all-in
    expect(() => applyAction(state, raiseTo(25))).not.toThrow()
  })

  it('does not reopen betting after a short all-in', () => {
    // Seat 0 opened to 20; seat 2 jams 25, which is not a full raise, so
    // seat 0 may only call or fold.
    const state = play(startHand(table([200, 200, 25], 0), new Rng(9)), [
      raiseTo(20),
      call,
      raiseTo(25),
    ])
    expect(state.toAct).toBe(0)
    expect(legalActions(state).map((a) => a.type)).toEqual(['fold', 'call'])
  })

  it('reopens betting after a full raise', () => {
    const state = play(startHand(table([200, 200, 200], 0), new Rng(10)), [
      raiseTo(6),
      raiseTo(18),
    ])
    expect(legalActions(state).map((a) => a.type)).toContain('raise')
  })
})

describe('pot resolution', () => {
  it('awards the blinds when everyone folds', () => {
    const state = play(startHand(table([100, 100, 100]), new Rng(11)), [fold, fold])
    expect(state.result).not.toBeNull()
    expect(state.result!.showdown).toBe(false)
    expect(state.result!.net[2]).toBe(1) // big blind wins the small blind
    expect(state.result!.net[1]).toBe(-1)
    expect(state.result!.net[0]).toBe(0)
  })

  it('returns the uncalled part of a shove', () => {
    // Seat 0 jams 200 into a 50-chip stack: only 50 of it can be called.
    const state = play(startHand(table([200, 50], 0), new Rng(12)), [raiseTo(200), call])
    expect(state.result!.pots).toHaveLength(1)
    expect(state.result!.pots[0]!.amount).toBe(100)
    expect(state.seats[0]!.totalCommitted).toBe(50)
  })

  it('builds a side pot when a short stack is all-in', () => {
    // Totals: 100 / 50 / 100 → main pot 150 for all three, side pot 100 for two.
    const state = play(startHand(table([100, 50, 200], 0), new Rng(13)), [
      raiseTo(100),
      call,
      call,
    ])
    const pots = state.result!.pots
    expect(pots).toHaveLength(2)
    expect(pots[0]!.amount).toBe(150)
    expect(pots[0]!.eligible).toEqual([0, 1, 2])
    expect(pots[1]!.amount).toBe(100)
    expect(pots[1]!.eligible).toEqual([0, 2])
  })

  it('pays the side pot to a player who lost the main pot', () => {
    // Seat 1 is all-in for 50 with aces and takes the main pot; seat 2's kings
    // lose to it but beat seat 0's queens for the side pot.
    const deck = stackedDeck(['Qc Qd', 'Ac Ad', 'Kc Kd'], '2c 5d 9h Th Jd')
    const state = play(startHandWithDeck(table([100, 50, 200], 0), deck), [
      raiseTo(100),
      call,
      call,
    ])
    const [main, side] = state.result!.pots
    expect(main!.winners).toEqual([1])
    expect(side!.winners).toEqual([2])
    expect(state.result!.net[1]).toBe(100) // 150 main pot less the 50 put in
    expect(state.result!.net[2]).toBe(0) // won back exactly the 100 committed
    expect(state.result!.net[0]).toBe(-100)
  })

  it('splits a pot between tied hands', () => {
    // Both players play the board.
    const deck = stackedDeck(['2c 3d', '2h 3s'], 'As Ks Qd Jc Th')
    const state = play(startHandWithDeck(table([100, 100], 0), deck), [call, check])
    const finished = play(state, [check, check, check, check, check, check])
    expect(finished.result!.pots[0]!.winners).toEqual([0, 1])
    expect(finished.result!.net).toEqual([0, 0])
  })

  it('gives the odd chip to the first winner left of the button', () => {
    // Three seats all-in for 5 each: a 15-chip pot chopped two ways leaves one
    // chip over. Seats 1 and 2 both make Broadway; seat 0 has ace-high.
    const deck = stackedDeck(['4c 5d', 'Tc 2d', 'Td 3c'], 'As Ks Qd Jc 9h')
    const state = play(startHandWithDeck(table([5, 5, 5], 0), deck), [raiseTo(5), call, call])

    const pot = state.result!.pots[0]!
    expect(pot.amount).toBe(15)
    expect(pot.winners).toEqual([1, 2])
    // Seat 1 is first to the button's left, so it takes the extra chip.
    expect(state.result!.net).toEqual([-5, 3, 2])
  })
})

/**
 * What a call can win, checked against what the hand actually pays.
 *
 * The oracle is the engine itself: play the same hand out twice, once folding
 * and once calling, and the difference in what the seat ends with *is* the
 * definition of what calling was playing for. Nothing here trusts the formula.
 */
describe('the pot a call plays for', () => {
  const netFromCalling = (state: HandState, seat: number, rest: Action[]): number => {
    const folded = play(state, [fold, ...rest.slice(1)])
    const called = play(state, [call, ...rest.slice(1)])
    return called.result!.net[seat]! - folded.result!.net[seat]!
  }

  it('stops at what the bettor matched, not at what they bet', () => {
    // Hero has 30 behind and faces 400. Only 28 of that bet is ever at stake.
    const deck = stackedDeck(['Ac Ad', 'Kc Kd'], 'Ah 7s 4d 9c 8h')
    const start = play(startHandWithDeck(table([30, 500], 0), deck), [call, check])
    const facing = play(start, [raiseTo(400)])

    expect(winnablePot(facing, 0, 28)).toBe(32)
    expect(potSize(facing)).toBe(404) // what the naive figure would have been
    expect(netFromCalling(facing, 0, [call])).toBe(32)
  })

  it('counts the dead money a folded seat left behind', () => {
    // Seat 2 pays 10 and folds; the hero can win all of it, being in for more.
    const deck = stackedDeck(['Ac Ad', 'Kc Kd', 'Qc Qd'], 'Ah 7s 4d 9c 8h')
    const preflop = play(startHandWithDeck(table([30, 500, 50], 0), deck), [
      call,
      raiseTo(10),
      call,
      call,
    ])
    const facing = play(preflop, [raiseTo(400), fold])

    expect(winnablePot(facing, 0, 20)).toBe(50)
    expect(netFromCalling(facing, 0, [call])).toBe(50)
  })

  it('is the whole pot whenever the seat covers the table', () => {
    const rng = new Rng(4)
    for (let hand = 0; hand < 400; hand++) {
      const numSeats = 2 + rng.nextInt(5)
      const stacks = Array.from({ length: numSeats }, () => 2 + rng.nextInt(400))
      let state = startHand(table(stacks, rng.nextInt(numSeats)), rng)

      while (state.result === null) {
        const seat = state.seats[state.toAct!]!
        const toCall = state.currentBet - seat.committed
        const covers = state.seats.every(
          (other) => other.totalCommitted <= seat.totalCommitted + toCall,
        )
        // A seat that can cover everyone is playing for the whole pot, so the
        // capped figure and the naive one have to agree.
        if (toCall > 0 && toCall <= seat.stack && covers) {
          expect(winnablePot(state, seat.index, toCall)).toBe(potSize(state))
        }

        const options = legalActions(state)
        const choice = options[rng.nextInt(options.length)]!
        state = applyAction(
          state,
          choice.type === 'raise'
            ? raiseTo(choice.min! + rng.nextInt(choice.max! - choice.min! + 1))
            : { type: choice.type },
        )
      }
    }
  })
})

describe('invariants under random play', () => {
  it('conserves chips across ten thousand random hands', () => {
    const rng = new Rng(2024)

    for (let hand = 0; hand < 10_000; hand++) {
      const numSeats = 2 + rng.nextInt(5)
      const stacks = Array.from({ length: numSeats }, () => 2 + rng.nextInt(400))
      const config = table(stacks, rng.nextInt(numSeats))
      const startingTotal = stacks.reduce((a, b) => a + b, 0)

      let state = startHand(config, rng)
      let guard = 0
      while (state.result === null) {
        if (++guard > 500) throw new Error('hand failed to terminate')
        const options = legalActions(state)
        const choice = options[rng.nextInt(options.length)]!
        const action: Action =
          choice.type === 'raise'
            ? raiseTo(choice.min! + rng.nextInt(choice.max! - choice.min! + 1))
            : { type: choice.type }
        state = applyAction(state, action)
      }

      const finalTotal = state.seats.reduce((sum, s) => sum + s.stack, 0)
      expect(finalTotal).toBe(startingTotal)
      expect(state.seats.every((s) => s.stack >= 0)).toBe(true)
      expect(state.result.net.reduce((a, b) => a + b, 0)).toBe(0)

      const awarded = state.result.pots.reduce((sum, p) => sum + p.amount, 0)
      expect(awarded).toBe(potSize(state))
      expect(state.result.pots.every((p) => p.winners.length > 0)).toBe(true)

      if (state.result.showdown) {
        expect(state.board).toHaveLength(5)
      }
    }
  }, 120_000)

  it('never lets a seat act out of turn or after folding', () => {
    const rng = new Rng(77)
    for (let hand = 0; hand < 500; hand++) {
      let state = startHand(table([100, 100, 100, 100, 100, 100], rng.nextInt(6)), rng)
      while (state.result === null) {
        const seat = state.seats[state.toAct!]!
        expect(seat.status).toBe('active')
        const options = legalActions(state)
        expect(options.length).toBeGreaterThan(0)
        const choice = options[rng.nextInt(options.length)]!
        state = applyAction(
          state,
          choice.type === 'raise' ? raiseTo(choice.min!) : { type: choice.type },
        )
      }
    }
  })
})
