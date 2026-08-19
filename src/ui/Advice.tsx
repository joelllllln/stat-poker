import type { Action } from '../engine/types'
import type { AdviseReply } from '../workers/analysis.worker'
import { bigBlindsExplained, reasonInWords, strengthInWords, timesInTen } from './plain'

/**
 * What the maths says about the decision in front of you.
 *
 * Deliberately not framed as an instruction. There is more to poker than the
 * statistically best line — table image, what somebody did to you three hands
 * ago, the fact that a bluff has to come from somewhere — and a panel that
 * says "do this" teaches people to stop thinking about any of it. So this
 * shows the situation and labels the statistically best play *as* the
 * statistically best play, which is a fact about the arithmetic rather than a
 * command.
 *
 * Built for a phone, which means the important things are big. The headline is
 * a hero figure: how often this hand wins if it goes all the way. Under it, one
 * meter answers the only other question that matters at a decision — is that
 * more or less than the price is asking for. Everything else is smaller,
 * because everything else is detail.
 */

const bb = (chips: number, bigBlind: number) => `${(chips / bigBlind).toFixed(1)}bb`

/** Two actions are the same decision if they are the same size, too. */
export const sameAction = (a: Action, b: Action): boolean =>
  a.type === b.type && (a.type !== 'raise' || b.type !== 'raise' || a.to === b.to)

/**
 * Your share against what the price asks for.
 *
 * A single ratio against a limit, which is a meter and not a chart: one track,
 * one fill, and a mark where the limit sits. The track is a darker step of the
 * fill's own hue so the state reads across the whole bar rather than only in
 * the filled part.
 */
function ShareMeter({ equity, needed, chips }: { equity: number; needed: number; chips: number }) {
  const share = Math.max(0, Math.min(1, equity))
  const bar = Math.max(2, share * 100)
  const clears = needed <= 0 || equity >= needed

  return (
    <div className="space-y-1.5">
      <div className="relative h-7 overflow-hidden rounded-md bg-black/50 shadow-[inset_0_1px_0_rgba(0,0,0,.6)]">
        <div
          className={`h-full rounded-md ${clears ? 'bg-[color:var(--color-jade)]' : 'bg-[color:var(--color-oxblood)]'}`}
          style={{ width: `${bar}%` }}
        />
        {needed > 0 && (
          // Where the price sits. A 2px rule against the surface, so it reads
          // over both the filled and the empty part of the track.
          <div
            className="absolute inset-y-0 w-0.5 bg-[color:var(--color-brass-bright)]"
            style={{ left: `${Math.min(99, needed * 100)}%` }}
            aria-hidden
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-[color:var(--color-bone-dim)]">
        <span>
          <span className="font-semibold text-[color:var(--color-bone)]">{(share * 100).toFixed(0)}%</span> yours
        </span>
        {needed > 0 && (
          <span>
            price asks <span className="font-semibold text-[color:var(--color-brass-bright)]">{(needed * 100).toFixed(0)}%</span>
          </span>
        )}
      </div>
      {/* Visible, not behind a disclosure: a unit somebody cannot read makes
          every number wearing it unreadable, and they will not open a panel to
          find out what a word they have not noticed means. */}
      <p className="text-xs text-[color:var(--color-bone-faint)]">bb means big blinds — one is {chips} chips here.</p>
    </div>
  )
}

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
      <div className="plate px-3 py-3 text-sm text-[color:var(--color-bone-faint)]">
        {pending ? 'Working out the odds…' : 'No odds for this spot.'}
      </div>
    )
  }

  const best = advice.options[0]!
  const runnerUp = advice.options[1]

  // Most of these numbers are sampled, and two actions can be closer together
  // than the sampling can separate. Claiming a gap there would be inventing one.
  const separation = runnerUp ? best.ev - runnerUp.ev : 0
  const noise = runnerUp ? 1.96 * Math.hypot(best.error, runnerUp.error) : 0
  const tooClose = runnerUp !== undefined && separation < noise

  const clears = advice.toCall > 0 && advice.equity >= advice.requiredEquity

  return (
    <div className="plate space-y-4 p-4">
      {/* The hero figure: the one number this whole panel is about. */}
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="stamp">
            If this goes all the way
          </span>
          {pending && <span className="text-xs text-slate-600">updating…</span>}
        </div>
        <div className="figure mt-1 text-5xl text-[color:var(--color-brass-bright)]">
          {timesInTen(advice.equity)}
        </div>
        <p className="mt-2 text-base text-[color:var(--color-bone-dim)]">
          You are {strengthInWords(advice.equity)}.
        </p>
      </div>

      <ShareMeter equity={advice.equity} needed={advice.requiredEquity} chips={bigBlind} />

      {advice.toCall > 0 && (
        <p className="text-sm text-[color:var(--color-bone-dim)]">
          {clears
            ? 'Your share is bigger than the price is asking for, so calling makes money over time.'
            : 'Your share is smaller than the price is asking for, so calling loses money over time.'}
        </p>
      )}

      {/* The statistically best play, labelled as exactly that. Icon and words
          both, never colour alone. */}
      <div className="plate-brass p-3">
        <div className="stamp flex items-center gap-1.5 !text-[color:var(--color-brass-bright)]">
          <span aria-hidden>◆</span>
          <span>Statistically the best play</span>
        </div>
        <div className="figure mt-1.5 text-3xl text-[color:var(--color-bone)]">
          {best.label}
          {tooClose && runnerUp && (
            <span className="text-lg font-normal text-[color:var(--color-bone-dim)]">
              {' '}
              or {runnerUp.label.toLowerCase()}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm leading-snug text-[color:var(--color-bone)]">
          {reasonInWords({
            action: best.action.type,
            equity: advice.equity,
            toCall: advice.toCall,
            pot: advice.pot + advice.toCall,
            foldEquity: best.foldEquity,
            tooClose,
            requiredEquity: advice.requiredEquity,
          })}
        </p>
        <p className="mt-2 text-xs text-[color:var(--color-bone-faint)]">
          It is not the only way to play it — this is the arithmetic, not the whole game.
        </p>
      </div>

      {/* Every option priced. Detail, so it is quieter and smaller. */}
      <details className="group">
        <summary className="stamp cursor-pointer list-none">
          <span className="group-open:hidden">What every option is worth ▸</span>
          <span className="hidden group-open:inline">What every option is worth ▾</span>
        </summary>
        <div className="mt-2 space-y-1.5">
          {advice.options.map((option) => {
            const isBest = option === best
            const span = Math.max(1, best.ev - advice.options[advice.options.length - 1]!.ev)
            const share =
              ((option.ev - advice.options[advice.options.length - 1]!.ev) / span) * 100
            return (
              <div key={option.label} className="flex items-center gap-2 text-xs">
                <span
                  className={`w-24 shrink-0 truncate ${isBest ? 'text-[color:var(--color-brass-bright)]' : 'text-[color:var(--color-bone-dim)]'}`}
                >
                  {option.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-black/50">
                  <div
                    className={`h-full rounded ${isBest ? 'bg-[color:var(--color-brass)]' : 'bg-[color:var(--color-ink-4)]'}`}
                    style={{ width: `${Math.max(2, share)}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-[color:var(--color-bone-dim)]">
                  {bb(option.ev, bigBlind)}
                </span>
              </div>
            )
          })}
        </div>
        <p className="mt-2 text-xs leading-snug text-[color:var(--color-bone-faint)]">
          {bigBlindsExplained(bigBlind)} These are priced against what these players really
          hold, one street at a time, relative to folding. It only calls a bet best when your
          hand is ahead of what would call it — it will not talk you into a bluff, because a
          bluff is won on the next street and this model cannot see the next street.
        </p>
      </details>
    </div>
  )
}
