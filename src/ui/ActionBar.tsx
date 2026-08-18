import { useEffect, useState } from 'react'
import { legalActions } from '../engine/hand'
import { potSize, type Action, type HandState } from '../engine/types'
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
  best,
}: {
  /** Null before the first hand of the session is dealt. */
  state: HandState | null
  heroSeat: number
  /** The highest-value action, when the coach is running live. */
  best?: Action | undefined
}) {
  const act = useStore((s) => s.act)
  const deal = useStore((s) => s.deal)
  const [custom, setCustom] = useState<number | null>(null)

  const yourTurn = state !== null && state.result === null && state.toAct === heroSeat
  const options = yourTurn ? legalActions(state) : []
  const hero = state?.seats[heroSeat]
  const pot = state === null ? 0 : potSize(state)
  // What continuing costs *this* stack. A stack too short to cover the bet
  // pays what it has, so quoting the bet would name a price it cannot pay —
  // and the call button already says the real one.
  const toCall =
    state === null || hero === undefined
      ? 0
      : Math.min(Math.max(0, state.currentBet - hero.committed), hero.stack)
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
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 shadow-lg shadow-black/40 sm:bg-slate-950/80 sm:shadow-none">
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
    'relative flex-1 rounded-lg px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-30 disabled:cursor-not-allowed'

  // The recommendation is marked on the control it recommends, because that is
  // where somebody is looking when they need it. A recommended raise marks the
  // raise button whatever the slider says, and names the size it means — the
  // advice is "raise, and this much", and hiding it until the slider happens to
  // agree would mark nothing most of the time.
  const recommended = (type: Action['type']) =>
    best?.type === type ? ' ring-2 ring-emerald-300 ring-offset-2 ring-offset-slate-950' : ''

  const bestBadge = (type: Action['type']) =>
    best?.type === type ? (
      <span
        aria-hidden
        className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-300 px-2 text-[10px] font-bold text-emerald-950"
      >
        {best.type === 'raise' && best.to !== amount ? `best: ${best.to}` : 'best'}
      </span>
    ) : null

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950 p-3 shadow-lg shadow-black/40 sm:bg-slate-950/80 sm:shadow-none">
      {/* What the situation is, in one line, before what to do about it. */}
      <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
        <span className="font-medium text-amber-300">Your turn</span>
        <span className="text-slate-400">
          {toCall > 0 ? `${toCall} to call into a pot of ${pot}` : `nothing to call · pot ${pot}`}
        </span>
      </div>

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

          {/* The size the coach would use, one click away. */}
          {best?.type === 'raise' && best.to !== amount && (
            <button
              onClick={() => setCustom(best.to)}
              className="rounded-md border border-emerald-500 px-2.5 py-1 text-xs text-emerald-200 transition hover:bg-emerald-900/40"
            >
              Best {best.to}
            </button>
          )}

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
          className={`${button} bg-slate-700 hover:bg-slate-600${recommended('fold')}`}
          disabled={!canFold}
          onClick={() => act({ type: 'fold' })}
        >
          {bestBadge('fold')}
          Fold <span aria-hidden className="text-[10px] opacity-60">f</span>
        </button>

        {canCheck ? (
          <button
            className={`${button} bg-sky-700 hover:bg-sky-600${recommended('check')}`}
            onClick={() => act({ type: 'check' })}
          >
            {bestBadge('check')}
            Check <span aria-hidden className="text-[10px] opacity-60">c</span>
          </button>
        ) : (
          <button
            className={`${button} bg-sky-700 hover:bg-sky-600${recommended('call')}`}
            disabled={!canCall}
            onClick={() => act({ type: 'call' })}
          >
            {bestBadge('call')}
            Call {toCall} <span aria-hidden className="text-[10px] opacity-60">c</span>
          </button>
        )}

        <button
          className={`${button} bg-emerald-600 hover:bg-emerald-500${recommended('raise')}`}
          disabled={!raise}
          onClick={() => raise && act({ type: 'raise', to: amount })}
        >
          {bestBadge('raise')}
          {state.currentBet > 0 ? 'Raise to' : 'Bet'} {raise ? amount : '—'}{' '}
          <span aria-hidden className="text-[10px] opacity-60">r</span>
        </button>
      </div>
    </div>
  )
}
