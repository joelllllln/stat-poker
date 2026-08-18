import { useMemo } from 'react'
import { RANKS } from '../engine/cards'
import { preflopRanking } from '../equity/preflop'

/**
 * The 169 starting hands as a grid.
 *
 * The conventional layout, and it is conventional for a reason: pairs run down
 * the diagonal, suited hands sit above it and offsuit below, so a range has a
 * recognisable shape rather than being a list of names. Watching that shape
 * shrink as an opponent acts is what teaches range thinking, which is the
 * thing a percentage on its own never does.
 */

const ORDER = [...RANKS].reverse() // aces first, as the grid is always drawn

function labelFor(row: number, column: number): string {
  const high = ORDER[Math.min(row, column)]!
  const low = ORDER[Math.max(row, column)]!
  if (row === column) return `${high}${low}`
  return row < column ? `${high}${low}s` : `${high}${low}o`
}

export function RangeGrid({
  /** Fraction of starting hands the range covers. */
  width,
  title,
  highlight,
}: {
  width: number
  title?: string
  /** A holding to mark, e.g. `AKs`. */
  highlight?: string | undefined
}) {
  // The range is the top slice of the same ranking the rest of the app uses,
  // so what the grid shows and what the maths used cannot drift apart.
  const included = useMemo(() => {
    const combosFor = (hand: string) => (hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12)
    const target = width * 1326
    const chosen = new Set<string>()
    let total = 0
    for (const row of preflopRanking()) {
      if (total >= target) break
      chosen.add(row.hand)
      total += combosFor(row.hand)
    }
    return chosen
  }, [width])

  return (
    <div className="space-y-1">
      {title && (
        <div className="flex items-baseline justify-between text-[11px]">
          <span className="uppercase tracking-wide text-slate-500">{title}</span>
          <span className="font-mono text-slate-400">top {(width * 100).toFixed(0)}%</span>
        </div>
      )}
      <div className="grid grid-cols-13 gap-px" style={{ gridTemplateColumns: 'repeat(13, 1fr)' }}>
        {ORDER.map((_, row) =>
          ORDER.map((__, column) => {
            const hand = labelFor(row, column)
            const inRange = included.has(hand)
            const isHighlight = highlight === hand
            return (
              <div
                key={hand}
                title={hand}
                className={`aspect-square text-[6px] leading-none flex items-center justify-center rounded-[1px] ${
                  isHighlight
                    ? 'bg-amber-400 text-slate-900 font-bold'
                    : inRange
                      ? 'bg-emerald-700/80 text-emerald-50'
                      : 'bg-slate-800/60 text-slate-600'
                }`}
              >
                {hand.slice(0, 2)}
              </div>
            )
          }),
        )}
      </div>
    </div>
  )
}
