import { describe, expect, it } from 'vitest'
import { dialArc, dialPoint } from './dial'

/**
 * The dial shipped drawing every value above half the wrong way round, and
 * nothing caught it: it renders correctly below half, and every screenshot
 * taken of it happened to be of a hand that was behind. An arc is four
 * numbers and two flags — wrong flags do not throw, do not warn, and look
 * fine right up until the value crosses the point where the flag changes.
 */

const CX = 100
const CY = 100
const R = 78

/** Pull the `A` command's arguments back out of the path. */
function arcArgs(path: string) {
  const found = /A ([\d.-]+) ([\d.-]+) ([\d.-]+) ([01]) ([01]) ([\d.-]+) ([\d.-]+)/.exec(path)
  if (!found) throw new Error(`no arc in ${path}`)
  return {
    rx: Number(found[1]),
    ry: Number(found[2]),
    largeArc: Number(found[4]),
    sweep: Number(found[5]),
    x: Number(found[6]),
    y: Number(found[7]),
  }
}

describe('where a fraction lands on the dial', () => {
  it('starts due west and ends due east', () => {
    expect(dialPoint(CX, CY, R, 0).x).toBeCloseTo(CX - R, 6)
    expect(dialPoint(CX, CY, R, 0).y).toBeCloseTo(CY, 6)
    expect(dialPoint(CX, CY, R, 1).x).toBeCloseTo(CX + R, 6)
    expect(dialPoint(CX, CY, R, 1).y).toBeCloseTo(CY, 6)
  })

  it('puts a half straight up', () => {
    const top = dialPoint(CX, CY, R, 0.5)
    expect(top.x).toBeCloseTo(CX, 6)
    expect(top.y).toBeCloseTo(CY - R, 6)
  })

  it('never dips below the middle', () => {
    for (let f = 0; f <= 1; f += 0.05) {
      expect(dialPoint(CX, CY, R, f).y).toBeLessThanOrEqual(CY + 1e-9)
    }
  })

  it('stays on the circle', () => {
    for (let f = 0; f <= 1; f += 0.05) {
      const point = dialPoint(CX, CY, R, f)
      expect(Math.hypot(point.x - CX, point.y - CY)).toBeCloseTo(R, 6)
    }
  })

  it('clamps rather than wrapping round', () => {
    expect(dialPoint(CX, CY, R, -3)).toEqual(dialPoint(CX, CY, R, 0))
    expect(dialPoint(CX, CY, R, 4)).toEqual(dialPoint(CX, CY, R, 1))
  })

  it('runs left to right without going back on itself', () => {
    let previous = -Infinity
    for (let f = 0; f <= 1; f += 0.05) {
      const { x } = dialPoint(CX, CY, R, f)
      expect(x).toBeGreaterThan(previous)
      previous = x
    }
  })
})

describe('the arc drawn to that point', () => {
  it('takes the short way round at every value', () => {
    // The dial spans half a turn at most, so every arc on it is the short
    // way. Setting the flag from the fraction — which is what shipped — draws
    // the complement instead, and the dial comes apart above 50%.
    for (let f = 0; f <= 1; f += 0.05) {
      expect(arcArgs(dialArc(CX, CY, R, f)).largeArc, `at ${f.toFixed(2)}`).toBe(0)
    }
  })

  it('sweeps over the top rather than under the bottom', () => {
    for (let f = 0.1; f <= 1; f += 0.1) {
      expect(arcArgs(dialArc(CX, CY, R, f)).sweep).toBe(1)
    }
  })

  it('begins at the left of the dial whatever the value', () => {
    for (const f of [0.1, 0.5, 0.8, 1]) {
      // Compared as numbers: cos(pi) is not exactly -1, so the path carries a
      // float and a string match would be testing the arithmetic of the
      // machine rather than where the arc starts.
      const move = /^M ([\d.-]+) ([\d.-]+)/.exec(dialArc(CX, CY, R, f))!
      expect(Number(move[1]), `at ${f}`).toBeCloseTo(CX - R, 6)
      expect(Number(move[2]), `at ${f}`).toBeCloseTo(CY, 6)
    }
  })

  it('ends where the fraction says it should', () => {
    for (const f of [0.15, 0.5, 0.69, 0.8, 1]) {
      const end = dialPoint(CX, CY, R, f)
      const drawn = arcArgs(dialArc(CX, CY, R, f))
      expect(drawn.x).toBeCloseTo(end.x, 6)
      expect(drawn.y).toBeCloseTo(end.y, 6)
    }
  })

  it('is a circle, not an ellipse', () => {
    const drawn = arcArgs(dialArc(CX, CY, R, 0.7))
    expect(drawn.rx).toBe(R)
    expect(drawn.ry).toBe(R)
  })
})
