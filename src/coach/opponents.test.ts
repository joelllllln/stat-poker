import { describe, expect, it } from 'vitest'
import { ARCHETYPES } from '../bots/archetypes'
import { decide } from '../bots/policy'
import { NUM_CARDS, Rng, type Card } from '../engine/cards'
import { applyAction, legalActions, startHand } from '../engine/hand'
import { potSize, type HandState } from '../engine/types'
import { preflopStrength } from '../equity/preflop'
import { evContext, evaluateActions } from './ev'
import { defendWidthOf, preflopRaises, realisedWhenCalled, styleAt } from './opponents'

/**
 * The coach's opponents have to be the opponents.
 *
 * The pricing model earns its keep by predicting what the table will do with a
 * bet, and for a long time it did not: it priced everyone by a general rule
 * about poker while the app dealt five players with rules of their own. Over a
 * thousand hands it expected the field to fold 38.9% of the time and the field
 * folded 26.9% — and on the turn, 55.7% against 27.9%.
 *
 * These tests hold the model to the players. They read the same thresholds the
 * policy reads, from the same place, so the two cannot drift apart quietly —
 * which is the only way that bug could have happened at all.
 */

/** A preflop hand with one raise in, and the next seat waiting on a decision. */
function afterAnOpen(seed: number): HandState {
  let state = startHand(
    {
      seats: Array.from({ length: 6 }, (_, i) => ({
        name: `Seat ${i}`,
        style: 'tag',
        stack: 200,
      })),
      buttonSeat: 0,
      smallBlind: 1,
      bigBlind: 2,
    },
    new Rng(seed),
  )
  const raise = legalActions(state).find((option) => option.type === 'raise')!
  state = applyAction(state, { type: 'raise', to: raise.min! })
  return state
}

/** Every distinct two-card holding, as the bot would be dealt one. */
function everyHolding(): [Card, Card][] {
  const holdings: [Card, Card][] = []
  for (let a = 0; a < NUM_CARDS; a++) {
    for (let b = a + 1; b < NUM_CARDS; b++) holdings.push([a as Card, b as Card])
  }
  return holdings
}

describe('the width a seat defends preflop', () => {
  it('is the width the bot actually defends, for every archetype', () => {
    const state = afterAnOpen(11)
    const seat = state.toAct!
    // The bet being priced is the one already in: the raise the bot is facing.
    const raises = preflopRaises(state)
    expect(raises).toBe(1)

    for (const style of Object.values(ARCHETYPES)) {
      const width = defendWidthOf(style, raises)
      let compared = 0

      for (const holding of everyHolding()) {
        const table: HandState = {
          ...state,
          seats: state.seats.map((s) =>
            s.index === seat ? { ...s, holeCards: holding } : { ...s },
          ),
        }
        const continues = decide(table, seat, style, new Rng(7)).type !== 'fold'
        const modelled = preflopStrength(holding).percentile >= 1 - width
        expect(continues, `${style.id} with ${preflopStrength(holding).hand}`).toBe(modelled)
        compared += 1
      }

      expect(compared).toBe(1326)
      // A rule that said "everybody folds" or "nobody folds" would pass the
      // comparison above while teaching the coach nothing.
      expect(width).toBeGreaterThan(0)
      expect(width).toBeLessThan(1)
    }
  })

  it('narrows as the raises stack up, because the bots do', () => {
    const style = ARCHETYPES['tag']!
    expect(defendWidthOf(style, 2)).toBeCloseTo(style.defendWidth / 2, 12)
    expect(defendWidthOf(style, 3)).toBeCloseTo(style.defendWidth / 3, 12)
    // Zero raises is not a spot a defence width describes, and dividing by it
    // would widen the range instead of leaving it alone.
    expect(defendWidthOf(style, 0)).toBeCloseTo(style.defendWidth, 12)
  })
})

describe('reading a seat off the table', () => {
  it('finds the style the hand was dealt with', () => {
    const state = afterAnOpen(3)
    expect(styleAt(state, 0)?.id).toBe('tag')
  })

  it('gives no style to a seat the table does not describe', () => {
    const state = afterAnOpen(3)
    const anonymous: HandState = {
      ...state,
      seats: state.seats.map((s) => ({ ...s, style: null })),
    }
    expect(styleAt(anonymous, 0)).toBeNull()
    // And an id from a table this build does not know is not a style either.
    const stranger: HandState = {
      ...state,
      seats: state.seats.map((s) => ({ ...s, style: 'whale' })),
    }
    expect(styleAt(stranger, 0)).toBeNull()
  })
})

/** Deal a hand at a table where every seat plays the same way. */
function tableOf(style: string | null, seed: number): HandState {
  return startHand(
    {
      seats: Array.from({ length: 4 }, (_, i) => ({ name: `Seat ${i}`, style, stack: 200 })),
      buttonSeat: 0,
      smallBlind: 1,
      bigBlind: 2,
    },
    new Rng(seed),
  )
}

/** Everybody in cheaply, so there is a flop to bet at. */
function toTheFlop(state: HandState): HandState {
  let live = state
  let guard = 0
  while (live.street === 'preflop' && live.result === null && guard++ < 20) {
    const options = legalActions(live)
    const choice = options.find((o) => o.type === 'call') ?? options.find((o) => o.type === 'check')
    if (!choice || choice.type === 'raise') break
    live = applyAction(live, { type: choice.type })
  }
  return live
}

/** How often the field is expected to fold to the largest bet on offer. */
function foldEquityOf(state: HandState, seat: number, sizings: number[]): number[] {
  return evaluateActions(evContext(state, seat, 4242), sizings)
    .options.filter((option) => option.action.type === 'raise')
    .map((option) => option.foldEquity ?? 0)
}

describe('what the model now expects of a bet', () => {
  it('expects a loose table to fold less than a tight one to the same bet', () => {
    const rocks = toTheFlop(tableOf('nit', 5))
    const fish = toTheFlop(tableOf('station', 5))
    expect(rocks.street).toBe('flop')
    // The same deck, the same board, the same bet: only the players differ.
    expect(rocks.board).toEqual(fish.board)

    const seat = rocks.toAct!
    const sizings = [Math.round(potSize(rocks) * 0.75)]
    const [tight] = foldEquityOf(rocks, seat, sizings)
    const [loose] = foldEquityOf(fish, seat, sizings)

    expect(tight).toBeGreaterThan(loose!)
    // And by a margin worth having: the old model gave both tables the same
    // number, because it did not know one from the other.
    expect(tight! - loose!).toBeGreaterThan(0.1)
  })

  it('does not credit a bigger preflop raise with folding more of them out', () => {
    // Preflop these opponents defend a slice of their range and fold the rest,
    // whatever is being asked. Charging more does not buy more folds, and the
    // model that thought it did is what lost the money.
    const state = tableOf('tag', 9)
    const seat = state.toAct!
    const raise = legalActions(state).find((option) => option.type === 'raise')!
    const small = raise.min!
    const large = Math.min(raise.max!, state.bigBlind * 20)
    expect(large).toBeGreaterThan(small)

    const [atSmall, atLarge] = foldEquityOf(state, seat, [small, large])
    expect(atLarge).toBeCloseTo(atSmall!, 12)
  })

  it('still prices a seat it knows nothing about by the general rule', () => {
    const strangers = toTheFlop(tableOf(null, 5))
    const seat = strangers.toAct!
    const sizings = [Math.round(potSize(strangers) * 0.75)]
    const [generic] = foldEquityOf(strangers, seat, sizings)
    expect(generic).toBeGreaterThan(0)
    expect(generic).toBeLessThanOrEqual(1)
  })
})

describe('how often nobody calls', () => {
  it('is never certain when one of them cannot fold', () => {
    // A seat that is already all-in is in the pot whatever the hero does, so a
    // bet cannot win it uncontested — and the model has to say so. The
    // enumeration behind the pricing skips outcomes with no chance of
    // happening, and "everybody folds" is exactly the outcome that goes to
    // zero the moment one opponent has nothing left to fold; reading it out of
    // that loop credited the bet with the whole field folding precisely when
    // the whole field could not.
    const state = startHand(
      {
        seats: [
          { name: 'Big', style: 'tag', stack: 200 },
          { name: 'Also big', style: 'nit', stack: 200 },
          { name: 'Short', style: 'station', stack: 2 },
          { name: 'Hero', style: null, stack: 200 },
        ],
        buttonSeat: 0,
        smallBlind: 1,
        bigBlind: 2,
      },
      new Rng(2),
    )

    expect(state.seats[2]!.status).toBe('allin')
    const seat = state.toAct!
    const raise = legalActions(state).find((option) => option.type === 'raise')!
    const [fold] = foldEquityOf(state, seat, [raise.min!])
    expect(fold).toBe(0)
  })

  it('is the chance of every one of them folding, and no more', () => {
    // Two opponents who each fold sometimes cannot together fold more often
    // than either of them does alone.
    const state = tableOf('nit', 15)
    const seat = state.toAct!
    const raise = legalActions(state).find((option) => option.type === 'raise')!
    const [everybody] = foldEquityOf(state, seat, [raise.min!])

    const live = state.seats.filter((s) => s.index !== seat && s.status !== 'folded')
    expect(live.length).toBeGreaterThan(1)
    expect(everybody).toBeGreaterThan(0)
    expect(everybody).toBeLessThan(1)

    // Folding out three rocks at once is harder than folding out one, and a
    // number that ignored that is what a bet gets over-valued by.
    const headsUp = tableOf('nit', 15)
    const shortened: HandState = {
      ...headsUp,
      seats: headsUp.seats.map((s, i) =>
        i > 1 && s.index !== seat ? { ...s, status: 'folded' as const } : { ...s },
      ),
    }
    const [fewer] = foldEquityOf(shortened, seat, [raise.min!])
    expect(fewer).toBeGreaterThan(everybody!)
  })
})

describe('what a called bet gets to keep', () => {
  it('keeps all of it on the river and less the further the hand has to travel', () => {
    // The pricing is exact where the hand ends on the street it prices, and
    // that has to survive: every river test in the grader depends on it.
    const marginal = 0.4
    expect(realisedWhenCalled('river', marginal)).toBe(1)
    expect(realisedWhenCalled('turn', marginal)).toBeLessThan(realisedWhenCalled('river', marginal))
    expect(realisedWhenCalled('flop', marginal)).toBeLessThan(realisedWhenCalled('turn', marginal))
    expect(realisedWhenCalled('preflop', marginal)).toBeLessThan(
      realisedWhenCalled('flop', marginal),
    )
    // And it is a discount, not a write-off.
    expect(realisedWhenCalled('preflop', marginal)).toBeGreaterThan(0.5)
  })

  it('keeps less of it the weaker the hand is, and all of it at the top', () => {
    // The point the flat version missed. A hand that is already ahead of the
    // callers has no trouble on the next street; a hand with nothing has to
    // give up the pot it just built or keep paying for it. Measuring the
    // coach's own bets is what found this: with the worst quarter of starting
    // hands it recommended a pot-sized bet half the time, and those bets
    // returned −12.84bb apiece against a model that priced them at +3.34bb.
    expect(realisedWhenCalled('preflop', 0.1)).toBeLessThan(realisedWhenCalled('preflop', 0.5))
    expect(realisedWhenCalled('preflop', 0.5)).toBeLessThan(realisedWhenCalled('preflop', 0.9))
    // The nuts realise everything, on any street: there is nothing to be
    // outplayed out of.
    expect(realisedWhenCalled('preflop', 1)).toBe(1)
    expect(realisedWhenCalled('flop', 1)).toBe(1)
    // And an equity outside the range it can take is not a licence to invent
    // a discount above one or below nothing.
    expect(realisedWhenCalled('preflop', 1.4)).toBe(1)
    expect(realisedWhenCalled('preflop', -0.2)).toBeGreaterThan(0)
  })

  it('keeps all of it when the bet is for the last chip, whatever the street', () => {
    // A shove ends the betting. There is no next street to be outplayed on, so
    // discounting one would invent a cost the hand cannot incur.
    //
    // The same flop, the same board, the same opponents and the same number of
    // chips going in — the only difference is whether that leaves the hero
    // anything behind. Nothing else in the pricing reads the hero's stack, so
    // the gap between the two prices is the discount and nothing else.
    const start = toTheFlop(tableOf('tag', 21))
    expect(start.street).toBe('flop')
    const seat = start.toAct!
    const raise = legalActions(start).find((option) => option.type === 'raise')!
    const to = Math.min(raise.max!, Math.max(raise.min!, Math.round(potSize(start) * 0.6)))
    const amount = to - start.seats[seat]!.committed
    expect(amount).toBeGreaterThan(0)

    const withStack = (stack: number): HandState => ({
      ...start,
      seats: start.seats.map((s) => (s.index === seat ? { ...s, stack } : { ...s })),
    })
    const priceOf = (state: HandState) =>
      evaluateActions(evContext(state, seat, 4242), [to]).options.find(
        (option) => option.action.type === 'raise',
      )!

    const forTheLastChip = priceOf(withStack(amount))
    const withMoreBehind = priceOf(withStack(amount + 200))

    expect(forTheLastChip.ev).toBeGreaterThan(withMoreBehind.ev)
    // And the two agree about how often the field folds, because that part of
    // the model has nothing to do with what is left behind.
    expect(forTheLastChip.foldEquity).toBeCloseTo(withMoreBehind.foldEquity!, 12)
  })
})
