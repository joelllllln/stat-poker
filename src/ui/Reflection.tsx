import { useMemo, useState } from 'react'
import { describe as describeHand } from '../engine/evaluator'
import {
  gradeHand,
  summariseGrades,
  type DecisionGrade,
  type HandGrade,
  type Verdict,
} from '../coach/grade'
import type { HandRecord } from '../game/session'
import { SolveRiver } from './SolveRiver'
import { Spread } from './Spread'
import { blindPosted, madeHandInWords } from './plain'
import { useStore } from './store'

const VERDICT_STYLE: Record<Verdict, { label: string; chip: string; bar: string }> = {
  optimal: { label: 'Optimal', chip: 'bg-emerald-900/70 text-[color:var(--color-brass-bright)]', bar: 'bg-emerald-500' },
  fine: { label: 'Fine', chip: 'bg-sky-900/70 text-sky-200', bar: 'bg-sky-500' },
  mistake: { label: 'Mistake', chip: 'bg-amber-900/70 text-amber-200', bar: 'bg-amber-500' },
  blunder: { label: 'Blunder', chip: 'bg-rose-900/70 text-rose-200', bar: 'bg-rose-500' },
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

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
              <span className="text-slate-600"> ±{decision.evLossErrorBB.toFixed(2)}</span>
            )}
          </span>
          <span className="text-slate-600">{open ? '▾' : '▸'}</span>
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
              <div aria-hidden className="pb-1.5 text-slate-600">→</div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-emerald-400/70">
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
            <div className="rounded border border-violet-900/70 bg-violet-950/30 px-2 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-violet-300/70">
                  Solved strategy · {decision.blueprint.stack}bb
                </span>
                {/* How far from equilibrium the solve got, rather than a bare
                    claim that this is "GTO". */}
                <span className="font-mono text-[10px] text-violet-300/50">
                  exploitable for {decision.blueprint.exploitability.toFixed(6)}bb/hand
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-violet-100">
                {decision.blueprint.actions
                  .filter((a) => a.frequency >= 0.005)
                  .map((a) => (
                    <span key={a.label}>
                      {a.label} <span className="font-mono">{pct(a.frequency)}</span>
                    </span>
                  ))}
              </div>
              {decision.blueprint.mixed && (
                <div className="mt-0.5 text-[11px] text-violet-300/60">
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
                    className={`w-28 shrink-0 ${chosen ? 'font-medium text-white' : 'text-[color:var(--color-bone-dim)]'}`}
                  >
                    {option.label}
                    {chosen && ' ←'}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-black/45">
                    <div
                      className={`h-full ${isBest ? style.bar : 'bg-slate-600'}`}
                      style={{ width: `${Math.max(1, ((option.ev - worst) / span) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-[color:var(--color-bone-dim)]">
                    {(option.ev / bigBlind).toFixed(2)}bb
                  </span>
                  {option.foldEquity !== undefined && (
                    <span className="w-16 shrink-0 text-right text-slate-600">
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

function Summary({ grade, record, heroSeat }: { grade: HandGrade; record: HandRecord; heroSeat: number }) {
  const value = record.state.result?.handValues[heroSeat]
  const showdown = record.state.result?.showdown

  if (grade.correctAndLost) {
    return (
      <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2">
        <div className="text-sm font-medium text-[color:var(--color-brass-bright)]">
          You played this hand correctly and lost it.
        </div>
        <div className="mt-1 text-xs text-[color:var(--color-brass-bright)]/70">
          Every decision was the highest-value one available. Losing {-grade.net} chips here is
          variance, not a mistake — the same decisions win this pot more often than not.
        </div>
      </div>
    )
  }

  if (grade.worst) {
    return (
      <div className="rounded-lg border border-amber-900 bg-amber-950/30 px-3 py-2">
        <div className="text-sm font-medium text-amber-200">
          Biggest leak: {grade.worst.chosenLabel} on the {grade.worst.street}, costing{' '}
          {grade.worst.evLossBB.toFixed(2)}bb
        </div>
        <div className="mt-1 text-xs text-amber-200/70">{grade.worst.explanation}</div>
      </div>
    )
  }

  return (
    <div className="plate px-3 py-2 text-sm text-[color:var(--color-bone-dim)]">
      No mistakes in this hand.
      {showdown && value != null && ` You showed down ${describeHand(value).toLowerCase()}.`}
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
      <div className="flex items-baseline justify-between">
        <span className="stamp">
          Hand {record.handNumber} review
        </span>
        <span className="font-mono text-xs text-[color:var(--color-bone-dim)]">
          {grade.totalEvLossBB > 0.005
            ? `−${grade.totalEvLossBB.toFixed(2)}bb given up`
            : 'nothing given up'}
        </span>
      </div>

      {/* What happened, before what to make of it.
          Reflecting on a hand starts with remembering it, and by the time the
          review appears the cards have gone from the felt. A beginner cannot
          reconstruct "the flop came and I had two pair" from a list of graded
          decisions — and every sentence under this one begins by assuming
          they can. */}
      <p className="text-sm text-[color:var(--color-bone-dim)]">
        You had{' '}
        <span className="font-medium text-amber-100">
          {madeHandInWords(
            record.state.seats[heroSeat]!.holeCards!,
            record.state.board.slice(0, record.state.result?.runoutFrom ?? record.state.board.length),
          )}
        </span>{' '}
        when the betting finished, and{' '}
        {grade.net > 0
          ? `won ${grade.net} chips.`
          : grade.net < 0
            ? `lost ${-grade.net} chips.`
            : 'broke even.'}
      </p>

      {/* "Nothing given up" beside a stack that just went down by one is how
          an app loses somebody's trust. The blind is not a mistake and it is
          not free — it is the rent everybody pays in turn, and the review has
          to say so rather than leave the arithmetic looking wrong. */}
      {foldedTheBlind && (
        <p className="text-xs text-[color:var(--color-bone-dim)]">
          You folded the {foldedTheBlind} blind, so it stayed in the middle. That is not a
          mistake and it is not free: everybody pays it in turn, and it is already spent by
          the time you look at your cards.
        </p>
      )}

      <Summary grade={grade} record={record} heroSeat={heroSeat} />

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
