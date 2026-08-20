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
  // Where the betting ended, which is the only stretch of board over which
  // holding the betting fixed is a statement about the hand rather than a
  // hypothetical. Earlier streets are offered, and labelled as the different
  // question they are.
  const settled = state.result?.runoutFrom ?? state.board.length
  const [from, setFrom] = useState(settled)

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
    { label: 'the all-in', size: settled },
  ]
    .filter((street) => street.size < state.board.length)
    .filter(
      (street, index, all) => all.findIndex((other) => other.size === street.size) === index,
    )
    .sort((a, b) => b.size - a.size)

  return (
    <div className="space-y-2 rounded-lg border border-[color:var(--color-ink-4)] bg-black/40 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-[color:var(--color-bone-faint)]">
          Run it {TRIALS.toLocaleString('en-US')} times
        </span>
        <div className="flex gap-1">
          {streets.map((street) => (
            <button
              key={street.label}
              onClick={() => setFrom(street.size)}
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                from === street.size
                  ? 'bg-[color:var(--color-ink-4)] text-[color:var(--color-bone)]'
                  : 'text-[color:var(--color-bone-faint)] hover:text-[color:var(--color-bone)]'
              }`}
            >
              from {street.label.toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-[color:var(--color-bone-faint)]">Wins</div>
          <div className="font-mono text-sm text-[color:var(--color-bone)]">
            {(run.winRate * 100).toFixed(1)}%
            {run.tieRate > 0.005 && (
              <span className="text-[color:var(--color-bone-faint)]"> +{(run.tieRate * 100).toFixed(1)}% chop</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[color:var(--color-bone-faint)]">Worth</div>
          <div className="font-mono text-sm text-[color:var(--color-bone)]">
            {run.expected >= 0 ? '+' : ''}
            {(run.expected / bigBlind).toFixed(1)}bb
          </div>
        </div>
        <div>
          <div className="text-[color:var(--color-bone-faint)]">You got</div>
          <div
            className={`font-mono text-sm ${
              run.actual >= run.expected ? 'text-[color:var(--color-jade-bright)]' : 'text-[color:var(--color-oxblood-bright)]'
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
                  outcome.net >= 0 ? 'text-[color:var(--color-jade-bright)]' : 'text-[color:var(--color-oxblood-bright)]'
                }`}
              >
                {outcome.net >= 0 ? '+' : ''}
                {(outcome.net / bigBlind).toFixed(1)}bb
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded bg-[color:var(--color-ink-3)]">
                <div
                  className={`h-full ${
                    outcome.net >= 0 ? 'bg-[color:var(--color-jade)]' : 'bg-[color:var(--color-oxblood)]'
                  } ${happened ? 'ring-1 ring-[color:var(--color-brass-bright)]' : ''}`}
                  style={{ width: `${Math.max(1, outcome.probability * 100)}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-[color:var(--color-bone-dim)]">
                {(outcome.probability * 100).toFixed(1)}%
              </span>
              <span className="w-14 shrink-0 text-[10px] text-[color:var(--color-brass-bright)]">
                {happened ? '← actual' : ''}
              </span>
            </div>
          )
        })}
      </div>

      {from < settled && (
        <p className="text-[11px] text-[color:var(--color-brass)]">
          A what-if — dealt from before the betting ended.
        </p>
      )}

      <p className="text-[11px] text-[color:var(--color-bone-dim)]">
        {run.counterfactual
          ? `Folded · calling was worth ${(run.expected / bigBlind).toFixed(1)}bb`
          : run.actual < run.expected
            ? `This runout was in the worst ${(100 - run.actualPercentile * 100).toFixed(0)}%`
            : run.actual > run.expected
              ? `This runout beat ${(run.actualPercentile * 100).toFixed(0)}% of the others`
              : 'This runout landed on the average'}
      </p>
    </div>
  )
}
