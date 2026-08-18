import { useEffect } from 'react'
import { describe } from '../engine/evaluator'
import { ActionBar } from './ActionBar'
import { Dashboard } from './Dashboard'
import { OddsPanel } from './OddsPanel'
import { Reflection } from './Reflection'
import { Table } from './Table'
import { useStore } from './store'

function HandResult() {
  const session = useStore((s) => s.session)
  useStore((s) => s.version)
  const state = session.current
  if (!state?.result) return null

  const heroSeat = session.config.heroSeat
  const net = state.result.net[heroSeat]!
  const heroValue = state.result.handValues[heroSeat]

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        net > 0
          ? 'border-emerald-800 bg-emerald-950/40'
          : net < 0
            ? 'border-rose-900 bg-rose-950/30'
            : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      <div className="font-medium">
        {net > 0 ? `You won ${net}` : net < 0 ? `You lost ${-net}` : 'You broke even'}
      </div>
      {heroValue !== null && heroValue !== undefined && (
        <div className="text-sm text-slate-400">You held {describe(heroValue)}.</div>
      )}
    </div>
  )
}

export function App() {
  const session = useStore((s) => s.session)
  useStore((s) => s.version)
  const deal = useStore((s) => s.deal)
  const hudLevel = useStore((s) => s.hudLevel)
  const setHudLevel = useStore((s) => s.setHudLevel)
  const showReview = useStore((s) => s.showReview)
  const toggleReview = useStore((s) => s.toggleReview)
  const loadHistory = useStore((s) => s.loadHistory)

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const state = session.current
  const handOver = state === null || state.result !== null
  const heroSeat = session.config.heroSeat

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">stat-poker</h1>
          <p className="text-xs text-slate-500">
            Hand {session.handNumber} · stack {session.stacks[heroSeat]} · blinds{' '}
            {session.config.smallBlind}/{session.config.bigBlind}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-800 p-0.5 text-xs">
            {(['full', 'predict', 'off'] as const).map((level) => (
              <button
                key={level}
                onClick={() => setHudLevel(level)}
                className={`rounded px-2 py-1 capitalize ${
                  hudLevel === level ? 'bg-slate-700 text-white' : 'text-slate-400'
                }`}
              >
                {level}
              </button>
            ))}
          </div>
          <button
            onClick={toggleReview}
            className={`rounded-lg border px-3 py-2 text-xs ${
              showReview ? 'border-slate-700 text-slate-200' : 'border-slate-800 text-slate-500'
            }`}
          >
            Review
          </button>
          <button
            onClick={deal}
            disabled={!handOver}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium hover:bg-emerald-600 disabled:opacity-30"
          >
            Deal
          </button>
        </div>
      </header>

      <Table session={session} />

      {state && !handOver && hudLevel !== 'off' && (
        <OddsPanel state={state} heroSeat={heroSeat} />
      )}
      {state && <ActionBar state={state} heroSeat={heroSeat} />}
      <HandResult />
      {handOver && session.history.length > 0 && (
        <Reflection record={session.history[session.history.length - 1]!} heroSeat={heroSeat} />
      )}
      <Dashboard session={session} />
    </div>
  )
}
