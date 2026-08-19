import { describe as group, expect, it } from 'vitest'
import { parseCards, type Card } from '../engine/cards'
import {
  holdingInWords,
  madeHandInWords,
  priceInWords,
  positionInWords,
  sizeInWords,
  reasonInWords,
  strengthInWords,
  timesInTen,
} from './plain'

/**
 * The app has to be readable by somebody who does not read statistics.
 *
 * Every sentence here is shown to a beginner in place of a number, which makes
 * a wrong one worse than the number it replaced: a percentage that is not
 * understood is ignored, but a sentence that is understood and wrong is
 * believed. So they are tested like anything else that makes a claim.
 */

const hand = (text: string): [Card, Card] => {
  const cards = parseCards(text)
  return [cards[0]!, cards[1]!]
}

group('what you are holding, before a flop', () => {
  it('names a pair by its rank', () => {
    expect(holdingInWords(hand('Ac Ad'))).toBe('a pair of aces')
    expect(holdingInWords(hand('2c 2d'))).toBe('a pair of twos')
  })

  it('names two cards high one first, and says when they match suits', () => {
    expect(holdingInWords(hand('Ac Kc'))).toBe('ace-king, suited')
    expect(holdingInWords(hand('Kd Ac'))).toBe('ace-king')
    expect(holdingInWords(hand('7s 2h'))).toBe('seven-two')
  })
})

group('what you have made, once there is a board', () => {
  it('names the made hand the way somebody would say it', () => {
    const board = parseCards('Ah 7s 4d')
    expect(madeHandInWords(hand('Ac Kd'), board)).toBe('a pair of aces')
    expect(madeHandInWords(hand('7c 7d'), board)).toBe('three sevens')
    expect(madeHandInWords(hand('Ac 7h'), board)).toBe('two pair, aces and sevens')
    // The best five cards, which is what a hand is — the ace on the board
    // counts even though it is not in your hand.
    expect(madeHandInWords(hand('Kc Qd'), board)).toBe('ace high')
    expect(madeHandInWords(hand('Kc Qd'), parseCards('9h 7s 4d'))).toBe('king high')
  })

  it('names the big ones', () => {
    expect(madeHandInWords(hand('Ac Kc'), parseCards('Qc Jc Tc'))).toContain('royal')
    expect(madeHandInWords(hand('2c 2d'), parseCards('2h 2s 9c'))).toBe('four twos')
    expect(madeHandInWords(hand('9c 9d'), parseCards('9h 4s 4d'))).toBe(
      'a full house, nines full of fours',
    )
  })

  it('falls back to the holding when there is no board yet', () => {
    expect(madeHandInWords(hand('Ac Kd'), [])).toBe('ace-king')
  })
})

group('whether that is any good', () => {
  it('puts a share of the pot on the right side of a coin flip', () => {
    expect(strengthInWords(0.92)).toContain('almost always')
    expect(strengthInWords(0.5)).toContain('about even')
    expect(strengthInWords(0.2)).toContain('well behind')
  })

  it('says how often rather than what percentage', () => {
    expect(timesInTen(0.6)).toBe('about 6 times in 10')
    expect(timesInTen(0.1)).toBe('about 1 time in 10')
    expect(timesInTen(0.99)).toBe('almost every time')
    expect(timesInTen(0.01)).toBe('almost never')
  })
})

group('what a call costs', () => {
  it('states the price as a price and what it demands', () => {
    // 20 to win 80 is a quarter: right about 3 times in 10 and it is a call.
    expect(priceInWords(20, 80)).toBe(
      'Costs 20 to win 80 — call if you win 3 times in 10.',
    )
  })

  it('says so when there is nothing to pay', () => {
    expect(priceInWords(0, 40)).toBe('Free to see the next card.')
  })

  it('never demands less than something', () => {
    // A tiny call into an enormous pot still is not free.
    expect(priceInWords(1, 500)).toContain('1 time in 10')
  })
})

group('where you are sitting', () => {
  it('says what the seat means, not just its initials', () => {
    // Six-handed with the button on seat 0, seat 0 is the button.
    expect(positionInWords(0, 0, 6)).toContain('act last')
    expect(positionInWords(1, 0, 6)).toContain('act first')
  })
})

group('what a bet size is', () => {
  it('describes it against the pot', () => {
    expect(sizeInWords(50, 50, 0)).toBe('about the size of the pot')
    expect(sizeInWords(25, 50, 0)).toBe('about half the pot')
    expect(sizeInWords(17, 50, 0)).toBe('about a third of the pot')
    // A raise is measured by what it adds, not by the total.
    expect(sizeInWords(60, 50, 10)).toBe('about the size of the pot')
  })
})

group('why the coach says what it says', () => {
  const spot = { equity: 0.7, toCall: 20, pot: 80 }

  it('explains a fold by what the hand wins against what it costs', () => {
    const said = reasonInWords({ ...spot, action: 'fold', equity: 0.2 })
    expect(said).toContain('well behind')
    expect(said).toContain('2 times in 10')
  })

  it('explains a bet by whether it is paid or whether it folds them out', () => {
    expect(reasonInWords({ ...spot, action: 'raise', equity: 0.8 })).toContain('paid')
    const bluff = reasonInWords({ ...spot, action: 'raise', equity: 0.25, foldEquity: 0.5 })
    expect(bluff).toContain('making them fold')
    expect(bluff).toContain('5 times in 10')
  })

  it('says nothing confident when the model cannot separate the top two', () => {
    const said = reasonInWords({ ...spot, action: 'raise', tooClose: true })
    expect(said).toContain('Either of the top two')
    // And it must not also claim the bet is doing something.
    expect(said).not.toContain('making them fold')
  })

  it('tells a beginner to take a free card rather than pay to find out', () => {
    expect(reasonInWords({ ...spot, action: 'check', equity: 0.3, toCall: 0 })).toContain(
      'for nothing',
    )
  })
})
