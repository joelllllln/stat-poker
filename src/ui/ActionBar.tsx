import { useState } from 'react'
import { legalActions } from '../engine/hand'
import { potSize, type HandState } from '../engine/types'
import { useStore } from './store'

/** Bet sizes offered as a fraction of the pot, plus an all-in. */
const SIZINGS = [
  { label: '⅓', fraction: 1 / 3 },
  { label: '½', fraction: 0.5 },
  { label: '¾', fraction: 0.75 },
  { label: 'Pot', fraction: 1 },
]

export function ActionBar({ state, heroSeat }: { state: HandState; heroSeat: number }) {
  const act = useStore((s) => s.act)
  const [custom, setCustom] = useState<number | null>(null)

  if (state.result !== null || state.toAct !== heroSeat) return null

  const options = legalActions(state)
  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  const toCall = state.currentBet - hero.committed
  const raise = options.find((o) => o.type === 'raise')

  const button =
    'rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-30 disabled:cursor-not-allowed'

  const sizeFor = (fraction: number) => {
    if (!raise) return 0
    // A pot-sized raise calls the outstanding bet first, then raises the pot
    // that call creates — the standard definition, not "bet the current pot".
    const target = state.currentBet + (pot + toCall) * fraction
    return Math.max(raise.min!, Math.min(raise.max!, Math.round(target)))
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
      <div className="flex flex-wrap gap-2">
        <button
          className={`${button} bg-slate-800 hover:bg-slate-700`}
          disabled={!options.some((o) => o.type === 'fold')}
          onClick={() => act({ type: 'fold' })}
        >
          Fold
        </button>

        {options.some((o) => o.type === 'check') ? (
          <button
            className={`${button} bg-slate-700 hover:bg-slate-600`}
            onClick={() => act({ type: 'check' })}
          >
            Check
          </button>
        ) : (
          <button
            className={`${button} bg-sky-800 hover:bg-sky-700`}
            disabled={!options.some((o) => o.type === 'call')}
            onClick={() => act({ type: 'call' })}
          >
            Call {Math.min(toCall, hero.stack)}
          </button>
        )}

        <button
          className={`${button} bg-emerald-800 hover:bg-emerald-700`}
          disabled={!raise}
          onClick={() => raise && act({ type: 'raise', to: custom ?? sizeFor(0.75) })}
        >
          {state.currentBet > 0 ? 'Raise to' : 'Bet'} {raise ? (custom ?? sizeFor(0.75)) : '—'}
        </button>
      </div>

      {raise && (
        <div className="flex flex-wrap items-center gap-2">
          {SIZINGS.map((s) => (
            <button
              key={s.label}
              onClick={() => setCustom(sizeFor(s.fraction))}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setCustom(raise.max!)}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            All in
          </button>
          <input
            type="range"
            min={raise.min}
            max={raise.max}
            value={custom ?? sizeFor(0.75)}
            onChange={(e) => setCustom(Number(e.target.value))}
            className="ml-2 flex-1 accent-emerald-500"
          />
        </div>
      )}
    </div>
  )
}
