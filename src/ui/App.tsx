import { useEffect, useState } from 'react'
import { describe } from '../engine/evaluator'
import { ActionBar } from './ActionBar'
import { ActionLog } from './ActionLog'
import { Advice } from './Advice'
import { Dashboard } from './Dashboard'
import { OddsPanel } from './OddsPanel'
import { Reflection } from './Reflection'
import { SessionCard } from './SessionCard'
import { Table } from './Table'
import { useStore, type Speed } from './store'
import { useAdvice } from './useAnalysis'

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

/**
 * A labelled choice.
 *
 * The label is not decoration: a row of unlabelled segmented controls makes
 * somebody guess what each one governs, and guessing is the opposite of what
 * this app is for.
 */
function Toggle<T extends string>({
  options,
  value,
  onChange,
  label,
  hint,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs" title={hint}>
      <span className="text-slate-500">{label}</span>
      <span className="flex rounded-lg border border-slate-800 p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={`rounded px-2.5 py-1 transition ${
              value === option.value
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </span>
    </label>
  )
}

export function App() {
  const session = useStore((s) => s.session)
  useStore((s) => s.version)
  const hudLevel = useStore((s) => s.hudLevel)
  const setHudLevel = useStore((s) => s.setHudLevel)
  const speed = useStore((s) => s.speed)
  const setSpeed = useStore((s) => s.setSpeed)
  const adviceLive = useStore((s) => s.adviceLive)
  const setAdviceLive = useStore((s) => s.setAdviceLive)
  const loadHistory = useStore((s) => s.loadHistory)
  const storedHands = useStore((s) => s.storedHands)
  const [screen, setScreen] = useState<'table' | 'progress'>('table')

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const state = session.current
  const handOver = state === null || state.result !== null
  const heroSeat = session.config.heroSeat
  const yourTurn = state !== null && state.result === null && state.toAct === heroSeat

  // In predict-then-reveal the guess comes first, so the answer waits.
  const guess = useStore((s) => s.guess)
  const adviceHidden = hudLevel === 'predict' && guess === null
  const { advice, pending: advicePending } = useAdvice(
    adviceLive && yourTurn && !adviceHidden && state !== null
      ? { state, heroSeat, startingStacks: session.currentStartingStacks }
      : null,
  )

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <h1 className="whitespace-nowrap text-lg font-semibold tracking-tight">stat-poker</h1>
          <p className="text-xs text-slate-500">
            Hand {session.handNumber} · blinds {session.config.smallBlind}/
            {session.config.bigBlind} · your stack {session.stacks[heroSeat]}
            {storedHands > 0 &&
              ` · ${storedHands.toLocaleString('en-US')} hand${storedHands === 1 ? '' : 's'} recorded`}
          </p>
        </div>

        {/* The two screens are a choice about where you are; the rest are
            settings for the table. Kept apart so they do not read as one row
            of six equal buttons. */}
        <nav className="flex rounded-lg border border-slate-800 p-0.5 text-sm" aria-label="Screen">
          {(
            [
              { value: 'table', label: 'Table' },
              { value: 'progress', label: 'Progress' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.value}
              onClick={() => setScreen(tab.value)}
              aria-current={screen === tab.value ? 'page' : undefined}
              className={`rounded px-4 py-1.5 transition ${
                screen === tab.value
                  ? 'bg-slate-700 font-medium text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {screen === 'table' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Toggle
            label="Odds"
            hint="Show the numbers while you decide, ask you to guess them first, or hide them."
            value={hudLevel}
            onChange={setHudLevel}
            options={[
              { value: 'full', label: 'Show' },
              { value: 'predict', label: 'Guess first' },
              { value: 'off', label: 'Hide' },
            ]}
          />
          <Toggle
            label="Coach"
            hint="Say what the highest-value action is while you are deciding, or leave it to the review after the hand."
            value={adviceLive ? 'live' : 'after'}
            onChange={(value) => setAdviceLive(value === 'live')}
            options={[
              { value: 'live', label: 'While I play' },
              { value: 'after', label: 'After the hand' },
            ]}
          />
          <Toggle
            label="Bot speed"
            hint="How long the other players take to act."
            value={speed}
            onChange={(value: Speed) => setSpeed(value)}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
          />
          {/* Only worth saying where there is a keyboard to press. */}
          <span className="hidden text-xs text-slate-600 sm:inline">
            Keys: F fold · C check or call · R raise · A all in · Space deal
          </span>
        </div>
      )}

      {screen === 'table' ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            <Table session={session} />
            {/* Deliberately in the flow rather than floating: a bar that
                hovers over the page covers whatever is under it, and the
                controls sit directly below the table anyway. */}
            <ActionBar
              state={state}
              heroSeat={heroSeat}
              {...(adviceLive && !adviceHidden && advice?.options[0]
                ? { best: advice.options[0].action }
                : {})}
            />
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
            {adviceLive && yourTurn && !adviceHidden && (
              <Advice
                advice={advice}
                pending={advicePending}
                bigBlind={session.config.bigBlind}
              />
            )}
            {state && <ActionLog state={state} heroSeat={heroSeat} />}
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
