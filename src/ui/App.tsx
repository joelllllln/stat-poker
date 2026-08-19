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
import { InfoTabs, type InfoTab } from './InfoTabs'
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
            className={`min-h-11 touch-manipulation rounded px-3 transition sm:min-h-8 ${
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

/**
 * What the letters on the table mean.
 *
 * Every seat wears a two-letter code that the whole game is built around and
 * that nobody arrives knowing. There is no room on a seat plate the width of a
 * thumb to spell them out, so they are spelled out once, here, where there is
 * room — and the seat you are in is named in full on the controls every time
 * it is your turn, which is where the mapping actually gets learnt.
 */
function SeatKey() {
  const seats: [string, string][] = [
    ['BTN', 'the dealer — acts last after the flop, the best seat'],
    ['SB', 'small blind — pays half a blind before the cards'],
    ['BB', 'big blind — pays a full blind before the cards'],
    ['UTG', 'first to act, with everybody still to come'],
    ['HJ', 'two seats before the dealer'],
    ['CO', 'one seat before the dealer'],
  ]
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">
        The letters on the table
      </div>
      <dl className="mt-1 space-y-0.5">
        {seats.map(([code, meaning]) => (
          <div key={code} className="flex gap-2 text-[11px] leading-snug">
            <dt className="w-9 shrink-0 font-mono text-slate-300">{code}</dt>
            <dd className="text-slate-400">{meaning}</dd>
          </div>
        ))}
      </dl>
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
  const adviceLive = useStore((s) => s.adviceLive)
  const setAdviceLive = useStore((s) => s.setAdviceLive)
  const loadHistory = useStore((s) => s.loadHistory)
  const storedHands = useStore((s) => s.storedHands)
  const [screen, setScreen] = useState<'table' | 'progress'>('table')
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  // Two panels, not four.
  //
  // Everything needed to make the decision in front of you belongs together
  // and in front of you: what your hand is worth, what the price is, what to
  // do and why. Splitting those across a "Coach" tab and an "Odds" tab meant
  // reading half the argument, tapping, and reading the other half — and the
  // second half is the one that justifies the first. What is left is the
  // record: what has happened in this hand, and how the session is going.
  const acting = adviceLive && yourTurn && !adviceHidden
  const showOdds = state !== null && !handOver && hudLevel !== 'off'
  const panels: InfoTab[] = []

  panels.push({
    id: 'do',
    label: 'What to do',
    badge: acting && advice?.options[0] ? 'best' : undefined,
    content: (
      <div className="space-y-2">
        {acting && (
          <Advice advice={advice} pending={advicePending} bigBlind={session.config.bigBlind} />
        )}
        {showOdds && state && <OddsPanel state={state} heroSeat={heroSeat} />}
        {!acting && !showOdds && (
          <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-500">
            {state === null
              ? 'Deal a hand and this is where the odds and the advice appear.'
              : 'Nothing to decide right now.'}
          </p>
        )}
      </div>
    ),
  })

  panels.push({
    id: 'hand',
    label: 'The record',
    content: (
      <div className="space-y-2">
        {state && <ActionLog state={state} heroSeat={heroSeat} />}
        <SeatKey />
        <SessionCard session={session} />
      </div>
    ),
  })

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-2 p-2 sm:gap-3 sm:p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
          <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
            stat-poker
          </h1>
          {/* Three facts fit a phone header; the words around them do not. */}
          <p className="truncate text-[11px] leading-tight text-slate-500 sm:text-xs">
            Hand {session.handNumber} ·<span className="hidden sm:inline"> blinds</span>{' '}
            {session.config.smallBlind}/{session.config.bigBlind} ·
            <span className="hidden sm:inline"> stack</span> {session.stacks[heroSeat]}
            {storedHands > 0 && (
              <span className="hidden sm:inline">
                {` · ${storedHands.toLocaleString('en-US')} hand${storedHands === 1 ? '' : 's'} recorded`}
              </span>
            )}
          </p>
        </div>

        {/* The two screens are a choice about where you are; the rest are
            settings for the table. Kept apart so they do not read as one row
            of six equal buttons. */}
        <nav
          className="flex shrink-0 rounded-lg border border-slate-800 p-0.5 text-sm"
          aria-label="Screen"
        >
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
              className={`min-h-11 touch-manipulation rounded px-5 transition sm:min-h-9 ${
                screen === tab.value
                  ? 'bg-slate-700 font-medium text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {screen === 'table' && (
          <button
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            className={`min-h-11 min-w-11 shrink-0 touch-manipulation rounded-lg border border-slate-800 text-slate-400 transition sm:hidden ${
              settingsOpen ? 'bg-slate-800 text-white' : ''
            }`}
            aria-label="Settings"
          >
            ⚙
          </button>
        )}
      </header>

      {screen === 'table' && (
        // Folded away on a phone, where six settings buttons would cost a
        // third of the screen the game is played on.
        <div
          className={`${settingsOpen ? '' : 'hidden'} rounded-xl border border-slate-800 sm:block sm:border-0`}
        >
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 p-3 sm:p-0">
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
        </div>
      )}

      {screen === 'table' ? (
        <div className="grid gap-2 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-2 sm:space-y-3">
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

            {/* On a phone the same panels are one at a time, directly under
                the controls, so the whole game stays on one screen. */}
            <div className="lg:hidden">
              <InfoTabs tabs={panels} />
            </div>

            {handOver && session.history.length > 0 && (
              <Reflection
                record={session.history[session.history.length - 1]!}
                heroSeat={heroSeat}
              />
            )}
          </div>

          {/* Where there is room, the coaching sits beside the table, so the
              numbers are visible at the moment they are about to be used. */}
          <aside className="hidden space-y-3 lg:block">
            {panels.map((panel) => (
              <div key={panel.id}>{panel.content}</div>
            ))}
          </aside>
        </div>
      ) : (
        <Dashboard session={session} />
      )}
    </div>
  )
}
