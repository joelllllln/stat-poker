import { useMemo, useState } from 'react'
import {
  gradeHand,
  replayHand,
  summariseGrades,
  type DecisionGrade,
  type HandGrade,
  type Verdict,
} from '../coach/grade'
import { pricedHand } from '../stats/all-in-adjusted'
import type { HandRecord } from '../game/session'
import { DecisionStrip, Figure, Key, StreetAxis, StreetChart } from './Figures'
import { SolveRiver } from './SolveRiver'
import { Spread } from './Spread'
import { blindPosted, madeHandInWords } from './plain'
import { useStore } from './store'

const VERDICT_STYLE: Record<Verdict, { label: string; chip: string; bar: string }> = {
  optimal: { label: 'Optimal', chip: 'bg-[color:var(--color-jade-deep)] text-[color:var(--color-jade-bright)]', bar: 'bg-[color:var(--color-jade)]' },
  fine: { label: 'Fine', chip: 'bg-[color:var(--color-royal-deep)] text-[color:var(--color-royal-bright)]', bar: 'bg-[color:var(--color-royal)]' },
  mistake: { label: 'Mistake', chip: 'bg-[color:var(--color-brass-deep)]/50 text-[color:var(--color-brass-bright)]', bar: 'bg-[color:var(--color-brass)]' },
  blunder: { label: 'Blunder', chip: 'bg-[color:var(--color-oxblood-deep)] text-[color:var(--color-oxblood-bright)]', bar: 'bg-[color:var(--color-oxblood)]' },
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

/** The verdict, as a mark rather than as a word. Chart steps, not interface hues. */
const VERDICT_MARK: Record<Verdict, string> = {
  optimal: 'var(--chart-lead)',
  fine: 'var(--chart-cool)',
  mistake: 'var(--chart-gold)',
  blunder: 'var(--chart-behind)',
}

function DecisionRow({ decision, bigBlind }: { decision: DecisionGrade; bigBlind: number }) {
  const [open, setOpen] = useState(false)
  const style = VERDICT_STYLE[decision.verdict]
  const best = Math.max(...decision.options.map((o) => o.ev))
  const worst = Math.min(...decision.options.map((o) => o.ev), 0)
  const span = best - worst || 1

  return (
    <div className="plate">
      {/* What you did and what the arithmetic says you could have done, side by
          side and big enough to read on a phone at arm's length. This is the
          whole point of a review, and it used to be a 14-pixel row that ran
          "Optimal · flop · Raise 59 · −0.00bb" and expected somebody to
          reconstruct the lesson from it. */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-medium ${style.chip}`}>
            {style.label}
          </span>
          <span className="stamp">{decision.street}</span>
          {/* Sampled spots carry an error bar, and hiding it would present a
              figure as sharper than the sample behind it. Enumerated spots —
              every river — have none to show. */}
          <span className="ml-auto font-mono text-xs text-[color:var(--color-bone-dim)]">
            {decision.evLossBB > 0.005 ? `−${decision.evLossBB.toFixed(2)}bb` : '—'}
            {decision.evLossBB > 0.005 && decision.evLossErrorBB > 0.005 && (
              <span className="text-[color:var(--color-bone-faint)]"> ±{decision.evLossErrorBB.toFixed(2)}</span>
            )}
          </span>
          <span className="text-[color:var(--color-bone-faint)]">{open ? '▾' : '▸'}</span>
        </div>

        <div className="mt-1.5 flex items-end gap-3">
          <div className="min-w-0">
            <div className="stamp">You</div>
            <div className="truncate text-lg font-semibold text-[color:var(--color-bone)]">
              {decision.chosenLabel}
            </div>
          </div>
          {decision.bestLabel !== decision.chosenLabel && (
            <>
              <div aria-hidden className="pb-1.5 text-[color:var(--color-bone-faint)]">→</div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-[color:var(--color-jade)]">
                  Statistically best
                </div>
                <div className="truncate text-lg font-semibold text-[color:var(--color-brass-bright)]">
                  {decision.bestLabel}
                </div>
              </div>
            </>
          )}
          {decision.bestLabel === decision.chosenLabel && (
            <div className="pb-0.5 text-sm text-[color:var(--color-brass-bright)]">— the statistically best play</div>
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t border-[color:var(--color-ink-4)] px-3 py-3">
          <p className="text-sm text-[color:var(--color-bone-dim)]">{decision.explanation}</p>

          {decision.blueprint && (
            <div className="rounded border border-[color:var(--color-royal)]/50 bg-[color:var(--color-royal-deep)] px-2 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-[color:var(--color-royal-bright)]/70">
                  Solved strategy · {decision.blueprint.stack}bb
                </span>
                {/* How far from equilibrium the solve got, rather than a bare
                    claim that this is "GTO". */}
                <span className="font-mono text-[10px] text-[color:var(--color-royal-bright)]/50">
                  exploitable for {decision.blueprint.exploitability.toFixed(6)}bb/hand
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[color:var(--color-bone)]">
                {decision.blueprint.actions
                  .filter((a) => a.frequency >= 0.005)
                  .map((a) => (
                    <span key={a.label}>
                      {a.label} <span className="font-mono">{pct(a.frequency)}</span>
                    </span>
                  ))}
              </div>
              {decision.blueprint.mixed && (
                <div className="mt-0.5 text-[11px] text-[color:var(--color-royal-bright)]/60">
                  A mixed spot — more than one action is close to best, so any of
                  these is defensible.
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <div className="text-[color:var(--color-bone-faint)]">Your equity</div>
              <div className="font-mono">{pct(decision.equity)}</div>
            </div>
            <div>
              <div className="text-[color:var(--color-bone-faint)]">Needed</div>
              <div className="font-mono">
                {decision.toCall > 0 ? pct(decision.requiredEquity) : '—'}
              </div>
            </div>
            <div>
              <div className="text-[color:var(--color-bone-faint)]">Pot</div>
              <div className="font-mono">{decision.potBefore}</div>
            </div>
            <div>
              <div className="text-[color:var(--color-bone-faint)]">To call</div>
              <div className="font-mono">{decision.toCall || '—'}</div>
            </div>
          </div>

          {/* Every action priced side by side: the point is to show the whole
              decision, not just a verdict on the one taken. */}
          <div className="space-y-1">
            {decision.options.map((option) => {
              const chosen = option.label === decision.chosenLabel
              const isBest = option.ev === best
              return (
                <div key={option.label} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-28 shrink-0 ${chosen ? 'font-medium text-[color:var(--color-bone)]' : 'text-[color:var(--color-bone-dim)]'}`}
                  >
                    {option.label}
                    {chosen && ' ←'}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-black/45">
                    <div
                      className={`h-full ${isBest ? style.bar : 'bg-[color:var(--color-bone-faint)]'}`}
                      style={{ width: `${Math.max(1, ((option.ev - worst) / span) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-[color:var(--color-bone-dim)]">
                    {(option.ev / bigBlind).toFixed(2)}bb
                  </span>
                  {option.foldEquity !== undefined && (
                    <span className="w-16 shrink-0 text-right text-[color:var(--color-bone-faint)]">
                      {pct(option.foldEquity)} fold
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Summary({ grade }: { grade: HandGrade }) {
  if (grade.correctAndLost) {
    return (
      <div className="rounded-lg border border-[color:var(--color-jade)]/60 bg-[color:var(--color-jade-deep)] px-3 py-2">
        <div className="stamp !text-[color:var(--color-jade-bright)]">◆ Correct, and lost</div>
        <div className="mt-0.5 text-sm text-[color:var(--color-bone)]">
          Variance, not a mistake.
        </div>
      </div>
    )
  }

  if (grade.worst) {
    return (
      <div className="rounded-lg border border-[color:var(--color-brass)]/50 bg-[color:var(--color-brass-deep)]/30 px-3 py-2">
        <div className="stamp !text-[color:var(--color-brass-bright)]">▲ Biggest leak</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-[color:var(--color-bone)]">
          <span className="font-medium">{grade.worst.chosenLabel}</span>
          <span className="text-[color:var(--color-bone-dim)]">on the {grade.worst.street}</span>
          <span className="ml-auto font-mono text-[color:var(--color-brass-bright)]">
            −{grade.worst.evLossBB.toFixed(1)}bb
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[color:var(--color-jade)]/40 bg-[color:var(--color-jade-deep)] px-3 py-2">
      <div className="stamp !text-[color:var(--color-jade-bright)]">◆ No mistakes</div>
    </div>
  )
}

/**
 * The hand you just played, as figures.
 *
 * What it cost, where the cost came from, and how it went street by street —
 * read off the shapes rather than out of a paragraph. The three questions a
 * player has after a hand are "how much", "was that me or the cards", and
 * "where did it turn", and each of them is one picture.
 */
function HandShape({
  grade,
  record,
  heroSeat,
}: {
  grade: HandGrade
  record: HandRecord
  heroSeat: number
}) {
  const bigBlind = record.bigBlind

  // What the line was worth against what it actually paid. The gap is the
  // cards; the expected-value given up is the decisions. Anything left is the
  // sampling in the adjustment, and it is not attributed to either.
  const { actual, adjusted, wasAllIn } = pricedHand(record.state)
  const won = (actual[heroSeat] ?? 0) / bigBlind
  const deserved = (adjusted[heroSeat] ?? 0) / bigBlind
  const luck = wasAllIn ? won - deserved : 0

  // Equity at each decision, and the chips that were in by the time it was
  // made. Two measures, two figures, one shared run of streets — never two
  // scales on one axis.
  const steps = useMemo(() => {
    const replay = replayHand(record)
    const committed: number[] = []
    for (const { state } of replay) {
      if (state.toAct !== heroSeat) continue
      committed.push(state.seats[heroSeat]!.totalCommitted)
    }
    return grade.decisions.map((decision, i) => ({
      label: decision.street === 'preflop' ? 'pre' : decision.street,
      equity: decision.equity,
      chips: committed[i] ?? 0,
    }))
  }, [record, grade.decisions, heroSeat])

  return (
    <div className="space-y-3">
      {/* Two figures rather than one bar in two colours. What you won and
          what you gave up are not parts of a whole — a hand can be won badly
          — and a stacked bar is a promise that the parts add up. */}
      <div className="flex gap-2">
        <Figure
          label="This hand"
          value={`${won > 0 ? '+' : ''}${won.toFixed(1)}bb`}
          tone={won > 0 ? 'good' : won < 0 ? 'bad' : 'plain'}
        />
        <Figure
          label="Given up"
          value={grade.totalEvLossBB > 0.05 ? `−${grade.totalEvLossBB.toFixed(1)}bb` : 'nothing'}
          tone={grade.totalEvLossBB > 0.05 ? 'mark' : 'good'}
        />
        {/* Only where the chips went in before the cards were out. Anywhere
            else there is no counterfactual, and claiming one invents it. */}
        {wasAllIn && (
          <Figure
            label="The cards"
            value={`${luck >= 0 ? '+' : '−'}${Math.abs(luck).toFixed(1)}bb`}
            tone={luck >= 0 ? 'good' : 'bad'}
          />
        )}
      </div>

      {steps.length > 1 && (
        <div>
          <div className="stamp">Street by street</div>
          <StreetChart points={steps} />
          <StreetAxis points={steps} />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Key colour="var(--chart-cool)">what it was worth</Key>
            <Key colour="var(--chart-gold)">chips in</Key>
          </div>
        </div>
      )}

      {/* How each decision was graded, in the order they were made. A hand
          that went wrong once late looks different from one that leaked the
          whole way through, and the shape says which. */}
      {grade.decisions.length > 0 && (
        <div>
          <div className="stamp">How you played it</div>
          <div className="mt-1">
            <DecisionStrip
              decisions={grade.decisions.map((decision) => ({
                label: decision.street === 'preflop' ? 'pre' : decision.street,
                tone: VERDICT_MARK[decision.verdict],
                cost: decision.evLossBB,
              }))}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Post-hand review: what you did, what it cost, and what was better. */
export function Reflection({ record, heroSeat }: { record: HandRecord; heroSeat: number }) {
  const [expanded, setExpanded] = useState(false)
  // Reuse the grade the worker already produced where there is one: regrading
  // costs a third of a second, and paying it again on the interface thread the
  // moment a hand ends is exactly when it is most visible.
  const grade = useMemo(
    () =>
      record.grades
        ? summariseGrades(record.grades, record, heroSeat)
        : gradeHand(record, heroSeat),
    [record, record.grades, heroSeat],
  )
  const showReview = useStore((s) => s.showReview)

  if (!showReview || grade.decisions.length === 0) return null

  // Folded, having put in nothing but a blind: the one case where the review's
  // own figures — "nothing given up", and a stack that went down anyway — read
  // as a contradiction to anybody who has not met the idea of a sunk cost.
  const blind = blindPosted(heroSeat, record.state.buttonSeat, record.state.seats.length)
  const foldedTheBlind =
    blind !== null &&
    record.state.seats[heroSeat]!.status === 'folded' &&
    record.state.actions.every(
      (entry) => entry.seat !== heroSeat || entry.action.type === 'fold',
    )
      ? blind
      : null

  return (
    <div className="space-y-2 plate p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="stamp">Hand {record.handNumber} review</span>
        {/* The hand, named once. It has gone from the felt by the time this
            appears, and everything below assumes you remember it. */}
        <span className="text-xs text-[color:var(--color-brass-bright)]">
          {madeHandInWords(
            record.state.seats[heroSeat]!.holeCards!,
            record.state.board.slice(0, record.state.result?.runoutFrom ?? record.state.board.length),
          )}
        </span>
      </div>

      <HandShape grade={grade} record={record} heroSeat={heroSeat} />

      {/* "Nothing given up" beside a stack that just went down by one is how
          an app loses somebody's trust. The blind is not a mistake and it is
          not free — it is the rent everybody pays in turn. */}
      {foldedTheBlind && (
        <p className="text-xs text-[color:var(--color-bone-dim)]">
          The {foldedTheBlind} blind is rent, not a mistake — already spent when you looked.
        </p>
      )}

      <Summary grade={grade} />

      <Spread state={record.state} heroSeat={heroSeat} bigBlind={record.bigBlind} />

      <SolveRiver state={record.state} heroSeat={heroSeat} />

      {expanded ? (
        <div className="space-y-1.5">
          {grade.decisions.map((decision, i) => (
            <DecisionRow key={i} decision={decision} bigBlind={record.bigBlind} />
          ))}
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="w-full rounded-lg border border-[color:var(--color-ink-4)] py-1.5 text-xs text-[color:var(--color-bone-dim)] hover:bg-black/40"
        >
          Show all {grade.decisions.length} decisions
        </button>
      )}
    </div>
  )
}
