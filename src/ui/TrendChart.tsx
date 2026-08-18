import { useMemo, useState } from 'react'

/**
 * One metric, block of hands by block of hands.
 *
 * Drawn as small multiples rather than as several series on one axis: VPIP is a
 * percentage, aggression is a ratio and winrate is chips, and putting them on a
 * shared scale — or on two y-axes — would let any of them be drawn at any size.
 * Each panel is a single series, so it needs no legend; the title names it and
 * the last value is labelled where the line ends.
 */

const LINE = '#3987e5'
const BAND = '#d95926'

export interface Series {
  label: string
  /** One value per block, oldest first. Gaps are blocks with nothing to say. */
  values: (number | null)[]
  format: (value: number) => string
  /**
   * Where "better" lies, for the one-line reading under the panel.
   *
   * Some of these have no better: playing more hands is neither good nor bad.
   */
  better?: 'higher' | 'lower'
}

const WIDTH = 240
const HEIGHT = 74
const PADDING = { top: 10, right: 12, bottom: 12, left: 10 }

function Panel({ series, blockSize }: { series: Series; blockSize: number }) {
  const [hover, setHover] = useState<number | null>(null)

  const points = useMemo(
    () =>
      series.values
        .map((value, i) => ({ value, i }))
        .filter((point): point is { value: number; i: number } => point.value !== null),
    [series.values],
  )

  const geometry = useMemo(() => {
    const values = points.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = Math.max(max - min, Math.abs(max) * 0.05, 0.5)
    const plotWidth = WIDTH - PADDING.left - PADDING.right
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom
    const count = series.values.length

    const x = (i: number) =>
      PADDING.left + (count <= 1 ? plotWidth / 2 : (i / (count - 1)) * plotWidth)
    const y = (value: number) =>
      PADDING.top + plotHeight - ((value - min) / span) * plotHeight

    return { x, y, min, max }
  }, [points, series.values.length])

  if (points.length < 2) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">{series.label}</div>
        <div className="flex h-[74px] items-center text-[11px] text-slate-600">
          Not enough blocks yet.
        </div>
      </div>
    )
  }

  const last = points[points.length - 1]!
  const first = points[0]!
  const path = points
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${geometry.x(point.i)},${geometry.y(point.value)}`)
    .join(' ')
  const shown = hover === null ? last : (points.find((point) => point.i === hover) ?? last)
  const direction =
    series.better === undefined
      ? null
      : (last.value - first.value) * (series.better === 'higher' ? 1 : -1)

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">{series.label}</span>
        <span className="font-mono text-sm text-slate-200">{series.format(shown.value)}</span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`${series.label} across blocks of ${blockSize} hands`}
        onMouseLeave={() => setHover(null)}
      >
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={geometry.y(geometry.min)}
          y2={geometry.y(geometry.min)}
          stroke="#1e293b"
          strokeWidth={1}
        />
        <path d={path} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={geometry.x(shown.i)} cy={geometry.y(shown.value)} r={4} fill={LINE} />

        {/* Hit targets are far bigger than the marks, so a two-pixel line is
            still something a person can point at. */}
        {points.map((point) => (
          <rect
            key={point.i}
            x={geometry.x(point.i) - 6}
            y={0}
            width={12}
            height={HEIGHT}
            fill="transparent"
            onMouseEnter={() => setHover(point.i)}
          />
        ))}
      </svg>

      <div className="text-[10px] text-slate-500">
        {hover === null ? (
          direction === null || Math.abs(direction) < 1e-9 ? (
            <>
              hands {shown.i * blockSize + 1}–{(shown.i + 1) * blockSize}
            </>
          ) : (
            <span style={{ color: direction > 0 ? LINE : BAND }}>
              {direction > 0 ? 'moving the right way' : 'moving the wrong way'} since your first
              block
            </span>
          )
        ) : (
          <>
            hands {shown.i * blockSize + 1}–{(shown.i + 1) * blockSize}
          </>
        )}
      </div>
    </div>
  )
}

export function TrendChart({
  series,
  blockSize,
}: {
  series: Series[]
  blockSize: number
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {series.map((one) => (
        <Panel key={one.label} series={one} blockSize={blockSize} />
      ))}
    </div>
  )
}
