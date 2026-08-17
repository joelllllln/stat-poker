import { describe, expect, it } from 'vitest'
import { NUM_CARDS, parseCards } from './cards'
import { categoryOf, describe as describeHand, evaluate, HandCategory } from './evaluator'

const value = (text: string) => evaluate(parseCards(text))
const category = (text: string) => categoryOf(value(text))

describe('hand categories', () => {
  it('identifies each category', () => {
    expect(category('As Ks Qs Js Ts')).toBe(HandCategory.StraightFlush)
    expect(category('5s 4s 3s 2s As')).toBe(HandCategory.StraightFlush) // steel wheel
    expect(category('9c 9d 9h 9s 2c')).toBe(HandCategory.Quads)
    expect(category('9c 9d 9h 2c 2d')).toBe(HandCategory.FullHouse)
    expect(category('As Js 9s 5s 3s')).toBe(HandCategory.Flush)
    expect(category('9c 8d 7h 6s 5c')).toBe(HandCategory.Straight)
    expect(category('Ac 5d 4h 3s 2c')).toBe(HandCategory.Straight) // the wheel
    expect(category('9c 9d 9h 5s 2c')).toBe(HandCategory.Trips)
    expect(category('9c 9d 5h 5s 2c')).toBe(HandCategory.TwoPair)
    expect(category('9c 9d 7h 5s 2c')).toBe(HandCategory.Pair)
    expect(category('Ac Jd 9h 5s 3c')).toBe(HandCategory.HighCard)
  })

  it('does not read a straight through the ace (QKA23)', () => {
    expect(category('Qc Kd Ah 2s 3c')).toBe(HandCategory.HighCard)
  })

  it('ranks the wheel below every other straight', () => {
    expect(value('6c 5d 4h 3s 2c')).toBeGreaterThan(value('Ac 5d 4h 3s 2c'))
  })
})

describe('ordering', () => {
  it('orders categories correctly', () => {
    const ascending = [
      'Ac Jd 9h 5s 3c', // high card
      '9c 9d 7h 5s 2c', // pair
      '9c 9d 5h 5s 2c', // two pair
      '9c 9d 9h 5s 2c', // trips
      '9c 8d 7h 6s 5c', // straight
      'As Js 9s 5s 3s', // flush
      '9c 9d 9h 2c 2d', // full house
      '9c 9d 9h 9s 2c', // quads
      'As Ks Qs Js Ts', // straight flush
    ].map(value)

    for (let i = 1; i < ascending.length; i++) {
      expect(ascending[i]!).toBeGreaterThan(ascending[i - 1]!)
    }
  })

  it('compares within a category by kicker', () => {
    expect(value('Ac Ad Kh Qs Jc')).toBeGreaterThan(value('Ac Ad Kh Qs 9c'))
    expect(value('Ac Ad 2h 2s 3c')).toBeGreaterThan(value('Kc Kd Qh Qs Jc'))
    expect(value('As Js 9s 5s 3s')).toBeGreaterThan(value('Ks Qs 9s 5s 3s'))
  })

  it('treats identical hands of different suits as a chop', () => {
    expect(value('Ac Kd 9h 5s 3c')).toBe(value('Ah Ks 9c 5d 3h'))
  })
})

describe('seven-card hands', () => {
  it('plays the best five of seven', () => {
    // Two pair on board plus a bigger pair in hand.
    expect(category('Ac Ad 9h 9s 2c 2d 5h')).toBe(HandCategory.TwoPair)
    expect(describeHand(value('Ac Ad 9h 9s 2c 2d 5h'))).toBe('Two Pair, aces and nines')
  })

  it('uses the second set as the pair in a full house', () => {
    // 999 888 2 is nines full of eights, not nines full of nothing.
    expect(describeHand(value('9c 9d 9h 8c 8d 8h 2c'))).toBe('Full House, nines full of eights')
  })

  it('prefers the higher trips when two sets are present', () => {
    expect(value('9c 9d 9h 8c 8d 8h 2c')).toBeGreaterThan(value('8c 8d 8h 7c 7d 7h 2c'))
  })

  it('finds a straight flush among a flush', () => {
    expect(category('9s 8s 7s 6s 5s 2s Ah')).toBe(HandCategory.StraightFlush)
    expect(describeHand(value('9s 8s 7s 6s 5s 2s Ah'))).toBe('Straight Flush, nine-high')
  })

  it('names a royal', () => {
    expect(describeHand(value('As Ks Qs Js Ts 2c 3d'))).toBe('Royal Flush')
  })

  it('matches the best of all 21 five-card subsets', () => {
    // The direct seven-card path is an optimisation over the definition of the
    // game. This checks it against the definition on random hands.
    let seed = 12345
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
      return seed / 0x80000000
    }

    for (let trial = 0; trial < 20_000; trial++) {
      const seven: number[] = []
      while (seven.length < 7) {
        const card = Math.floor(random() * NUM_CARDS)
        if (!seven.includes(card)) seven.push(card)
      }

      let best = -1
      for (let a = 0; a < 3; a++)
        for (let b = a + 1; b < 4; b++)
          for (let c = b + 1; c < 5; c++)
            for (let d = c + 1; d < 6; d++)
              for (let e = d + 1; e < 7; e++) {
                const five = evaluate([seven[a]!, seven[b]!, seven[c]!, seven[d]!, seven[e]!])
                if (five > best) best = five
              }

      expect(evaluate(seven)).toBe(best)
    }
  })
})

describe('exhaustive distribution', () => {
  // Every five-card hand, counted by category. These frequencies are fixed
  // properties of the deck, so any error in the evaluator moves at least two
  // of these numbers.
  it('reproduces the known five-card frequencies', () => {
    const counts = new Array(9).fill(0)
    const hand = [0, 0, 0, 0, 0]

    for (let a = 0; a < NUM_CARDS; a++) {
      hand[0] = a
      for (let b = a + 1; b < NUM_CARDS; b++) {
        hand[1] = b
        for (let c = b + 1; c < NUM_CARDS; c++) {
          hand[2] = c
          for (let d = c + 1; d < NUM_CARDS; d++) {
            hand[3] = d
            for (let e = d + 1; e < NUM_CARDS; e++) {
              hand[4] = e
              counts[categoryOf(evaluate(hand))]++
            }
          }
        }
      }
    }

    expect(counts[HandCategory.StraightFlush]).toBe(40)
    expect(counts[HandCategory.Quads]).toBe(624)
    expect(counts[HandCategory.FullHouse]).toBe(3_744)
    expect(counts[HandCategory.Flush]).toBe(5_108)
    expect(counts[HandCategory.Straight]).toBe(10_200)
    expect(counts[HandCategory.Trips]).toBe(54_912)
    expect(counts[HandCategory.TwoPair]).toBe(123_552)
    expect(counts[HandCategory.Pair]).toBe(1_098_240)
    expect(counts[HandCategory.HighCard]).toBe(1_302_540)

    const total = counts.reduce((sum: number, n: number) => sum + n, 0)
    expect(total).toBe(2_598_960)
  }, 120_000)

  // All 133,784,560 seven-card hands. Minutes, not seconds — run with
  // `npm run test:slow`.
  it.runIf(process.env.SLOW_TESTS)('reproduces the known seven-card frequencies', () => {
    const counts = new Array(9).fill(0)
    const hand = [0, 0, 0, 0, 0, 0, 0]

    for (let a = 0; a < NUM_CARDS; a++) {
      hand[0] = a
      for (let b = a + 1; b < NUM_CARDS; b++) {
        hand[1] = b
        for (let c = b + 1; c < NUM_CARDS; c++) {
          hand[2] = c
          for (let d = c + 1; d < NUM_CARDS; d++) {
            hand[3] = d
            for (let e = d + 1; e < NUM_CARDS; e++) {
              hand[4] = e
              for (let f = e + 1; f < NUM_CARDS; f++) {
                hand[5] = f
                for (let g = f + 1; g < NUM_CARDS; g++) {
                  hand[6] = g
                  counts[categoryOf(evaluate(hand))]++
                }
              }
            }
          }
        }
      }
    }

    expect(counts[HandCategory.StraightFlush]).toBe(41_584)
    expect(counts[HandCategory.Quads]).toBe(224_848)
    expect(counts[HandCategory.FullHouse]).toBe(3_473_184)
    expect(counts[HandCategory.Flush]).toBe(4_047_644)
    expect(counts[HandCategory.Straight]).toBe(6_180_020)
    expect(counts[HandCategory.Trips]).toBe(6_461_620)
    expect(counts[HandCategory.TwoPair]).toBe(31_433_400)
    expect(counts[HandCategory.Pair]).toBe(58_627_800)
    expect(counts[HandCategory.HighCard]).toBe(23_294_460)
  }, 1_800_000)
})
