import type { Action } from '../engine/types'
import type { AdviseReply } from '../workers/analysis.worker'

/**
 * What to do, while you still have to do it.
 *
 * The app's usual argument is that decisions should be graded afterwards, when
 * the answer cannot be copied. This is the other half: while you are learning
 * what a spot is worth, being told the answer *at the moment of the question*
 * is how the question becomes familiar. It is the same pricing that grades the
 * hand afterwards, so the advice and the verdict can never disagree.
 *
 * It says what the best action is worth **against the alternatives**, because
 * "raise" on its own teaches nothing: what makes a spot click is seeing that
 * raising beats calling by two big blinds and folding by six.
 *
 * And where the two best actions are inside the noise of the pricing, it says
 * that instead of quoting a gap it cannot stand behind — the same standard the
 * verdict is held to after the hand.
 */

const bb = (chips: number, bigBlind: number) => `${(chips / bigBlind).toFixed(1)}bb`

/** Two actions are the same decision if they are the same size, too. */
export const sameAction = (a: Action, b: Action): boolean =>
  a.type === b.type && (a.type !== 'raise' || b.type !== 'raise' || a.to === b.to)

export function Advice({
  advice,
  pending,
  bigBlind,
}: {
  advice: AdviseReply | null
  pending: boolean
  bigBlind: number
}) {
  if (!advice || advice.options.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
        {pending ? 'Working out what to do…' : 'No advice for this spot.'}
      </div>
    )
  }

  const best = advice.options[0]!
  const runnerUp = advice.options[1]
  const fold = advice.options.find((option) => option.action.type === 'fold')

  // Most of these numbers are sampled, and two actions can be closer together
  // than the sampling can separate. Claiming a gap there would be inventing one.
  const separation = runnerUp ? best.ev - runnerUp.ev : 0
  const noise = runnerUp ? 1.96 * Math.hypot(best.error, runnerUp.error) : 0
  const tooClose = runnerUp !== undefined && separation < noise

  return (
    <div className="space-y-2 rounded-xl border border-emerald-900/70 bg-emerald-950/30 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-emerald-300/70">
          What to do
        </span>
        {pending && <span className="text-[11px] text-slate-500">updating…</span>}
      </div>

      <div className="text-lg font-semibold text-emerald-200">
        {best.label}
        {tooClose && runnerUp && (
          <span className="text-sm font-normal text-emerald-200/60"> or {runnerUp.label.toLowerCase()}</span>
        )}
      </div>

      <p className="text-xs text-emerald-100/70">
        {!runnerUp
          ? 'The only action available here.'
          : tooClose
            ? `Too close to separate: ${best.label.toLowerCase()} and ${runnerUp.label.toLowerCase()} are within the noise of each other here, so either is fine.`
            : best.action.type === 'fold'
            ? // Folding is the zero point, so everything else is a loss, and
              // saying "worth 0bb more than folding" would be nonsense.
              `Everything else here loses money: ${runnerUp.label.toLowerCase()} costs ${bb(
                -runnerUp.ev,
                bigBlind,
              )}.`
              : `Worth ${bb(best.ev - runnerUp.ev, bigBlind)} more than ${runnerUp.label.toLowerCase()}` +
                (fold && fold !== runnerUp
                  ? `, and ${bb(best.ev - fold.ev, bigBlind)} more than folding.`
                  : '.')}
      </p>

      {/* Every option priced, so the recommendation is an argument rather than
          an instruction. */}
      <div className="space-y-1">
        {advice.options.map((option) => {
          const isBest = option === best
          const span = Math.max(1, best.ev - advice.options[advice.options.length - 1]!.ev)
          const share = ((option.ev - advice.options[advice.options.length - 1]!.ev) / span) * 100
          return (
            <div key={option.label} className="flex items-center gap-2 text-[11px]">
              <span className={`w-24 shrink-0 truncate ${isBest ? 'text-emerald-200' : 'text-slate-400'}`}>
                {option.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800">
                <div
                  className={`h-full ${isBest ? 'bg-emerald-400' : 'bg-slate-600'}`}
                  style={{ width: `${Math.max(2, share)}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-slate-400">
                {bb(option.ev, bigBlind)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Measured, not hedged: over a thousand hands the table folded to these
          bets 24.6% of the time where the model expected 43.4%. Somebody
          following this on every street loses more than somebody folding every
          hand, and they should hear that from the panel giving the advice. */}
      <p className="text-[11px] text-slate-500">
        Priced against what they are modelled to hold, one street at a time, in big blinds
        relative to folding. It reads the arithmetic of this decision well; it over-values
        betting, because these opponents call more often than it expects.
      </p>
    </div>
  )
}
