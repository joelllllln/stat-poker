/**
 * What beats you, rather than how often.
 *
 * "62%" hides the difference between a hand that is either crushing or
 * crushed and one that is comfortably ahead of everything. Both are 62%, and
 * they are not the same decision. This splits the range you are facing into
 * the part you are ahead of, the part you are behind, and the part you chop
 * with — and names the two or three kinds of hand doing the beating.
 *
 * Read as the board stands, not by the river. That is deliberate: it is the
 * question a player is actually asking ("what do they have that has me right
 * now"), it is what makes a range legible, and it is a fact about the current
 * board rather than a forecast. The equity figure elsewhere is the forecast.
 *
 * Nothing here knows what anybody actually holds. It walks the *modelled*
 * range, which is a width read off how the seat has played, so the shares are
 * as good as that model and no better — which is exactly what the panel
 * showing them has to say.
 */

import { CATEGORY_NAMES, categoryOf, evaluate, HandCategory } from '../engine/evaluator'
import type { Card } from '../engine/cards'
import type { Range } from './range'

export interface BeatenBy {
  /** What kind of hand it is, in words: "two pair", "a set". */
  name: string
  /** Share of their whole range this accounts for. */
  share: number
}

export interface RangeSplit {
  /** Shares of the modelled range, which sum to one. */
  ahead: number
  tied: number
  behind: number
  /** The biggest kinds of hand in the part that beats you, largest first. */
  beatenBy: BeatenBy[]
  /** Combos examined, so a caller can say how thin the reading is. */
  combos: number
}

/**
 * How a category reads at a poker table, which is not how it reads in a rule
 * book. Nobody at a table says "three of a kind".
 */
const AT_THE_TABLE: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'high card',
  [HandCategory.Pair]: 'a pair',
  [HandCategory.TwoPair]: 'two pair',
  [HandCategory.Trips]: 'a set',
  [HandCategory.Straight]: 'a straight',
  [HandCategory.Flush]: 'a flush',
  [HandCategory.FullHouse]: 'a full house',
  [HandCategory.Quads]: 'quads',
  [HandCategory.StraightFlush]: 'a straight flush',
}

/** A pair that beats yours is a different lesson from a pair that does not. */
const BETTER_PAIR = 'a better pair'
const BETTER_TWO_PAIR = 'better two pair'

/**
 * Split one modelled range against a hand, on the board as it stands.
 *
 * Returns null before the flop, where there are no made hands to compare and
 * the honest answer is the range width rather than a category breakdown.
 */
export function rangeSplit(
  hero: readonly [Card, Card],
  board: readonly Card[],
  range: Range,
): RangeSplit | null {
  if (board.length < 3) return null

  const dead = new Set<Card>([...hero, ...board])
  const mine = evaluate([...hero, ...board])
  const myCategory = categoryOf(mine)

  let ahead = 0
  let tied = 0
  let behind = 0
  let weighed = 0
  let combos = 0
  const beating = new Map<string, number>()

  for (const combo of range) {
    // A combo holding one of your cards or one of the board's cannot be dealt.
    if (dead.has(combo.cards[0]) || dead.has(combo.cards[1])) continue

    const theirs = evaluate([...combo.cards, ...board])
    const weight = combo.weight
    weighed += weight
    combos += 1

    if (theirs > mine) {
      behind += weight
      const category = categoryOf(theirs)
      // "A pair" is not news when you have one too; "a better pair" is.
      const name =
        category === myCategory && category === HandCategory.Pair
          ? BETTER_PAIR
          : category === myCategory && category === HandCategory.TwoPair
            ? BETTER_TWO_PAIR
            : (AT_THE_TABLE[category] ?? CATEGORY_NAMES[category])
      beating.set(name, (beating.get(name) ?? 0) + weight)
    } else if (theirs === mine) {
      tied += weight
    } else {
      ahead += weight
    }
  }

  if (weighed === 0) return null

  const beatenBy = [...beating.entries()]
    .map(([name, weight]) => ({ name, share: weight / weighed }))
    .sort((a, b) => b.share - a.share)

  return {
    ahead: ahead / weighed,
    tied: tied / weighed,
    behind: behind / weighed,
    beatenBy,
    combos,
  }
}

/**
 * The same split against everyone still in the hand.
 *
 * Being ahead of one range and behind another is being behind: the pot is one
 * pot, and the hand that beats you takes it whoever is holding it. So the
 * shares are combined as independent draws — the chance nobody has you beaten
 * is the product of each range not having you beaten — rather than averaged,
 * which would report a five-handed pot as if it were a heads-up one.
 */
export function splitAgainstAll(
  hero: readonly [Card, Card],
  board: readonly Card[],
  ranges: readonly Range[],
): RangeSplit | null {
  const splits = ranges
    .map((range) => rangeSplit(hero, board, range))
    .filter((split): split is RangeSplit => split !== null)
  if (splits.length === 0) return null
  if (splits.length === 1) return splits[0]!

  const noneBehind = splits.reduce((product, split) => product * (1 - split.behind), 1)
  const noneAbove = splits.reduce((product, split) => product * split.ahead, 1)

  // Categories are pooled across opponents: what matters is that somebody has
  // a set, not which of them it was. Scaled so the parts still add up to the
  // combined chance that anybody has you beaten.
  const pooled = new Map<string, number>()
  for (const split of splits) {
    for (const { name, share } of split.beatenBy) {
      pooled.set(name, (pooled.get(name) ?? 0) + share)
    }
  }
  const total = [...pooled.values()].reduce((sum, share) => sum + share, 0)
  const behind = 1 - noneBehind
  const beatenBy = [...pooled.entries()]
    .map(([name, share]) => ({ name, share: total > 0 ? (share / total) * behind : 0 }))
    .sort((a, b) => b.share - a.share)

  return {
    ahead: noneAbove,
    tied: Math.max(0, noneBehind - noneAbove),
    behind,
    beatenBy,
    combos: splits.reduce((sum, split) => sum + split.combos, 0),
  }
}
