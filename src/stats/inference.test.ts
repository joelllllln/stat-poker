import { describe, expect, it } from 'vitest'
import { Rng } from '../engine/cards'
import { compare, compareMeans, compareProportions, holm, tCritical } from './inference'

describe("Student's t", () => {
  it('matches the published critical values', () => {
    expect(tCritical(10)).toBeCloseTo(2.228, 2)
    expect(tCritical(30)).toBeCloseTo(2.042, 2)
    expect(tCritical(120)).toBeCloseTo(1.98, 2)
    // And approaches the normal value from above, never below it.
    expect(tCritical(10_000)).toBeGreaterThan(1.959)
    expect(tCritical(10_000)).toBeLessThan(1.97)
  })
})

describe('comparing two rates', () => {
  it('will not call two hands against two a change', () => {
    // Folded both, then played both. It looks like a total change of style and
    // it is four hands: one split in six falls this way by chance.
    const change = compareProportions(0, 2, 2, 2)
    expect(change.change).toBeGreaterThan(0)
    expect(change.real).toBe(false)
  })

  it('calls the same gap real once there are enough hands', () => {
    expect(compareProportions(0, 30, 30, 30).real).toBe(true)
  })

  it('holds its nerve when a rate sits at zero', () => {
    // The textbook interval has zero width here and claims certainty.
    expect(compareProportions(0, 12, 1, 12).real).toBe(false)
  })
})

describe('comparing two means', () => {
  it('will not call two hands against two a change', () => {
    expect(compareMeans([0, 0], [2, 2]).real).toBe(false)
  })

  it('calls a flat difference over thirty hands each real', () => {
    const before = Array.from({ length: 30 }, () => 0)
    const after = Array.from({ length: 30 }, () => 2)
    const change = compareMeans(before, after)
    expect(change.real).toBe(true)
    expect(change.change).toBeCloseTo(2, 6)
  })

  it('is not fooled by halves that alternate', () => {
    const values = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0 : 2))
    expect(compareMeans(values.slice(0, 30), values.slice(30)).real).toBe(false)
  })

  /**
   * The test that makes the rest of them worth anything.
   *
   * Two halves drawn from the same player, playing the same way, on results
   * shaped the way poker results are shaped: mostly small losses with the
   * occasional pot that dwarfs them. A trend must be announced no more often
   * than the confidence claims — one time in twenty.
   */
  it('announces a trend from nothing no more than one time in twenty', () => {
    const rng = new Rng(2024)
    // Blinds lost most hands, a small pot sometimes, a huge one rarely.
    const hand = () => {
      const roll = rng.nextFloat()
      if (roll < 0.75) return -1
      if (roll < 0.97) return 4
      return 60
    }

    let claimed = 0
    const TRIALS = 200
    for (let trial = 0; trial < TRIALS; trial++) {
      const before = Array.from({ length: 40 }, hand)
      const after = Array.from({ length: 40 }, hand)
      if (compareMeans(before, after).real) claimed++
    }
    expect(claimed / TRIALS).toBeLessThanOrEqual(0.05)
  })

  it('does the same for rates', () => {
    const rng = new Rng(99)
    let claimed = 0
    const TRIALS = 200
    for (let trial = 0; trial < TRIALS; trial++) {
      const played = () => (rng.nextFloat() < 0.24 ? 1 : 0)
      const before = Array.from({ length: 40 }, played)
      const after = Array.from({ length: 40 }, played)
      if (compare(before, after).real) claimed++
    }
    expect(claimed / TRIALS).toBeLessThanOrEqual(0.05)
  })

  it('still finds a change that is really there', () => {
    const rng = new Rng(7)
    const before = Array.from({ length: 120 }, () => (rng.nextFloat() < 0.2 ? 1 : 0))
    const after = Array.from({ length: 120 }, () => (rng.nextFloat() < 0.5 ? 1 : 0))
    expect(compare(before, after).real).toBe(true)
  })
})

describe('asking several questions at once', () => {
  it('keeps the most surprising answer and drops the rest', () => {
    expect(holm([0.001, 0.04])).toEqual([true, true])
    expect(holm([0.03, 0.04])).toEqual([false, false])
    // One clear finding survives being asked alongside four other questions.
    expect(holm([0.0001, 0.3, 0.4, 0.5, 0.6])[0]).toBe(true)
    expect(holm([0.02, 0.03, 0.04, 0.05, 0.06]).some(Boolean)).toBe(false)
  })
})
