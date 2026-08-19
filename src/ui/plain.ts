/**
 * The game, in words a beginner already knows.
 *
 * Everything else in this app is written for somebody who can read a
 * statistic. Percentages against a modelled range, big blinds of expected
 * value, VPIP, all-in adjusted results — each of those is the right way to say
 * a precise thing, and each of them is unreadable to the person the app is
 * supposed to be teaching. A beginner looking at "85.1%" does not know what it
 * is 85.1% *of*, whether it is good, or what to do about it.
 *
 * So the numbers stay, and every one of them gets a sentence. This is the one
 * place those sentences are written, so the game says the same thing in the
 * same voice wherever it says it, and so they can be tested rather than
 * scattered through the markup as string literals.
 *
 * Two rules. Say the thing, not the label: "you have a pair of aces", not
 * "made hand: pair". And never claim more than the number supports — the
 * hedging in the rest of the app exists for good reasons, and translating it
 * into plain English is not licence to drop it.
 */

import { RANKS, rankOf, suitOf, type Card } from '../engine/cards'
import { categoryOf, describe, evaluate, HandCategory } from '../engine/evaluator'
import { positionName } from '../engine/types'

const PLURAL = [
  'twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines',
  'tens', 'jacks', 'queens', 'kings', 'aces',
]
const SINGLE = [
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'jack', 'queen', 'king', 'ace',
]

/** "ace", "jack", "seven" — the rank of a card, spoken. */
export const rankWord = (card: Card): string => SINGLE[rankOf(card)] ?? '?'

/**
 * What the two cards in your hand are, before any board.
 *
 * Preflop there is no made hand to name, and "high card, ace" is a bad way to
 * describe AK. What a player needs to hear is what they are holding and
 * whether the two cards work together.
 */
export function holdingInWords(hole: readonly [Card, Card]): string {
  const [a, b] = hole
  const high = rankOf(a) >= rankOf(b) ? a : b
  const low = rankOf(a) >= rankOf(b) ? b : a
  if (rankOf(a) === rankOf(b)) return `a pair of ${PLURAL[rankOf(a)]}`
  const suited = suitOf(a) === suitOf(b)
  return `${SINGLE[rankOf(high)]}-${SINGLE[rankOf(low)]}${suited ? ', suited' : ''}`
}

/**
 * What you have made, once there is a board to make it with.
 *
 * The evaluator already names the hand; this turns its label into something
 * you would say out loud. "Pair, aces" becomes "a pair of aces".
 */
export function madeHandInWords(hole: readonly [Card, Card], board: readonly Card[]): string {
  if (board.length === 0) return holdingInWords(hole)

  const value = evaluate([...hole, ...board])
  const category = categoryOf(value)
  // The evaluator says "deuces", which is what a poker player calls them and
  // not what somebody learning the game calls them.
  const spoken = describe(value).replace(/deuce/g, 'two')
  const [, detail = ''] = spoken.split(', ')

  switch (category) {
    case HandCategory.HighCard:
      return `${detail.replace('-high', '')} high`
    case HandCategory.Pair:
      return `a pair of ${detail}`
    case HandCategory.TwoPair:
      return `two pair, ${detail}`
    case HandCategory.Trips:
      return `three ${detail}`
    case HandCategory.Straight:
      return `a straight, ${detail}`
    case HandCategory.Flush:
      return `a flush, ${detail}`
    case HandCategory.FullHouse:
      return `a full house, ${detail}`
    case HandCategory.Quads:
      return `four ${detail}`
    default:
      return spoken.toLowerCase()
  }
}

/**
 * Whether the hand is any good, said without a number.
 *
 * The bands are deliberately coarse. A beginner does not need to know that
 * 61% differs from 64%; they need to know which side of a coin flip they are
 * on and roughly how far.
 */
export function strengthInWords(equity: number): string {
  if (equity >= 0.85) return 'almost always the best hand here'
  if (equity >= 0.65) return 'usually the best hand here'
  if (equity >= 0.55) return 'a bit better than what they are likely to have'
  if (equity >= 0.45) return 'about even with what they are likely to have'
  if (equity >= 0.3) return 'behind what they are likely to have'
  return 'well behind what they are likely to have'
}

/**
 * A share of the pot as a plain frequency.
 *
 * "You win about 6 times in 10" is a sentence people reason with. "60.4%" is a
 * number people nod at.
 */
export function timesInTen(equity: number): string {
  const times = Math.round(equity * 10)
  if (times <= 0) return 'almost never'
  if (times >= 10) return 'almost every time'
  return `about ${times} ${times === 1 ? 'time' : 'times'} in 10`
}

/**
 * What a call costs and what it needs, in one sentence.
 *
 * Pot odds are the first real idea in poker and the one most often explained
 * with algebra. It is a price: this many chips to win that many, so you have
 * to be right this often. `pot` is what the call plays for, the call included.
 */
export function priceInWords(toCall: number, pot: number): string {
  if (toCall <= 0) return 'Free to see the next card.'
  const share = toCall / pot
  const inTen = Math.max(1, Math.round(share * 10))
  // Short enough to be one line on a 360-pixel phone, because the line under
  // it is the fold button and a sentence that wraps pushes it off the screen.
  return (
    `Costs ${toCall} to win ${pot} — call if you win ` +
    `${inTen} ${inTen === 1 ? 'time' : 'times'} in 10.`
  )
}

/** Where you are sitting and what that means for the hand. */
const SEAT_MEANING: Record<string, { plain: string; why: string }> = {
  BTN: {
    plain: 'the dealer',
    why: 'you act last after the flop, which is the best seat at the table',
  },
  SB: {
    plain: 'the small blind',
    why: 'you paid half a blind before the cards, and act first after the flop',
  },
  BB: {
    plain: 'the big blind',
    why: 'you paid a full blind before the cards, so it costs less to continue',
  },
  UTG: { plain: 'first to act', why: 'everybody is still to come after you' },
  CO: { plain: 'one before the dealer', why: 'only the dealer acts after you' },
  HJ: { plain: 'two before the dealer', why: 'two players act after you' },
  MP: { plain: 'in the middle', why: 'several players still act after you' },
}

/** The plain name of a seat: "the big blind", never "BB". */
export function seatInWords(seat: number, buttonSeat: number, numSeats: number): string {
  const name = positionName(seat, buttonSeat, numSeats)
  return SEAT_MEANING[name]?.plain ?? name
}

export function positionInWords(seat: number, buttonSeat: number, numSeats: number): string {
  const name = positionName(seat, buttonSeat, numSeats)
  const meaning = SEAT_MEANING[name]
  return meaning ? `${meaning.plain} — ${meaning.why}` : name
}

/**
 * What a big blind is, said once where the number is used.
 *
 * Poker counts money in big blinds so that a result means the same thing at
 * any stake, and every book and every training tool writes it "bb". Nobody
 * arrives knowing that, and a unit you cannot read makes every number wearing
 * it unreadable too.
 */
export const bigBlindsExplained = (bigBlind: number): string =>
  `bb means big blinds — the unit poker counts in, so that a result means the ` +
  `same at any stake. One big blind is ${bigBlind} chips here.`

/** A bet size as a share of the pot, said as what it is. */
export function sizeInWords(to: number, pot: number, toCall: number): string {
  const extra = to - toCall
  if (pot <= 0) return `${to}`
  const share = extra / pot
  if (share >= 0.95) return 'about the size of the pot'
  if (share >= 0.7) return 'about three quarters of the pot'
  if (share >= 0.45) return 'about half the pot'
  if (share >= 0.28) return 'about a third of the pot'
  return 'a small bet'
}

/** The suit glyph for a card, for reading a board back. */
export const cardInWords = (card: Card): string =>
  `${RANKS[rankOf(card)]}${['♣', '♦', '♥', '♠'][suitOf(card)]}`

/**
 * Why the coach is recommending what it is recommending.
 *
 * The panel already shows every option priced against every other, which is an
 * argument if you can read it and a wall of numbers if you cannot. This is the
 * same argument as a sentence: what you have, what it is up against, and what
 * the recommended action does about it.
 *
 * It says nothing the pricing does not already contain. Where the two best
 * actions are inside the noise of each other the panel says so and this stays
 * quiet, because a confident reason for a decision the model cannot make is
 * the worst thing it could offer a beginner.
 */
export function reasonInWords(reason: {
  action: 'fold' | 'check' | 'call' | 'raise'
  equity: number
  toCall: number
  /** What a call plays for, the call included. */
  pot: number
  /** How often the field is expected to fold to the recommended bet. */
  foldEquity?: number | undefined
  /** True when the top two options are too close to separate. */
  tooClose?: boolean | undefined
  /** Share of what a call plays for that it has to win to break even. */
  requiredEquity?: number | undefined
}): string {
  const holding = strengthInWords(reason.equity)
  const wins = timesInTen(reason.equity)
  const price = reason.requiredEquity ?? 0

  if (reason.tooClose) {
    return `You are ${holding}. Either of the top two is fine here — they are worth the same once you allow for how rough these numbers are.`
  }

  switch (reason.action) {
    case 'fold':
      return reason.toCall > 0
        ? `You are ${holding} — you would win this ${wins}, and that is not often enough for what the call costs.`
        : `You are ${holding}, and there is nothing here worth putting money in for.`

    case 'check':
      return reason.equity >= 0.55
        ? `You are ${holding}, but betting does not gain here — take the free card and keep the pot small enough to control.`
        : `You are ${holding}. Nobody has bet, so see the next card for nothing rather than paying to find out.`

    case 'call': {
      // "You are behind … which is more than the price needs" reads like a
      // contradiction. Being behind and still having a call is the normal
      // case, and it is worth saying as one sentence rather than two clauses
      // that appear to argue with each other.
      const needs = Math.max(1, Math.round(price * 10))
      return reason.equity >= 0.5
        ? `You are ${holding}, and the price only asks that you win ${needs} in 10 — you win it ${wins}.`
        : `You are behind, but not by enough to fold: the price asks that you win ${needs} in 10 and you win it ${wins}.`
    }

    case 'raise': {
      const folds = reason.foldEquity ?? 0
      if (reason.equity >= 0.6) {
        return `You are ${holding}. Bet to be paid by the worse hands that will call — you win this ${wins} when they do.`
      }
      if (folds >= 0.4) {
        return `You are ${holding}, so this bet is working by making them fold — it does that ${timesInTen(folds)}.`
      }
      return `You are ${holding}, and betting is still worth more than the alternatives here — though it wins mostly by the times they fold, ${timesInTen(folds)}.`
    }
  }
}

/**
 * The statistics, read out loud.
 *
 * A dashboard of VPIP, PFR, WTSD, AF and bb/100 is a professional's
 * instrument panel. To a beginner it is five numbers with no scale: 97% of
 * what, compared to whom, and is a bigger one better? Each of these says what
 * the number means and where it sits against how a solid player plays, because
 * a number without a comparison is not a fact anybody can act on.
 *
 * The comparisons are the ordinary ranges quoted for six-handed games. They
 * are a signpost, not a target, and they are worded as one.
 */

/** How often you put money in before the flop. */
export function vpipInWords(vpip: number): string {
  const played = `You play ${vpip.toFixed(0)} hands in every 100.`
  if (vpip >= 45) return `${played} A solid player plays about 25 — you are paying to see far too many flops.`
  if (vpip >= 33) return `${played} A solid player plays about 25, so you are coming in a bit too wide.`
  if (vpip >= 18) return `${played} That is about where a solid player sits.`
  return `${played} A solid player plays about 25, so you are letting playable hands go.`
}

/** How often you come in raising rather than calling. */
export function pfrInWords(pfr: number, vpip: number): string {
  const raised = `You raise ${pfr.toFixed(0)} hands in every 100 before the flop.`
  if (vpip <= 0) return raised
  const share = pfr / vpip
  if (share >= 0.7) return `${raised} Almost everything you play, you play aggressively.`
  if (share >= 0.45) return `${raised} That is a healthy share of the hands you play.`
  return `${raised} Most hands you play, you only call — the lead is worth taking more often.`
}

/** How often a flop you saw ends with your cards face up. */
export function wtsdInWords(wtsd: number): string {
  const shown = `When you see a flop, you end up showing your cards ${wtsd.toFixed(0)} times in 100.`
  if (wtsd >= 40) return `${shown} About 27 is normal — you are paying to the end too often.`
  if (wtsd >= 20) return `${shown} That is about normal.`
  return `${shown} About 27 is normal — you may be letting go of hands that were still good.`
}

/** How much you bet and raise, against how much you call. */
export function aggressionInWords(af: number): string {
  if (af <= 0.05) return 'You almost never bet or raise — you are along for the ride in the pots you enter.'
  const per = `For every call you make, you bet or raise ${af.toFixed(1)} times.`
  if (af >= 6) return `${per} That is a lot — around 2 to 3 is the usual shape of a winning player.`
  if (af >= 1.5) return `${per} That is about the shape of a winning player.`
  return `${per} Winning players are nearer 2 to 3 — you are calling more than you are pushing.`
}

/**
 * What a winrate means, per hand rather than per hundred.
 *
 * bb/100 is the unit the game is measured in and nobody new to it thinks in
 * hundreds of hands. Per hand is a quantity a person can picture.
 */
export function winrateInWords(bbPer100: number, bigBlind: number): string {
  const perHand = bbPer100 / 100
  const chips = Math.abs(perHand * bigBlind)
  const direction = perHand >= 0 ? 'winning' : 'losing'
  if (Math.abs(perHand) < 0.05) return 'You are breaking about even.'
  return (
    `You are ${direction} about ${Math.abs(perHand).toFixed(1)} big blinds a hand ` +
    `— ${chips.toFixed(0)} chips at this table.`
  )
}

/** What the coach's mark on your play amounts to. */
export function evLostInWords(bbPer100: number): string {
  const perHand = bbPer100 / 100
  if (perHand < 0.15) return 'The coach would have played these hands almost exactly as you did.'
  if (perHand < 1) return `The coach would have made about ${perHand.toFixed(1)} big blinds a hand more than you did.`
  return `The coach would have made about ${perHand.toFixed(0)} big blinds a hand more than you did — there is a lot on the table.`
}

/**
 * The blind you already posted, and why it is not a reason to play.
 *
 * A third of the hands you are dealt, you have paid before you have seen a
 * card, and folding hands that money over. Somebody new watches their stack go
 * from 200 to 199 while the app calls folding "worth nothing" and reasonably
 * concludes the app is lying to them.
 *
 * It is not, and the difference is the first real idea in poker: those chips
 * stopped being yours when they went in. Every action from here is measured
 * against what happens next, and "but I already put money in" is the thought
 * that costs beginners the most money there is. Saying it once, in the moment
 * it applies, is worth more than any amount of correct arithmetic elsewhere.
 */
export function postedInWords(committed: number, blind: 'small' | 'big'): string {
  return (
    `You have ${committed} in already — the ${blind} blind, which you pay in turn like ` +
    `everyone else. It is spent whatever you do now, so it is not a reason to play the hand.`
  )
}

/** Which blind this seat posted, if it posted one and has done nothing else. */
export function blindPosted(
  seat: number,
  buttonSeat: number,
  numSeats: number,
): 'small' | 'big' | null {
  const name = positionName(seat, buttonSeat, numSeats)
  return name === 'SB' ? 'small' : name === 'BB' ? 'big' : null
}
