import { useMemo, useState } from 'react'
import type { HandState } from '../engine/types'
import { outcomes, runItAgain } from '../coach/run-it-again'

const TRIALS = 2_000

/**
 * The spread of results the hand could have produced.
 *
 * Everything is held as it was played and only the board is dealt again, so
 * this is what the line was worth rather than what it happened to pay. The
 * result the player actually lived through is marked in the distribution,
 * which is the whole point: one hand is a sample of size one, and seeing where
 * it fell is the difference between "I got unlucky" and "I played badly".
 */
export function Spread({
  state,
  heroSeat,
  bigBlind,
}: {
  state: HandState
  heroSeat: number
  bigBlind: number
}) {
  const [from, setFrom] = useState(0)

  const run = useMemo(
    () => runItAgain(state, heroSeat, from, TRIALS),
    [state, heroSeat, from],
  )
  const spread = useMemo(() => outcomes(run.nets), [run.nets])

  if (run.trials === 0 || spread.length === 0) return null

  const streets = [
    { label: 'Preflop', size: 0 },
    { label: 'Flop', size: 3 },
    { label: 'Turn', size: 4 },
  ].filter((street) => street.size < state.board.length)

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Run it {TRIALS.toLocaleString('en-US')} times
        </span>
        <div className="flex gap-1">
          {streets.map((street) => (
            <button
              key={street.label}
              onClick={() => setFrom(street.size)}
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                from === street.size
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              from {street.label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-slate-500">Wins</div>
          <div className="font-mono text-sm text-slate-200">
            {(run.winRate * 100).toFixed(1)}%
            {run.tieRate > 0.005 && (
              <span className="text-slate-500"> +{(run.tieRate * 100).toFixed(1)}% chop</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Worth</div>
          <div className="font-mono text-sm text-slate-200">
            {run.expected >= 0 ? '+' : ''}
            {(run.expected / bigBlind).toFixed(1)}bb
          </div>
        </div>
        <div>
          <div className="text-slate-500">You got</div>
          <div
            className={`font-mono text-sm ${
              run.actual >= run.expected ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {run.actual >= 0 ? '+' : ''}
            {(run.actual / bigBlind).toFixed(1)}bb
          </div>
        </div>
      </div>

      {/* With the betting fixed, re-dealing the board picks between a handful
          of definite results rather than spreading them, so each one gets its
          own bar and the one that happened is marked. */}
      <div className="space-y-1">
        {spread.map((outcome) => {
          const happened = outcome.net === run.actual
          return (
            <div key={outcome.net} className="flex items-center gap-2 text-xs">
              <span
                className={`w-20 shrink-0 text-right font-mono ${
                  outcome.net >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {outcome.net >= 0 ? '+' : ''}
                {(outcome.net / bigBlind).toFixed(1)}bb
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded bg-slate-800">
                <div
                  className={`h-full ${
                    outcome.net >= 0 ? 'bg-emerald-700' : 'bg-rose-800'
                  } ${happened ? 'ring-1 ring-amber-400' : ''}`}
                  style={{ width: `${Math.max(1, outcome.probability * 100)}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-slate-400">
                {(outcome.probability * 100).toFixed(1)}%
              </span>
              <span className="w-14 shrink-0 text-[10px] text-amber-400">
                {happened ? '← actual' : ''}
              </span>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-slate-400">
        {run.counterfactual
          ? `You folded, so this is what the hand would have been worth had you played on: it wins ${(run.winRate * 100).toFixed(0)}% of the time at showdown.`
          : run.actual < run.expected
            ? run.expected > 0
              ? `This line wins ${(run.winRate * 100).toFixed(0)}% of the time and was worth ${(run.expected / bigBlind).toFixed(1)}bb. This runout was one of the ${(100 - run.actualPercentile * 100).toFixed(0)}% that did not.`
              : `This runout went badly, but so did the line: it was only worth ${(run.expected / bigBlind).toFixed(1)}bb before the cards came out.`
            : run.actual > run.expected
              ? `This runout beat ${(run.actualPercentile * 100).toFixed(0)}% of the others — the result flattered the line, which was worth ${(run.expected / bigBlind).toFixed(1)}bb.`
              : 'This hand finished exactly where the line was worth finishing.'}
      </p>
    </div>
  )
}
