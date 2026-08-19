/**
 * The opponents the coach is actually facing.
 *
 * The pricing model used to split every villain's range by one rule: a hand
 * continues when its equity clears the price it is being laid, discounted for
 * the equity it will not get to realise. That is a defensible rule about poker
 * in general. It is not a description of the five players sitting at this
 * table, and a thousand simulated hands said so: across 1,552 bets the coach
 * expected the field to fold 38.9% of the time and it folded 26.9%, and by the
 * turn it was expecting 55.7% against 27.9%. Pricing them by their own rules
 * brings that to 22.8% expected against 25.8% seen, and 32.3% against 28.3%
 * on the turn.
 *
 * So this is the other half of the model: the app deals opponents whose rules
 * it wrote, and it can price them by those rules rather than by a generic one.
 * Every threshold here is read straight off `src/bots/policy.ts`, and the tests
 * hold the two together, because a coach whose model of the table drifts away
 * from the table is back where it started.
 *
 * Where the style is unknown — a hand imported from somewhere else, a seat with
 * no archetype — the generic rule still applies. Not knowing who is sitting
 * there is a reason to fall back on poker, not a reason to guess.
 */

import { ARCHETYPES, type Archetype } from '../bots/archetypes'
import type { HandState, Street } from '../engine/types'

/**
 * How much of its raw equity a calling hand is assumed to keep, absent any
 * knowledge of who holds it.
 *
 * Pot odds alone say to continue whenever equity beats the price, but a hand
 * that calls still has to play the rest of the hand — often out of position,
 * often facing more bets, and rarely able to see every card it was counting
 * on. Requiring a hand to clear the price with room to spare is what stops the
 * model concluding that nobody ever folds to anything.
 */
export const EQUITY_REALIZATION = 0.82

/**
 * The multiplier a seat applies to the equity a call needs.
 *
 * Below 1 is a station calling too wide; above 1 is a rock folding hands that
 * are getting the right price. `1 / EQUITY_REALIZATION` is the generic rule,
 * which sits above every archetype's — which is exactly the bias the
 * measurement found.
 */
export const callDisciplineOf = (style: Archetype | null): number =>
  style ? style.callDiscipline : 1 / EQUITY_REALIZATION

/**
 * The share of starting hands a seat continues with against a raise.
 *
 * Preflop the bots do not price anything: they look at where the hand ranks
 * among all starting hands and defend the top slice of it, narrowing as the
 * raises stack up. That is why a big preflop bet buys the coach nothing it
 * expects — the rock folds nine hands in ten to a minimum raise and to a shove
 * alike, and the fish calls both.
 *
 * `raises` is how many raises will have gone in preflop once the bet being
 * priced is made.
 */
export const defendWidthOf = (style: Archetype, raises: number): number =>
  style.defendWidth / Math.max(1, raises)

/** The archetype at a seat, or null where the table does not say. */
export const styleAt = (state: HandState, seat: number): Archetype | null => {
  const id = state.seats[seat]?.style
  return id ? (ARCHETYPES[id] ?? null) : null
}

/** Raises made preflop so far, which is what the defending width divides by. */
export const preflopRaises = (state: HandState): number =>
  state.actions.filter((entry) => entry.street === 'preflop' && entry.action.type === 'raise')
    .length

/**
 * How much of its equity a *called* bet actually gets to realise.
 *
 * The scope note on the pricing model says it plainly: this is a one-street
 * model, and where the hand does not end on this street it is an
 * approximation. Measuring the approximation showed how large it is. Every
 * price the coach quotes says an action is worth so many chips more than
 * folding; settling those against the chips they returned, over a thousand
 * hands, its bets came back 17bb light apiece while its checks came back
 * within the noise.
 *
 * That difference is the whole story. Checking does not build a pot; betting
 * and being called does, and the model then hands the hero the whole of that
 * pot at showdown as though there were no more betting to come. There is, and
 * it is played with a range the bet has already announced.
 *
 * So a called bet realises less than its raw equity, by more the further the
 * hand still has to travel. On the river it realises all of it, because there
 * is nothing left to travel: the model is exact there and must stay exact.
 *
 * **And by more the weaker the hand is**, which a flat discount per street
 * missed entirely. Measuring the bets the coach recommends showed where the
 * money goes: with the worst quarter of starting hands it was recommending a
 * pot-sized bet half the time, and those bets returned −12.84bb apiece against
 * a model that priced them at +3.34bb. The same coach with one change — refuse
 * to bet a hand that is behind — went from −294bb/100 to −10.8.
 *
 * The reason is not fold equity, which is now accurate to three points. It is
 * that a hand which cannot stand a bet does not get to realise its share of a
 * pot it has just inflated. Bet the pot with seven-three, get called, and the
 * next street costs again: either you give up everything you built or you keep
 * paying. A hand that is already ahead has no such problem, which is why the
 * discount has to depend on the hand and not only on the street.
 *
 * At the top it is exactly one — the nuts realise everything, on any street —
 * and on the river it is exactly one for everybody. Both of those are places
 * the model is exact and has to stay exact.
 *
 * This does not make the model see the next street. It makes it stop pricing
 * the next street as though it were already won.
 */
const UNREALISED_PER_STREET = 0.12

const STREETS_LEFT: Record<Street, number> = { preflop: 3, flop: 2, turn: 1, river: 0 }

export const realisedWhenCalled = (street: Street, equity: number): number =>
  1 - (1 - Math.min(1, Math.max(0, equity))) * UNREALISED_PER_STREET * STREETS_LEFT[street]

/**
 * The share of the pot below which this model will not recommend betting.
 *
 * A bet made with a hand that is behind the range which would call it is a
 * bluff, and **this model cannot price a bluff**. A bluff is won or lost on the
 * street after the one it is made on — the street where it is either continued
 * or abandoned — and a one-street model cannot see that street. What it sees is
 * the immediate fold equity, which is real, and it banks it as though the hand
 * were over.
 *
 * Measured, that error is not small. With the worst quarter of starting hands
 * the coach was recommending a pot-sized bet half the time; those bets returned
 * −12.84bb apiece against a model that priced them at +3.34bb. The same coach
 * with one change — decline to bet a hand that is behind — went from −294bb/100
 * to −10.8, past folding every hand, which nothing following this coach had
 * managed before.
 *
 * So it declines. Not because bluffing is wrong — it is most of poker — but
 * because a model that cannot see the street a bluff is settled on has no
 * business recommending one, least of all to somebody learning the game. It
 * teaches the half it can price: bet when you are ahead, and know why.
 */
export const WILL_NOT_BLUFF_BELOW = 0.5
