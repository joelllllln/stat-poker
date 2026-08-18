import { useEffect, useState } from 'react'
import { legalActions } from '../engine/hand'
import { potSize, type HandState } from '../engine/types'
import { useStore } from './store'

/**
 * The controls.
 *
 * Arranged the way an online client arranges them: fold on the left, the
 * passive option in the middle, the aggressive one on the right, and the sizing
 * above the buttons rather than buried in a menu. The order matters — people
 * build muscle memory for it, and a trainer that puts fold where raise usually
 * goes will cost somebody a stack.
 *
 * Every button has a keyboard shortcut, because deciding is the thing being
 * practised and reaching for the mouse is not part of it.
 */

/** Bet sizes offered as a fraction of the pot, plus an all-in. */
const SIZINGS = [
  { label: '⅓', fraction: 1 / 3 },
  { label: '½', fraction: 0.5 },
  { label: '¾', fraction: 0.75 },
  { label: 'Pot', fraction: 1 },
]

export function ActionBar({
  state,
  heroSeat,
}: {
  /** Null before the first hand of the session is dealt. */
  state: HandState | null
  heroSeat: number
}) {
  const act = useStore((s) => s.act)
  const deal = useStore((s) => s.deal)
  const [custom, setCustom] = useState<number | null>(null)

  const yourTurn = state !== null && state.result === null && state.toAct === heroSeat
  const options = yourTurn ? legalActions(state) : []
  const hero = state?.seats[heroSeat]
  const pot = state === null ? 0 : potSize(state)
  const toCall = state === null || hero === undefined ? 0 : Math.max(0, state.currentBet - hero.committed)
  const raise = options.find((o) => o.type === 'raise')
  const canCheck = options.some((o) => o.type === 'check')
  const canCall = options.some((o) => o.type === 'call')
  const canFold = options.some((o) => o.type === 'fold')

  const sizeFor = (fraction: number) => {
    if (!raise || state === null) return 0
    // A pot-sized raise calls the outstanding bet first, then raises the pot
    // that call creates — the standard definition, not "bet the current pot".
    const target = state.currentBet + (pot + toCall) * fraction
    return Math.max(raise.min!, Math.min(raise.max!, Math.round(target)))
  }

  const amount = raise ? (custom ?? sizeFor(0.75)) : 0

  // The sizing resets between decisions: a slider left where the last spot put
  // it is a good way to jam a river for the flop's bet size.
  useEffect(() => {
    setCustom(null)
  }, [state?.street, state?.actions.length])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (!yourTurn) {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          deal()
        }
        return
      }

      switch (event.key.toLowerCase()) {
        case 'f':
          if (canFold) act({ type: 'fold' })
          break
        case 'c':
          if (canCheck) act({ type: 'check' })
          else if (canCall) act({ type: 'call' })
          break
        case 'r':
          if (raise) act({ type: 'raise', to: amount })
          break
        case 'a':
          if (raise) setCustom(raise.max!)
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [yourTurn, canFold, canCheck, canCall, raise, amount, act, deal])

  if (!yourTurn || hero === undefined || state === null) {
    const waiting = state !== null && state.result === null
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-3">
        <span className="text-xs text-slate-500">
          {state === null
            ? 'Six-max, no-limit hold’em. You are at the bottom of the table.'
            : waiting
              ? 'Waiting for the others…'
              : 'Hand over.'}
        </span>
        <button
          onClick={deal}
          disabled={waiting}
          className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-30"
        >
          Deal <span aria-hidden className="ml-1 text-[10px] opacity-70">space</span>
        </button>
      </div>
    )
  }

  const button =
    'flex-1 rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3">
      {raise && (
        <div className="flex flex-wrap items-center gap-2">
          {SIZINGS.map((s) => {
            const size = sizeFor(s.fraction)
            return (
              <button
                key={s.label}
                onClick={() => setCustom(size)}
                disabled={size <= raise.min! && s.fraction < 1 && size === amount}
                className={`rounded-md border px-2.5 py-1 text-xs transition ${
                  amount === size
                    ? 'border-emerald-500 bg-emerald-600/20 text-emerald-200'
                    : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {s.label}
              </button>
            )
          })}
          <button
            onClick={() => setCustom(raise.max!)}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              amount === raise.max
                ? 'border-rose-500 bg-rose-600/20 text-rose-200'
                : 'border-slate-700 text-slate-300 hover:bg-slate-800'
            }`}
          >
            All in <span aria-hidden className="opacity-60">a</span>
          </button>

          <input
            type="range"
            min={raise.min}
            max={raise.max}
            value={amount}
            onChange={(e) => setCustom(Number(e.target.value))}
            className="ml-1 min-w-24 flex-1 accent-emerald-500"
            aria-label="Bet size"
          />
          <input
            type="number"
            min={raise.min}
            max={raise.max}
            value={amount}
            onChange={(e) =>
              setCustom(
                Math.max(raise.min!, Math.min(raise.max!, Math.round(Number(e.target.value)))),
              )
            }
            className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-xs"
            aria-label="Bet amount"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          className={`${button} bg-slate-700 hover:bg-slate-600`}
          disabled={!canFold}
          onClick={() => act({ type: 'fold' })}
        >
          Fold <span aria-hidden className="text-[10px] opacity-60">f</span>
        </button>

        {canCheck ? (
          <button
            className={`${button} bg-sky-700 hover:bg-sky-600`}
            onClick={() => act({ type: 'check' })}
          >
            Check <span aria-hidden className="text-[10px] opacity-60">c</span>
          </button>
        ) : (
          <button
            className={`${button} bg-sky-700 hover:bg-sky-600`}
            disabled={!canCall}
            onClick={() => act({ type: 'call' })}
          >
            Call {Math.min(toCall, hero.stack)} <span aria-hidden className="text-[10px] opacity-60">c</span>
          </button>
        )}

        <button
          className={`${button} bg-emerald-600 hover:bg-emerald-500`}
          disabled={!raise}
          onClick={() => raise && act({ type: 'raise', to: amount })}
        >
          {state.currentBet > 0 ? 'Raise to' : 'Bet'} {raise ? amount : '—'}{' '}
          <span aria-hidden className="text-[10px] opacity-60">r</span>
        </button>
      </div>
    </div>
  )
}
