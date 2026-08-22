/**
 * The small figures the panels are drawn from.
 *
 * Four shapes, built to one spec so they read as one system wherever they
 * appear: a stacked bar for a whole split into parts, a meter for one share
 * against a limit, a line for something over the streets, and columns for a
 * quantity per street.
 *
 * The rules they all keep, because they are what make a chart quiet:
 * separation is a gap in the surface colour rather than a border, marks have
 * a rounded end and a square baseline, lines are two pixels with round caps,
 * end markers carry a ring in the surface colour so they stay legible where
 * they cross something, and text never wears the data colour — a swatch
 * beside a label carries the identity instead.
 */

import { dialArc } from './dial'

/** The gap that separates touching marks, in pixels. */
const GAP = 2

export interface Part {
  key: string
  /** Share of the whole, 0–1. */
  share: number
  /** A chart step, not an interface colour. */
  colour: string
  label: string
}

/**
 * A whole, split into its parts.
 *
 * Segments are separated by a gap in the surface rather than by a stroke: a
 * border adds ink that is not data, and at these sizes it is most of the mark.
 */
export function StackedBar({ parts, height = 20 }: { parts: Part[]; height?: number }) {
  const shown = parts.filter((part) => part.share > 0.005)
  return (
    <div className="flex overflow-hidden rounded-md bg-black/50" style={{ height, gap: GAP }}>
      {shown.map((part) => (
        <div
          key={part.key}
          className="h-full first:rounded-l-md last:rounded-r-md"
          style={{ width: `${part.share * 100}%`, background: part.colour }}
          title={`${part.label} ${Math.round(part.share * 100)}%`}
        />
      ))}
    </div>
  )
}

/** A swatch and a label. Identity comes from the mark, never from the text. */
export function Key({ colour, children }: { colour: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--color-bone-dim)]">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ background: colour }}
      />
      {children}
    </span>
  )
}

/**
 * One share against the limit it has to clear.
 *
 * A meter rather than a chart: one track, one fill, and a rule where the limit
 * sits. The fill's colour is the answer, and the labels under it say the same
 * thing in words so the answer is never carried by hue alone.
 */
export function Meter({
  share,
  limit,
  clears,
}: {
  share: number
  limit: number
  clears: boolean
}) {
  return (
    <div className="relative h-6 overflow-hidden rounded-md bg-black/50">
      <div
        className="h-full rounded-r-md"
        style={{
          width: `${Math.max(2, Math.min(100, share * 100))}%`,
          background: clears ? 'var(--chart-lead)' : 'var(--chart-behind)',
        }}
      />
      {limit > 0 && (
        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-[color:var(--color-brass-bright)]"
          style={{ left: `${Math.min(99, limit * 100)}%` }}
        />
      )}
    </div>
  )
}

export interface Point {
  label: string
  /** 0–1. */
  value: number
}

export interface StreetPoint {
  label: string
  /** Share of the pot this hand was worth here, 0–1. */
  equity: number
  /** Chips in by the time this decision was made. */
  chips: number
}

/**
 * How a hand went, street by street.
 *
 * Two measures of different scales, so never two scales on one axis: the
 * columns are what was in, the line is what it was worth, and they are drawn
 * in one coordinate system so a street is in the same place in both. Read
 * apart they are two charts; read together they are the shape of the hand —
 * a line falling while the columns climb is the hand everybody loses money on.
 */
export function StreetChart({ points, height = 132 }: { points: StreetPoint[]; height?: number }) {
  if (points.length === 0) return null

  const width = 300
  const gap = 8
  const slot = width / points.length
  const centre = (i: number) => i * slot + slot / 2

  const floor = height - 2
  const columnTop = height * 0.66
  const lineTop = 12
  const lineFloor = height * 0.56
  const tallest = Math.max(...points.map((p) => p.chips), 1)
  const y = (equity: number) =>
    lineTop + (1 - Math.max(0, Math.min(1, equity))) * (lineFloor - lineTop)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${centre(i)} ${y(p.equity)}`).join(' ')
  // Closed down to the halfway rule rather than to the floor, so the wash
  // reads as "ahead of half" instead of as "above nothing".
  const wash = `${line} L ${centre(points.length - 1)} ${y(0.5)} L ${centre(0)} ${y(0.5)} Z`
  const last = points[points.length - 1]!

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={points
        .map((p) => `${p.label}: worth ${Math.round(p.equity * 100)}%, ${p.chips} chips in`)
        .join('; ')}
    >
      {points.length > 1 && <path d={wash} fill="var(--chart-cool)" opacity={0.14} stroke="none" />}

      <line
        x1={0}
        x2={width}
        y1={y(0.5)}
        y2={y(0.5)}
        stroke="var(--color-ink-4)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <text x={2} y={y(0.5) - 4} fill="var(--color-bone-faint)" fontSize={9} letterSpacing={0.6}>
        HALF
      </text>

      {points.map((point, i) => {
        const tall = Math.max(3, (point.chips / tallest) * (floor - columnTop))
        return (
          <rect
            key={`bar-${point.label}-${i}`}
            x={centre(i) - (slot - gap) / 2}
            y={floor - tall}
            width={slot - gap}
            height={tall}
            rx={3}
            fill="var(--chart-gold)"
          />
        )
      })}

      {points.length > 1 && (
        <path
          d={line}
          fill="none"
          stroke="var(--chart-cool)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Every decision marked, only the last one labelled: a number on every
          point is chaos, and the end is where the hand finished. */}
      {points.map((point, i) => (
        <circle
          key={`dot-${point.label}-${i}`}
          cx={centre(i)}
          cy={y(point.equity)}
          r={i === points.length - 1 ? 4.5 : 3}
          fill="var(--chart-cool)"
          stroke="var(--color-ink-2)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <text
        x={centre(points.length - 1) - 8}
        y={y(last.equity) - 8}
        fill="var(--color-bone)"
        fontSize={12}
        textAnchor="end"
      >
        {Math.round(last.equity * 100)}%
      </text>
    </svg>
  )
}

/**
 * The street names under the chart, in the same slots the marks used.
 *
 * Named once each. Two decisions on the same street are two marks but one
 * street, and an axis reading "pre pre flop" is describing the data structure
 * rather than the hand.
 */
export function StreetAxis({ points }: { points: { label: string }[] }) {
  return (
    <div className="flex text-[10px] uppercase tracking-wide text-[color:var(--color-bone-faint)]">
      {points.map((point, i) => (
        <span key={`${point.label}-${i}`} className="flex-1 text-center">
          {i === 0 || points[i - 1]!.label !== point.label ? point.label : ''}
        </span>
      ))}
    </div>
  )
}

/**
 * A number with a label, for a fact that is not part of anything.
 *
 * Two figures side by side rather than one bar in two colours: a stacked bar
 * is a promise that the parts add up to the whole, and where they do not it
 * is a lie told in a shape people trust.
 */
export function Figure({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: string
  tone?: 'plain' | 'good' | 'bad' | 'mark'
}) {
  const colour =
    tone === 'good'
      ? 'text-[color:var(--color-jade-bright)]'
      : tone === 'bad'
        ? 'text-[color:var(--color-oxblood-bright)]'
        : tone === 'mark'
          ? 'text-[color:var(--color-brass-bright)]'
          : 'text-[color:var(--color-bone)]'
  // A minimum width, and the row it sits in is allowed to wrap: three of
  // these across a 320-pixel screen leaves sixty-four pixels each, which no
  // figure fits in. Two rows of readable numbers beat one row of clipped ones.
  return (
    <div className="plate min-w-[6.5rem] flex-1 px-2 py-2 xs:px-3">
      <div className="stamp truncate">{label}</div>
      {/* Sized to the box rather than to a guess: three of these side by side
          on a 390-pixel phone leave about ninety pixels each, and a
          seven-character figure at 24px is wider than that. */}
      <div className={`figure text-xl leading-tight xs:text-2xl ${colour}`}>{value}</div>
    </div>
  )
}

/**
 * Big blinds, at a length that fits where it has to fit.
 *
 * A tenth of a big blind matters at four and is noise at four hundred, so the
 * decimal is dropped once it stops carrying anything — which is also the point
 * at which the figure stops fitting beside two others on a phone.
 */
export function inBB(value: number, { sign = false }: { sign?: boolean } = {}): string {
  const size = Math.abs(value)
  const digits = size >= 100 ? 0 : 1
  const lead = value < 0 ? '−' : sign ? '+' : ''
  return `${lead}${size.toFixed(digits)}bb`
}

/**
 * One share, against the share the price is asking for.
 *
 * A dial rather than a fourth horizontal bar. Everything on this panel was a
 * bar — the share, the split, the ranking — and four bars stacked read as one
 * texture: nothing is recognisable, so nothing is read. A dial is the shape
 * you can pick out of the page without looking at it, which is what the one
 * number the decision turns on has to be.
 *
 * The fill is the answer, the tick is the price. Where the fill passes the
 * tick, calling is making money.
 */
export function Dial({
  share,
  limit,
  caption,
  children,
}: {
  share: number
  /** The share that breaks even, 0 when there is nothing to call. */
  limit: number
  caption?: string
  /** What sits in the middle of the dial. */
  children: React.ReactNode
}) {
  const value = Math.max(0, Math.min(1, share))
  // Green means "this clears the price". With nothing to call there is no
  // price, so there is nothing to clear, and painting it green tells a 35%
  // hand it is doing well.
  const priced = limit > 0
  const clears = priced && value >= limit
  const width = 200
  const height = 116
  const cx = width / 2
  const cy = 100
  const r = 78
  const thickness = 14

  const arc = (fraction: number) => dialArc(cx, cy, r, fraction)

  const tickAngle = Math.PI * (1 - Math.min(1, Math.max(0, limit)))
  const inner = r - thickness / 2 - 3
  const outer = r + thickness / 2 + 3

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-hidden>
        <path
          d={arc(1)}
          fill="none"
          stroke="rgba(0,0,0,.55)"
          strokeWidth={thickness}
          strokeLinecap="round"
        />
        <path
          d={arc(Math.max(0.012, value))}
          fill="none"
          stroke={
            !priced ? 'var(--chart-cool)' : clears ? 'var(--chart-lead)' : 'var(--chart-behind)'
          }
          strokeWidth={thickness}
          strokeLinecap="round"
        />
        {limit > 0 && (
          <line
            x1={cx + inner * Math.cos(tickAngle)}
            y1={cy - inner * Math.sin(tickAngle)}
            x2={cx + outer * Math.cos(tickAngle)}
            y2={cy - outer * Math.sin(tickAngle)}
            stroke="var(--color-brass-bright)"
            strokeWidth={3}
            strokeLinecap="round"
          />
        )}
      </svg>
      {/* The figure sits in the bowl of the dial rather than beside it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
        {children}
        {caption && (
          <span className="text-[11px] text-[color:var(--color-bone-faint)]">{caption}</span>
        )}
      </div>
    </div>
  )
}

export interface Ranked {
  label: string
  share: number
}

/**
 * A short list of parts, each with its own bar, biggest first.
 *
 * What beats you is a list of answers, not a single quantity, and a stacked
 * bar makes the small ones unreadable exactly where they matter — a set at 3%
 * is a sliver you cannot see and the reason you are folding. Ranked rows give
 * every part its own baseline and its own label.
 */
export function RankedBars({
  rows,
  colour = 'var(--chart-behind)',
  max,
  format = (share) => `${Math.round(share * 100)}%`,
}: {
  rows: Ranked[]
  colour?: string
  max?: number
  /** How to read the value. A share is a percentage; chips are not. */
  format?: (value: number) => string
}) {
  if (rows.length === 0) return null
  const top = max ?? Math.max(...rows.map((row) => row.share), 0.01)
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <span className="w-24 shrink-0 truncate text-[11px] text-[color:var(--color-bone-dim)]">
            {row.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-black/50">
            <div
              className="h-full rounded-r-sm"
              style={{ width: `${Math.max(2, (row.share / top) * 100)}%`, background: colour }}
            />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-[11px] text-[color:var(--color-bone-dim)]">
            {format(row.share)}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * How each decision in a hand was graded, as a strip.
 *
 * One block per decision, in the order they were made, coloured by verdict and
 * sized by what it cost. A hand that went wrong once late looks different from
 * one that leaked all the way through, and the shape says which before any
 * number is read.
 */
export function DecisionStrip({
  decisions,
}: {
  decisions: { label: string; tone: string; cost: number }[]
}) {
  if (decisions.length === 0) return null
  return (
    <div className="flex gap-1">
      {decisions.map((decision, i) => (
        <div key={`${decision.label}-${i}`} className="min-w-0 flex-1">
          <div
            className="h-2.5 rounded-sm"
            style={{ background: decision.tone }}
            title={`${decision.label}: ${decision.cost.toFixed(1)}bb`}
          />
          {/* Named once each, like the axis above it: two decisions on one
              street are two marks but one street. */}
          <div className="mt-1 truncate text-center text-[10px] uppercase tracking-wide text-[color:var(--color-bone-faint)]">
            {i === 0 || decisions[i - 1]!.label !== decision.label ? decision.label : ''}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface Signed {
  label: string
  /** Positive or negative, in whatever unit the caller formats. */
  value: number
  /** How many observations sit behind it, where that matters. */
  note?: string
}

/**
 * Values that can go either way, drawn from a line down the middle.
 *
 * Money is not a magnitude — losing eight big blinds from the small blind and
 * winning eight from the button are opposite facts, and a bar chart anchored
 * at the left draws them the same length in the same direction. The zero line
 * is the whole point of the shape: which side of it a row sits on is the
 * answer, and the length is only how much.
 */
export function SignedBars({
  rows,
  format,
  faint,
}: {
  rows: Signed[]
  format: (value: number) => string
  /** Rows to draw quietly, where the sample behind them is too thin to trust. */
  faint?: (row: Signed) => boolean
}) {
  if (rows.length === 0) return null
  const widest = Math.max(...rows.map((row) => Math.abs(row.value)), 1e-9)

  return (
    <div className="space-y-1">
      {rows.map((row) => {
        const share = Math.abs(row.value) / widest
        const up = row.value >= 0
        const quiet = faint?.(row) ?? false
        return (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-10 shrink-0 truncate text-[11px] text-[color:var(--color-bone-dim)]">
              {row.label}
            </span>
            <div className="relative h-3 flex-1">
              {/* The line the answer is read against. */}
              <div
                aria-hidden
                className="absolute inset-y-0 left-1/2 w-px bg-[color:var(--color-ink-4)]"
              />
              <div
                className={`absolute top-0 h-full ${up ? 'left-1/2 rounded-r-sm' : 'right-1/2 rounded-l-sm'}`}
                style={{
                  width: `${Math.max(1, share * 50)}%`,
                  background: up ? 'var(--chart-lead)' : 'var(--chart-behind)',
                  opacity: quiet ? 0.4 : 1,
                }}
              />
            </div>
            <span
              className={`w-14 shrink-0 text-right font-mono text-[11px] ${
                quiet ? 'text-[color:var(--color-bone-faint)]' : 'text-[color:var(--color-bone-dim)]'
              }`}
            >
              {format(row.value)}
            </span>
            {row.note && (
              <span className="w-10 shrink-0 text-right text-[10px] text-[color:var(--color-bone-faint)]">
                {row.note}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
