import { describe, expect, it } from 'vitest'
import { parseCards, rankOf, suitOf, type Card } from '../engine/cards'
import { findOuts, summariseOuts } from './outs'
import { parseRange } from './range'

const hand = (text: string) => parseCards(text) as [Card, Card]
const vs = (text: string) => [parseRange(text)]

describe('finding outs', () => {
  it('counts the flush cards when the flush is what wins', () => {
    // Nut flush draw against an overpair: the spades are the outs, and the
    // count should land near nine without ever having been told about flushes.
    const result = findOuts(hand('As 2s'), parseCards('Ks 7s 3h'), vs('KhKd'))

    expect(result.outs.length).toBeGreaterThan(6)
    expect(result.outs.length).toBeLessThan(14)
    const spades = result.outs.filter((card) => suitOf(card) === suitOf(parseCards('2s')[0]!))
    expect(spades.length).toBeGreaterThan(result.outs.length / 2)
  })

  it('says nothing is an out when the hand is already ahead', () => {
    // A set against a lone overcard is not drawing to anything.
    const result = findOuts(hand('7h 7c'), parseCards('7s 2d 3h'), vs('AhKh'))

    expect(result.current).toBeGreaterThan(0.5)
    expect(result.outs).toEqual([])
    expect(summariseOuts(result)).toBe('already ahead')
  })

  it('refuses to count a card that improves them more', () => {
    // Two overcards against a made flush: pairing up does not get there, so
    // the honest count is nothing rather than six.
    const result = findOuts(hand('Ac Kd'), parseCards('7s 5s 2s'), vs('9s8s'))

    expect(result.current).toBeLessThan(0.2)
    expect(result.outs.length).toBeLessThan(4)
  })

  it('counts the cards that pair a hand when pairing is enough', () => {
    // Ace-king against a small pair: any ace or king takes the lead.
    const result = findOuts(hand('Ac Kd'), parseCards('7s 5d 2h'), vs('3h3c'))

    const ranks = new Set(result.outs.map((card) => rankOf(card)))
    expect(ranks.has(rankOf(parseCards('Ah')[0]!))).toBe(true)
    expect(ranks.has(rankOf(parseCards('Kh')[0]!))).toBe(true)
  })

  it('gives two cards to come a better chance than one', () => {
    const flop = findOuts(hand('As 2s'), parseCards('Ks 7s 3h'), vs('KhKd'))
    const turn = findOuts(hand('As 2s'), parseCards('Ks 7s 3h 9c'), vs('KhKd'))

    expect(flop.toCome).toBe(2)
    expect(turn.toCome).toBe(1)
    expect(flop.byRiver).toBeGreaterThan(flop.byNextCard)
    expect(turn.byRiver).toBeCloseTo(turn.byNextCard, 6)
  })

  it('does not simply add the two chances together', () => {
    // The usual shortcut double-counts the runouts that bring two outs, so
    // the true figure must come in under twice the single-card chance.
    const result = findOuts(hand('As 2s'), parseCards('Ks 7s 3h'), vs('KhKd'))
    expect(result.byRiver).toBeLessThan(result.byNextCard * 2)
    expect(result.byRiver).toBeGreaterThan(result.byNextCard)
  })

  it('never counts a card anyone can see', () => {
    const board = parseCards('Ks 7s 3h')
    const hero = hand('As 2s')
    const result = findOuts(hero, board, vs('KhKd'))
    for (const out of result.outs) {
      expect(board).not.toContain(out)
      expect(hero).not.toContain(out)
    }
  })

  it('has nothing to say on the river', () => {
    const result = findOuts(hand('As 2s'), parseCards('Ks 7s 3h 9c 4d'), vs('KhKd'))
    expect(result.toCome).toBe(0)
    expect(result.outs).toEqual([])
    expect(summariseOuts(result)).toBe('no cards to come')
  })

  it('is reproducible', () => {
    const a = findOuts(hand('As 2s'), parseCards('Ks 7s 3h'), vs('KhKd'))
    const b = findOuts(hand('As 2s'), parseCards('Ks 7s 3h'), vs('KhKd'))
    expect(a.outs).toEqual(b.outs)
    expect(a.byRiver).toBe(b.byRiver)
  })

  it('describes the count in words', () => {
    const result = findOuts(hand('As 2s'), parseCards('Ks 7s 3h'), vs('KhKd'))
    expect(summariseOuts(result)).toMatch(/\d+ cards put you ahead/)
  })
})
