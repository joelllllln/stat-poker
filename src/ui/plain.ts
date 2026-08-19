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
const SEAT_MEANING: Record<string, string> = {
  BTN: 'you act last after the flop, which is the best seat at the table',
  SB: 'you act first after the flop, which is the hardest seat',
  BB: 'you have already paid the big blind, so it costs less to continue',
  UTG: 'you act first, with everybody still to come',
  CO: 'only the button acts after you',
  HJ: 'two players act after you',
  MP: 'several players still act after you',
}

export function positionInWords(seat: number, buttonSeat: number, numSeats: number): string {
  const name = positionName(seat, buttonSeat, numSeats)
  const meaning = SEAT_MEANING[name]
  return meaning ? `${name} — ${meaning}` : name
}

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
}): string {
  const holding = strengthInWords(reason.equity)
  const wins = timesInTen(reason.equity)

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

    case 'call':
      return `You are ${holding} — you would win this ${wins}, which is more than the price needs.`

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
