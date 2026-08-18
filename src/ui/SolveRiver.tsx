import { modelledWidth } from '../equity/opponent'
import { topPercentRange } from '../equity/preflop'
import { potSize, type HandState } from '../engine/types'
import { useRiverSolve } from './useAnalysis'

/**
 * Solving the river the hand actually reached.
 *
 * On the river there is nothing left to draw, so a solve here is exact rather
 * than abstracted — the one place in the app where "this is the strategy" is
 * a statement about poker and not about a model of it.
 *
 * It runs only when asked. A solve takes seconds of a real processor, and
 * spending that on every hand a player scrolls past would be rude.
 */
export function SolveRiver({ state, heroSeat }: { state: HandState; heroSeat: number }) {
  const { result, pending, error, solve } = useRiverSolve()

  const hero = state.seats[heroSeat]
  const opponents = state.seats.filter((s) => s.index !== heroSeat && s.status !== 'folded')

  // Only a heads-up river is in scope: with three players the solve is a
  // different and much harder game, and pretending otherwise would be worse
  // than not offering it.
  const eligible =
    state.board.length === 5 && opponents.length === 1 && hero?.status !== 'folded'

  if (!eligible) return null

  const villain = opponents[0]!
  const pot = potSize(state)
  const stack = Math.min(hero!.stack, villain.stack)

  return (
    <div className="rounded-lg border border-violet-900/60 bg-violet-950/20 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-violet-300/70">
          Solve this river
        </span>
        <button
          onClick={() =>
            solve({
              board: state.board,
              heroRange: topPercentRange(modelledWidth(state, heroSeat)),
              villainRange: topPercentRange(modelledWidth(state, villain.index)),
              pot,
              stack,
            })
          }
          disabled={pending}
          className="rounded bg-violet-800 px-2.5 py-1 text-xs hover:bg-violet-700 disabled:opacity-40"
        >
          {pending ? 'Solving…' : result ? 'Solve again' : 'Solve'}
        </button>
      </div>

      {error && <div className="mt-1 text-xs text-rose-300">{error}</div>}

      {result && (
        <div className="mt-2 space-y-1.5">
          <div className="text-xs text-violet-100">
            With these ranges on this board, the first player to act should:
          </div>
          {result.actions
            .filter((action) => action.frequency >= 0.005)
            .map((action) => (
              <div key={action.label} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-violet-200">{action.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-violet-950">
                  <div
                    className="h-full bg-violet-600"
                    style={{ width: `${action.frequency * 100}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-violet-300">
                  {(action.frequency * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          <div className="text-[10px] text-violet-300/50">
            {result.iterations.toLocaleString('en-US')} iterations in{' '}
            {(result.milliseconds / 1000).toFixed(1)}s · exploitable for{' '}
            {result.exploitability.toFixed(4)} chips per hand in a {pot}-chip pot
          </div>
        </div>
      )}
    </div>
  )
}
