import { useMemo } from 'react'
import { potSize, type HandState } from '../engine/types'
import { modelledWidth } from '../equity/opponent'
import { preflopStrength, topPercentRange } from '../equity/preflop'
import { useEquity } from './useAnalysis'
import { inBigBlinds, potOddsRatio, requiredEquity, stackToPotRatio } from '../coach/odds'
import { useStore } from './store'

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'good' | 'bad'
}) {
  const colour =
    tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-slate-100'
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-lg ${colour}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

/**
 * Live odds for the hero's current decision.
 *
 * Equity is always measured against the opponents' modelled ranges, never
 * against random cards — a number computed against random cards trains the
 * wrong instinct, however good it looks on screen.
 */
export function OddsPanel({ state, heroSeat }: { state: HandState; heroSeat: number }) {
  const hudLevel = useStore((s) => s.hudLevel)
  const guess = useStore((s) => s.guess)
  const submitGuess = useStore((s) => s.submitGuess)

  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  const toCall = Math.max(0, state.currentBet - hero.committed)

  // The modelled widths double as the query: the worker takes ranges as text
  // so the message stays small, and the same numbers drive the display.
  const widths = useMemo(
    () =>
      state.seats
        .filter((s) => s.index !== heroSeat && s.status !== 'folded')
        .map((s) => ({ name: s.name, width: modelledWidth(state, s.index) })),
    [state, heroSeat],
  )

  const query = useMemo(() => {
    if (!hero.holeCards || hero.status === 'folded' || widths.length === 0) return null
    return {
      hero: hero.holeCards,
      villains: widths.map((w) => topPercentRange(w.width)),
      board: state.board,
    }
  }, [hero.holeCards, hero.status, widths, state.board])

  const { result: equity, pending } = useEquity(query)

  if (!equity) {
    return pending ? (
      <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-500">
        Working out the odds…
      </div>
    ) : null
  }

  const needed = requiredEquity(toCall, pot)
  const callIsCorrect = toCall > 0 && equity.equity >= needed
  const effectiveStack = Math.min(
    hero.stack,
    ...state.seats.filter((s) => s.index !== heroSeat && s.status !== 'folded').map((s) => s.stack),
  )

  const hidden = hudLevel === 'predict' && guess === null

  return (
    <div className="space-y-3">
      {hudLevel === 'predict' && (
        <div className="rounded-lg border border-sky-900 bg-sky-950/40 px-3 py-2">
          <div className="text-xs text-sky-200">
            {guess === null
              ? 'Estimate your equity before the numbers appear.'
              : `You guessed ${guess}% — actual ${pct(equity.equity)} (off by ${Math.abs(guess - equity.equity * 100).toFixed(1)} points).`}
          </div>
          {guess === null && (
            <div className="mt-2 flex flex-wrap gap-1">
              {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((value) => (
                <button
                  key={value}
                  onClick={() => submitGuess(value)}
                  className="rounded bg-sky-900/60 px-2 py-1 text-xs hover:bg-sky-800"
                >
                  {value}%
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!hidden && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat
              label="Your equity"
              value={pct(equity.equity)}
              hint={
                pending
                  ? 'updating…'
                  : equity.exact
                    ? 'exact'
                    : `±${(equity.errorMargin * 100).toFixed(1)}`
              }
            />
            <Stat
              label="Need to call"
              value={toCall > 0 ? pct(needed) : '—'}
              hint={toCall > 0 ? `${potOddsRatio(toCall, pot)} · ${toCall} to call` : 'no bet to face'}
              tone={toCall > 0 ? (callIsCorrect ? 'good' : 'bad') : 'default'}
            />
            <Stat
              label="SPR"
              value={pot > 0 ? stackToPotRatio(effectiveStack, pot).toFixed(1) : '—'}
              hint={`${inBigBlinds(effectiveStack, state.bigBlind).toFixed(0)}bb effective`}
            />
            <Stat
              label="Hand strength"
              value={
                state.board.length === 0
                  ? pct(preflopStrength(hero.holeCards!).percentile)
                  : pct(equity.win)
              }
              hint={
                state.board.length === 0 ? 'of starting hands beaten' : 'win outright'
              }
            />
          </div>

          {toCall > 0 && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                callIsCorrect
                  ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
                  : 'border-rose-900 bg-rose-950/40 text-rose-200'
              }`}
            >
              {callIsCorrect
                ? `Your ${pct(equity.equity)} beats the ${pct(needed)} the price demands — calling is profitable here.`
                : `You need ${pct(needed)} and hold ${pct(equity.equity)} — this call loses money on average.`}
            </div>
          )}

          <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Modelled ranges
            </div>
            <div className="mt-1 space-y-1">
              {widths.map((w) => (
                <div key={w.name} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 text-slate-400">{w.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800">
                    <div
                      className="h-full bg-slate-500"
                      style={{ width: `${Math.min(100, w.width * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right font-mono text-slate-400">
                    top {(w.width * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
