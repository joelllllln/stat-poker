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
export function StreetChart({ points, height = 84 }: { points: StreetPoint[]; height?: number }) {
  if (points.length === 0) return null

  const width = 300
  const gap = 6
  const slot = width / points.length
  const centre = (i: number) => i * slot + slot / 2

  // The columns own the bottom third, the line the top two thirds, with a
  // little air between them.
  const floor = height
  const columnTop = height * 0.62
  const lineTop = 8
  const lineFloor = height * 0.52
  const tallest = Math.max(...points.map((p) => p.chips), 1)
  const y = (equity: number) =>
    lineTop + (1 - Math.max(0, Math.min(1, equity))) * (lineFloor - lineTop)

  const path = points
    .map((point, i) => `${i === 0 ? 'M' : 'L'} ${centre(i)} ${y(point.equity)}`)
    .join(' ')
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
      {/* Half. An equity line with no reference is a wiggle, and "ahead or
          behind" is the whole question it answers. */}
      <line
        x1={0}
        x2={width}
        y1={y(0.5)}
        y2={y(0.5)}
        stroke="var(--color-ink-4)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />

      {points.map((point, i) => {
        const tall = Math.max(2, (point.chips / tallest) * (floor - columnTop))
        return (
          <rect
            key={point.label}
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
          d={path}
          fill="none"
          stroke="var(--chart-cool)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle
        cx={centre(points.length - 1)}
        cy={y(last.equity)}
        r={4}
        fill="var(--chart-cool)"
        stroke="var(--color-ink-2)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
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
  return (
    <div className="plate min-w-0 flex-1 px-3 py-2">
      <div className="stamp">{label}</div>
      <div className={`figure text-2xl ${colour}`}>{value}</div>
    </div>
  )
}
