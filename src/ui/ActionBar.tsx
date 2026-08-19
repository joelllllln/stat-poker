import { useEffect, useState } from 'react'
import { legalActions } from '../engine/hand'
import { potSize, type Action, type HandState } from '../engine/types'
import { madeHandInWords, priceInWords } from './plain'
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
          className="min-h-12 touch-manipulation rounded-lg bg-emerald-600 px-6 text-base font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-30 sm:min-h-10 sm:text-sm"
        >
          Deal <span aria-hidden className="ml-1 text-[10px] opacity-70">space</span>
        </button>
      </div>
    )
  }

  const button =
    'relative min-h-14 flex-1 touch-manipulation whitespace-nowrap rounded-lg px-3 text-base font-semibold text-white transition disabled:opacity-30 disabled:cursor-not-allowed sm:min-h-12 sm:px-4 sm:text-sm'

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
    <div className="space-y-1 rounded-xl border border-slate-800 bg-slate-950 p-2 shadow-lg shadow-black/40 sm:space-y-2 sm:bg-slate-950/80 sm:p-3 sm:shadow-none">
      {/* What the situation is, before what to do about it: what you are
          holding, whose turn it is, and what the price is — said in words,
          because "19 to call into a pot of 32" is only a sentence if you
          already know what it implies.

          All of it in this block rather than in a panel of its own. The
          controls have to stay above the fold on a 740-pixel phone, and a
          separate card for one line of text costs its own border, padding and
          gap and pushed them off the bottom. */}
      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        <span className="font-medium text-amber-300">Your turn</span>
        {hero.holeCards && (
          <span className="font-medium text-amber-100">
            · you have {madeHandInWords(hero.holeCards, state.board)}
          </span>
        )}
        {/* The price is said once, in words. Quoting "36 to call into a pot
            of 93" beside "it costs 36 to win 129" is the same fact twice in
            two notations, and the felt already shows the pot. */}
        <span className="w-full text-[11px] leading-snug text-slate-400">
          {priceInWords(toCall, pot + toCall)}
        </span>
      </div>

      {raise && (
        // Two rows, always: the fractions, then the slider with the amount and
        // the coach's size. Left to wrap on its own it becomes three rows on a
        // narrow phone and pushes the buttons off the screen.
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            {SIZINGS.map((s) => {
              const size = sizeFor(s.fraction)
              return (
                <button
                  key={s.label}
                  onClick={() => setCustom(size)}
                  disabled={size <= raise.min! && s.fraction < 1 && size === amount}
                  className={`min-h-11 flex-1 touch-manipulation rounded-md border text-sm transition sm:min-h-9 sm:flex-none sm:px-3 sm:text-xs ${
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
              className={`min-h-11 flex-1 touch-manipulation whitespace-nowrap rounded-md border text-sm transition sm:min-h-9 sm:flex-none sm:px-3 sm:text-xs ${
                amount === raise.max
                  ? 'border-rose-500 bg-rose-600/20 text-rose-200'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              All in <span aria-hidden className="opacity-60">a</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min={raise.min}
              max={raise.max}
              value={amount}
              onChange={(e) => setCustom(Number(e.target.value))}
              className="h-11 min-w-16 flex-1 touch-manipulation accent-emerald-500 sm:h-auto"
              aria-label="Bet size"
            />
            <span className="w-10 shrink-0 text-right font-mono text-sm text-slate-200 sm:hidden">
              {amount}
            </span>
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
              className="hidden min-h-9 w-20 rounded-md border border-slate-700 bg-slate-900 px-2 text-right font-mono text-xs sm:block"
              aria-label="Bet amount"
            />

            {/* The size the coach would use, one tap away. */}
            {best?.type === 'raise' && best.to !== amount && (
              <button
                onClick={() => setCustom(best.to)}
                className="min-h-11 shrink-0 touch-manipulation whitespace-nowrap rounded-md border border-emerald-500 px-3 text-sm text-emerald-200 transition hover:bg-emerald-900/40 sm:min-h-9 sm:text-xs"
              >
                Best {best.to}
              </button>
            )}
          </div>
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
          {/* "Raise to 17" wraps on a narrow phone and makes the row taller;
              the preposition is the part nobody needs. */}
          {state.currentBet > 0 ? (
            <>
              Raise<span className="hidden sm:inline"> to</span>
            </>
          ) : (
            'Bet'
          )}{' '}
          {raise ? amount : '—'} <span aria-hidden className="text-[10px] opacity-60">r</span>
        </button>
      </div>
    </div>
  )
}
