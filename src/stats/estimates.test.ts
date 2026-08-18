import { describe, expect, it } from 'vitest'
import { byStreet, describeAccuracy, errorOf, summarise, type Estimate } from './estimates'

const guess = (guessed: number, actual: number, street = 'flop', handNumber = 1): Estimate => ({
  handNumber,
  street,
  guess: guessed,
  actual,
  boardSize: street === 'preflop' ? 0 : 3,
})

describe('measuring an estimate', () => {
  it('scores the distance from the truth, either way', () => {
    expect(errorOf(guess(50, 60))).toBe(10)
    expect(errorOf(guess(70, 60))).toBe(10)
    expect(errorOf(guess(60, 60))).toBe(0)
  })
})

describe('summarising a run of estimates', () => {
  it('reports nothing useful with nothing to report', () => {
    const summary = summarise([])
    expect(summary.count).toBe(0)
    expect(summary.meanError).toBe(0)
    expect(summary.improvement).toBeNull()
  })

  it('averages the size of the misses, not their direction', () => {
    // Twenty points out in each direction is not accuracy, and a signed
    // average would call it perfect.
    const summary = summarise([guess(70, 50), guess(30, 50)])
    expect(summary.meanError).toBe(20)
    expect(summary.bias).toBe(0)
  })

  it('separates being imprecise from being optimistic', () => {
    // Consistently high is a different fault from being scattered, and the
    // one a player can actually correct.
    const optimistic = summarise([guess(60, 50), guess(70, 60), guess(55, 45)])
    expect(optimistic.bias).toBeCloseTo(10, 6)
    expect(optimistic.meanError).toBeCloseTo(10, 6)
  })

  it('counts the guesses that were close', () => {
    const summary = summarise([guess(52, 50), guess(80, 50), guess(48, 50)])
    expect(summary.withinFive).toBeCloseTo(2 / 3, 6)
  })

  it('waits for a real sample before claiming a trend', () => {
    const few = Array.from({ length: 19 }, () => guess(50, 60))
    expect(summarise(few).improvement).toBeNull()
  })

  it('measures improvement as the later half beating the earlier one', () => {
    const early = Array.from({ length: 10 }, () => guess(50, 70)) // 20 points out
    const late = Array.from({ length: 10 }, () => guess(65, 70)) // 5 points out
    const summary = summarise([...early, ...late])

    expect(summary.improvement).toBeCloseTo(15, 6)
    expect(summary.count).toBe(20)
  })

  it('reports getting worse as a negative', () => {
    const early = Array.from({ length: 10 }, () => guess(68, 70))
    const late = Array.from({ length: 10 }, () => guess(40, 70))
    expect(summarise([...early, ...late]).improvement!).toBeLessThan(0)
  })
})

describe('breaking estimates down by street', () => {
  it('groups by the street the guess was made on', () => {
    const groups = byStreet([
      guess(50, 55, 'preflop'),
      guess(50, 70, 'preflop'),
      guess(50, 52, 'river'),
    ])

    expect(groups.get('preflop')!.count).toBe(2)
    expect(groups.get('preflop')!.meanError).toBeCloseTo(12.5, 6)
    expect(groups.get('river')!.meanError).toBeCloseTo(2, 6)
  })

  it('is empty when nothing has been guessed', () => {
    expect(byStreet([]).size).toBe(0)
  })
})

describe('putting a word to an error', () => {
  it('grades accuracy on a scale a player can read', () => {
    // A number alone tells someone nothing about whether they are good at this.
    expect(describeAccuracy(3)).toBe('sharp')
    expect(describeAccuracy(8)).toBe('solid')
    expect(describeAccuracy(15)).toBe('rough')
    expect(describeAccuracy(30)).toBe('guessing')
  })
})
