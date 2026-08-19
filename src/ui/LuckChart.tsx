import { useMemo, useState } from 'react'

/**
 * Actual result against all-in adjusted result, cumulative.
 *
 * The gap between the two lines is the whole point of the chart: it is the part
 * of the result the deck decided rather than the player. Both series are on one
 * axis in the same unit, which is the only honest way to show them — a second
 * y-scale would let the gap be drawn at any size.
 */

/*
 * Two lines in the room's own colours: bone for what happened, brass for what
 * the hands were worth. They sit on opposite sides of the ground's warmth
 * rather than being a blue and an orange borrowed from a dashboard, and both
 * are direct-labelled at the end of the line, so neither depends on hue alone.
 */
const SERIES = {
  actual: { colour: '#ede6d6', label: 'Actual' },
  adjusted: { colour: '#c9a227', label: 'All-in adjusted' },
}

const WIDTH = 720
const HEIGHT = 200
const PADDING = { top: 12, right: 96, bottom: 22, left: 44 }

interface Props {
  actual: number[]
  adjusted: number[]
}

export function LuckChart({ actual, adjusted }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  const geometry = useMemo(() => {
    const n = actual.length
    const values = [...actual, ...adjusted, 0]
    const min = Math.min(...values)
    const max = Math.max(...values)
    // Keep zero on the chart and never collapse to a zero-height band.
    const span = Math.max(max - min, 1)
    const pad = span * 0.1

    const plotWidth = WIDTH - PADDING.left - PADDING.right
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom

    const x = (i: number) => PADDING.left + (n <= 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth)
    const y = (value: number) =>
      PADDING.top + plotHeight - ((value - (min - pad)) / (span + pad * 2)) * plotHeight

    const path = (series: number[]) =>
      series.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(value)}`).join(' ')

    return { x, y, path, min: min - pad, max: max + pad, plotHeight }
  }, [actual, adjusted])

  if (actual.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-slate-800 text-xs text-slate-600">
        Play a few hands to see the curve.
      </div>
    )
  }

  const last = actual.length - 1
  const ticks = [geometry.max, 0, geometry.min].filter(
    (value, i, all) => all.indexOf(value) === i,
  )

  const MIN_LABEL_GAP = 11
  const labels = [
    { text: 'Actual', colour: SERIES.actual.colour, y: geometry.y(actual[last]!) + 3 },
    { text: 'Adjusted', colour: SERIES.adjusted.colour, y: geometry.y(adjusted[last]!) + 3 },
  ].sort((a, b) => a.y - b.y)
  if (labels[1]!.y - labels[0]!.y < MIN_LABEL_GAP) {
    const middle = (labels[0]!.y + labels[1]!.y) / 2
    labels[0]!.y = middle - MIN_LABEL_GAP / 2
    labels[1]!.y = middle + MIN_LABEL_GAP / 2
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Cumulative winnings, actual against all-in adjusted"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          const ratio = ((event.clientX - box.left) / box.width) * WIDTH
          const plot = WIDTH - PADDING.left - PADDING.right
          const index = Math.round(((ratio - PADDING.left) / plot) * last)
          setHover(Math.max(0, Math.min(last, index)))
        }}
      >
        {/* Recessive gridlines; zero is the one that carries meaning. */}
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={geometry.y(value)}
              y2={geometry.y(value)}
              stroke={value === 0 ? '#4a4034' : '#241f18'}
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 6}
              y={geometry.y(value) + 3}
              textAnchor="end"
              className="fill-slate-500"
              style={{ fontSize: 9, fontFamily: 'ui-monospace, monospace' }}
            >
              {value.toFixed(0)}
            </text>
          </g>
        ))}

        <path d={geometry.path(adjusted)} fill="none" stroke={SERIES.adjusted.colour} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <path d={geometry.path(actual)} fill="none" stroke={SERIES.actual.colour} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {/* Direct labels: identity is never carried by colour alone. The two
            lines end close together whenever the deck has been fair, which is
            most of the time, so the labels are pushed apart when they would
            otherwise overprint each other. */}
        {labels.map((label) => (
          <text
            key={label.text}
            x={WIDTH - PADDING.right + 8}
            y={label.y}
            style={{ fontSize: 10 }}
            fill={label.colour}
          >
            {label.text}
          </text>
        ))}

        {hover !== null && (
          <g>
            <line
              x1={geometry.x(hover)}
              x2={geometry.x(hover)}
              y1={PADDING.top}
              y2={HEIGHT - PADDING.bottom}
              stroke="#4a4034"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            {/* A 2px surface ring keeps the markers legible where lines cross. */}
            <circle cx={geometry.x(hover)} cy={geometry.y(adjusted[hover]!)} r={4} fill={SERIES.adjusted.colour} stroke="#0e0c0a" strokeWidth={2} />
            <circle cx={geometry.x(hover)} cy={geometry.y(actual[hover]!)} r={4} fill={SERIES.actual.colour} stroke="#0e0c0a" strokeWidth={2} />
          </g>
        )}

        <text
          x={PADDING.left}
          y={HEIGHT - 6}
          className="fill-slate-500"
          style={{ fontSize: 9 }}
        >
          hand 1
        </text>
        <text
          x={WIDTH - PADDING.right}
          y={HEIGHT - 6}
          textAnchor="end"
          className="fill-slate-500"
          style={{ fontSize: 9 }}
        >
          hand {actual.length}
        </text>
      </svg>

      <div className="flex items-center justify-between px-1 pt-1 text-[11px]">
        <div className="flex gap-3">
          {Object.values(SERIES).map((series) => (
            <span key={series.label} className="flex items-center gap-1 text-slate-400">
              <span
                className="inline-block h-0.5 w-3 rounded"
                style={{ background: series.colour }}
              />
              {series.label}
            </span>
          ))}
        </div>
        {hover !== null && (
          <span className="font-mono text-slate-400">
            hand {hover + 1}: {actual[hover]!.toFixed(1)}bb vs {adjusted[hover]!.toFixed(1)}bb
          </span>
        )}
      </div>
    </div>
  )
}
