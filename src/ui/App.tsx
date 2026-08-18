import { useEffect, useState } from 'react'
import { describe } from '../engine/evaluator'
import { ActionBar } from './ActionBar'
import { Dashboard } from './Dashboard'
import { OddsPanel } from './OddsPanel'
import { Reflection } from './Reflection'
import { SessionCard } from './SessionCard'
import { Table } from './Table'
import { useStore, type Speed } from './store'

/**
 * The shell.
 *
 * Two screens rather than one long column: the table, which is what somebody
 * is doing, and their progress, which is why they are doing it. Putting the
 * dashboard under the table meant every hand ended with a wall of statistics
 * between the player and the next hand.
 */

function ResultBanner() {
  const session = useStore((s) => s.session)
  useStore((s) => s.version)
  const state = session.current
  if (!state?.result) return null

  const heroSeat = session.config.heroSeat
  const net = state.result.net[heroSeat]!
  const heroValue = state.result.handValues[heroSeat]

  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-3 rounded-xl border px-4 py-2.5 ${
        net > 0
          ? 'border-emerald-700/70 bg-emerald-950/50'
          : net < 0
            ? 'border-rose-900/70 bg-rose-950/40'
            : 'border-slate-800 bg-slate-900/50'
      }`}
      role="status"
    >
      <span className="font-semibold">
        {net > 0 ? `You won ${net}` : net < 0 ? `You lost ${-net}` : 'You broke even'}
      </span>
      {heroValue !== null && heroValue !== undefined && (
        <span className="text-sm text-slate-400">You held {describe(heroValue)}.</span>
      )}
    </div>
  )
}

function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="flex rounded-lg border border-slate-800 p-0.5 text-xs" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-2.5 py-1 transition ${
            value === option.value ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function App() {
  const session = useStore((s) => s.session)
  useStore((s) => s.version)
  const hudLevel = useStore((s) => s.hudLevel)
  const setHudLevel = useStore((s) => s.setHudLevel)
  const speed = useStore((s) => s.speed)
  const setSpeed = useStore((s) => s.setSpeed)
  const loadHistory = useStore((s) => s.loadHistory)
  const storedHands = useStore((s) => s.storedHands)
  const [screen, setScreen] = useState<'table' | 'progress'>('table')

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const state = session.current
  const handOver = state === null || state.result !== null
  const heroSeat = session.config.heroSeat

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">stat-poker</h1>
          <p className="text-xs text-slate-500">
            Hand {session.handNumber} · {session.config.smallBlind}/{session.config.bigBlind}{' '}
            · stack {session.stacks[heroSeat]}
            {storedHands > 0 && ` · ${storedHands.toLocaleString('en-US')} hands recorded`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Toggle
            label="Screen"
            value={screen}
            onChange={setScreen}
            options={[
              { value: 'table', label: 'Table' },
              { value: 'progress', label: 'Progress' },
            ]}
          />
          <Toggle
            label="Odds overlay"
            value={hudLevel}
            onChange={setHudLevel}
            options={[
              { value: 'full', label: 'Odds' },
              { value: 'predict', label: 'Guess' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <Toggle
            label="Speed"
            value={speed}
            onChange={(value: Speed) => setSpeed(value)}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
          />
        </div>
      </header>

      {screen === 'table' ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            <Table session={session} />
            <ActionBar state={state} heroSeat={heroSeat} />
            <ResultBanner />
            {handOver && session.history.length > 0 && (
              <Reflection
                record={session.history[session.history.length - 1]!}
                heroSeat={heroSeat}
              />
            )}
          </div>

          {/* The coaching sits beside the table rather than under it, so the
              numbers are visible at the moment they are about to be used. */}
          <aside className="space-y-3">
            {state && !handOver && hudLevel !== 'off' ? (
              <OddsPanel state={state} heroSeat={heroSeat} />
            ) : (
              hudLevel === 'off' && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-500">
                  The odds overlay is off. Turn it back on above when you want the numbers
                  while you decide.
                </div>
              )
            )}
            <SessionCard session={session} />
          </aside>
        </div>
      ) : (
        <Dashboard session={session} />
      )}
    </div>
  )
}
