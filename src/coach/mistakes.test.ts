import { describe, expect, it } from 'vitest'
import type { GradedDecision } from './grade'
import { leaning, mistakeIn, WORTH_NAMING_BB } from './mistakes'

const at = (
  chosen: GradedDecision['chosen'],
  best: GradedDecision['best'],
  evLossBB = 1,
): GradedDecision => ({
  street: 'flop',
  toCall: 0,
  evLossBB,
  verdict: evLossBB > 2 ? 'blunder' : 'mistake',
  chosen,
  best,
})

describe('naming the kind of mistake', () => {
  it('says nothing about a decision that cost nothing', () => {
    expect(mistakeIn(at({ type: 'fold' }, { type: 'call' }, 0))).toBeNull()
    expect(mistakeIn(at({ type: 'fold' }, { type: 'call' }, WORTH_NAMING_BB / 2))).toBeNull()
  })

  it('names folding a hand that was worth playing', () => {
    expect(mistakeIn(at({ type: 'fold' }, { type: 'call' }))).toBe('folding too much')
    expect(mistakeIn(at({ type: 'fold' }, { type: 'raise', to: 10 }))).toBe('folding too much')
  })

  it('tells calling a hand worth raising from folding one worth playing', () => {
    // Both are passive, and they are different habits with different fixes.
    expect(mistakeIn(at({ type: 'call' }, { type: 'raise', to: 10 }))).toBe('not raising enough')
    expect(mistakeIn(at({ type: 'check' }, { type: 'raise', to: 10 }))).toBe('not raising enough')
  })

  it('names calling what should have been folded', () => {
    expect(mistakeIn(at({ type: 'call' }, { type: 'fold' }))).toBe('calling too much')
  })

  it('names raising what should have been called or folded', () => {
    expect(mistakeIn(at({ type: 'raise', to: 20 }, { type: 'call' }))).toBe('raising too much')
    expect(mistakeIn(at({ type: 'raise', to: 20 }, { type: 'fold' }))).toBe('raising too much')
  })

  it('calls a right action at the wrong size what it is', () => {
    expect(mistakeIn(at({ type: 'raise', to: 20 }, { type: 'raise', to: 8 }))).toBe('the wrong size')
  })

  it('does not invent a mistake where the action was the right one', () => {
    // A call graded as costing something against a *call* is the sampling
    // talking, not a different decision.
    expect(mistakeIn(at({ type: 'call' }, { type: 'call' }))).toBeNull()
    expect(mistakeIn(at({ type: 'fold' }, { type: 'fold' }))).toBeNull()
  })

  it('treats checking and calling as the same rung', () => {
    // Neither puts money in beyond what it must, so neither is "looser" than
    // the other — a check where a call was best is not a habit.
    expect(mistakeIn(at({ type: 'check' }, { type: 'call' }))).toBeNull()
    expect(mistakeIn(at({ type: 'call' }, { type: 'check' }))).toBeNull()
  })
})

describe('which way a player leans', () => {
  it('ranks habits by what they cost, not by how often they happen', () => {
    const record = [
      at({ type: 'fold' }, { type: 'call' }, 0.2),
      at({ type: 'fold' }, { type: 'call' }, 0.2),
      at({ type: 'fold' }, { type: 'call' }, 0.2),
      at({ type: 'raise', to: 30 }, { type: 'fold' }, 6),
    ]
    const [worst, next] = leaning(record)
    expect(worst!.mistake).toBe('raising too much')
    expect(worst!.count).toBe(1)
    expect(next!.mistake).toBe('folding too much')
    expect(next!.count).toBe(3)
  })

  it('adds up what each habit cost', () => {
    const found = leaning([
      at({ type: 'call' }, { type: 'fold' }, 1.5),
      at({ type: 'call' }, { type: 'fold' }, 2.5),
    ])
    expect(found).toHaveLength(1)
    expect(found[0]!.costBB).toBeCloseTo(4, 6)
    expect(found[0]!.count).toBe(2)
  })

  it('finds nothing to say about somebody who played well', () => {
    expect(leaning([at({ type: 'call' }, { type: 'call' }, 0)])).toEqual([])
    expect(leaning([])).toEqual([])
  })
})
