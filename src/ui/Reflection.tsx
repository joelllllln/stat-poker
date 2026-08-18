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
import { useStore } from './store'

const VERDICT_STYLE: Record<Verdict, { label: string; chip: string; bar: string }> = {
  optimal: { label: 'Optimal', chip: 'bg-emerald-900/70 text-emerald-200', bar: 'bg-emerald-500' },
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
    <div className="rounded-lg border border-slate-800 bg-slate-900/50">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${style.chip}`}>
          {style.label}
        </span>
        <span className="text-xs uppercase tracking-wide text-slate-500">{decision.street}</span>
        <span className="text-sm">{decision.chosenLabel}</span>
        {/* Sampled spots carry an error bar, and hiding it would present a
            figure as sharper than the sample behind it. Enumerated spots —
            every river — have none to show. */}
        <span className="ml-auto font-mono text-xs text-slate-400">
          {decision.evLossBB > 0.005 ? `−${decision.evLossBB.toFixed(2)}bb` : '—'}
          {decision.evLossBB > 0.005 && decision.evLossErrorBB > 0.005 && (
            <span className="text-slate-600"> ±{decision.evLossErrorBB.toFixed(2)}</span>
          )}
        </span>
        <span className="text-slate-600">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-800 px-3 py-3">
          <p className="text-sm text-slate-300">{decision.explanation}</p>

          {decision.blueprint && (
            <div className="rounded border border-violet-900/70 bg-violet-950/30 px-2 py-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-violet-300/70">
                  Solved strategy
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
              <div className="text-slate-500">Your equity</div>
              <div className="font-mono">{pct(decision.equity)}</div>
            </div>
            <div>
              <div className="text-slate-500">Needed</div>
              <div className="font-mono">
                {decision.toCall > 0 ? pct(decision.requiredEquity) : '—'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Pot</div>
              <div className="font-mono">{decision.potBefore}</div>
            </div>
            <div>
              <div className="text-slate-500">To call</div>
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
                    className={`w-28 shrink-0 ${chosen ? 'font-medium text-white' : 'text-slate-400'}`}
                  >
                    {option.label}
                    {chosen && ' ←'}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-slate-800">
                    <div
                      className={`h-full ${isBest ? style.bar : 'bg-slate-600'}`}
                      style={{ width: `${Math.max(1, ((option.ev - worst) / span) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-slate-400">
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
        <div className="text-sm font-medium text-emerald-200">
          You played this hand correctly and lost it.
        </div>
        <div className="mt-1 text-xs text-emerald-200/70">
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
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm text-slate-300">
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

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Hand {record.handNumber} review
        </span>
        <span className="font-mono text-xs text-slate-400">
          {grade.totalEvLossBB > 0.005
            ? `−${grade.totalEvLossBB.toFixed(2)}bb given up`
            : 'nothing given up'}
        </span>
      </div>

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
          className="w-full rounded-lg border border-slate-800 py-1.5 text-xs text-slate-400 hover:bg-slate-900"
        >
          Show all {grade.decisions.length} decisions
        </button>
      )}
    </div>
  )
}
