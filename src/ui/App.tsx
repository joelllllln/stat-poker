import { describe } from '../engine/evaluator'
import { aggregate } from '../stats/hand-stats'
import { recordsForSeat } from '../game/session'
import { ActionBar } from './ActionBar'
import { OddsPanel } from './OddsPanel'
import { Table } from './Table'
import { useStore } from './store'

function SessionStats() {
  const session = useStore((s) => s.session)
  useStore((s) => s.version)

  const heroSeat = session.config.heroSeat
  const stats = aggregate(recordsForSeat(session, heroSeat), session.config.bigBlind)
  if (stats.hands === 0) return null

  // Rates need a sample before they mean anything; saying so is part of the
  // product rather than a caveat bolted on later.
  const reliable = stats.hands >= 50

  const cells = [
    { label: 'Hands', value: String(stats.hands) },
    { label: 'VPIP', value: `${stats.vpip.toFixed(0)}%` },
    { label: 'PFR', value: `${stats.pfr.toFixed(0)}%` },
    { label: 'WTSD', value: `${stats.wtsd.toFixed(0)}%` },
    { label: 'AF', value: stats.aggressionFactor.toFixed(1) },
    { label: 'bb/100', value: stats.bbPer100.toFixed(0) },
  ]

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Your session</span>
        {!reliable && (
          <span className="text-[11px] text-amber-500/80">
            too few hands to read anything into
          </span>
        )}
      </div>
      <div className={`grid grid-cols-3 gap-2 sm:grid-cols-6 ${reliable ? '' : 'opacity-50'}`}>
        {cells.map((c) => (
          <div key={c.label}>
            <div className="text-[11px] text-slate-500">{c.label}</div>
            <div className="font-mono text-sm">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

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
      <SessionStats />
    </div>
  )
}
