import { useMemo } from 'react'
import { winnablePot } from '../engine/hand'
import { potSize, type HandState } from '../engine/types'
import { modelledWidth } from '../equity/opponent'
import { preflopStrength, topPercentRange } from '../equity/preflop'
import { classOf } from '../solver/blueprint'
import { RangeGrid } from './RangeGrid'
import { useEquity } from './useAnalysis'
import { inBigBlinds, potOddsRatio, requiredEquity, stackToPotRatio } from '../coach/odds'
import { madeHandInWords, priceInWords, strengthInWords, timesInTen } from './plain'
import { useStore } from './store'

/**
 * Live odds for the decision in front of you.
 *
 * Two numbers decide most poker decisions — what your hand is worth, and what
 * the price demands — so those two are the panel, in plain words, and
 * everything else is folded away behind one disclosure. A panel of nine
 * numbers is not more informative than a panel of two; it is less, because
 * nobody reads nine numbers while deciding whether to call.
 *
 * Equity is always measured against the opponents' modelled ranges, never
 * against random cards — a number computed against random cards trains the
 * wrong instinct, however good it looks on screen.
 */

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

function Tile({
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
    tone === 'good' ? 'text-[color:var(--color-brass-bright)]' : tone === 'bad' ? 'text-rose-300' : 'text-[color:var(--color-bone)]'
  return (
    <div className="plate px-3 py-2">
      <div className="stamp">{label}</div>
      <div className={`font-mono text-xl ${colour}`}>{value}</div>
      {hint && <div className="text-[11px] text-[color:var(--color-bone-faint)]">{hint}</div>}
    </div>
  )
}

function Detail({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[color:var(--color-ink-4)]/70 py-1.5 last:border-0">
      <span className="text-xs text-[color:var(--color-bone-dim)]">{label}</span>
      <span className="text-right">
        <span className="font-mono text-sm text-[color:var(--color-bone)]">{value}</span>
        <span className="ml-2 text-[11px] text-[color:var(--color-bone-faint)]">{hint}</span>
      </span>
    </div>
  )
}

export function OddsPanel({ state, heroSeat }: { state: HandState; heroSeat: number }) {
  const hudLevel = useStore((s) => s.hudLevel)
  const guess = useStore((s) => s.guess)
  const submitGuess = useStore((s) => s.submitGuess)

  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  // What continuing costs and what it plays for. A stack too short to cover
  // the bet pays only what it has, and can only win what the bettor matched:
  // quoting the price of a bet you cannot make is quoting the wrong price.
  const toCall = Math.min(Math.max(0, state.currentBet - hero.committed), hero.stack)
  const winnable = winnablePot(state, heroSeat, toCall)

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
      withOuts: true,
    }
  }, [hero.holeCards, hero.status, widths, state.board])

  const { result: equity, pending } = useEquity(query)

  if (!equity) {
    return pending ? (
      <div className="plate px-3 py-2 text-xs text-[color:var(--color-bone-faint)]">
        Working out the odds…
      </div>
    ) : null
  }

  const needed = requiredEquity(toCall, winnable)
  const callIsCorrect = toCall > 0 && equity.equity >= needed
  const effectiveStack = Math.min(
    hero.stack,
    ...state.seats.filter((s) => s.index !== heroSeat && s.status !== 'folded').map((s) => s.stack),
  )

  const hidden = hudLevel === 'predict' && guess === null

  return (
    <div className="space-y-3 plate p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="stamp">
          This decision
        </span>
        {pending && <span className="text-[11px] text-slate-600">updating…</span>}
      </div>

      {hudLevel === 'predict' && (
        <div className="plate px-3 py-2">
          <div className="text-xs text-[color:var(--color-bone-dim)]">
            {guess === null
              ? 'Estimate your equity before the numbers appear.'
              : `You guessed ${guess}% — actual ${pct(equity.equity)} (off by ${Math.abs(guess - equity.equity * 100).toFixed(1)} points).`}
          </div>
          {guess === null && (
            <div className="mt-2 flex flex-wrap gap-1">
              {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((value) => (
                <button
                  key={value}
                  onClick={() => submitGuess(value, equity.equity, state.street, state.board.length)}
                  className="rounded bg-black/40 px-2 py-1 text-xs"
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
          {/* The sentence first. Everything under it is the working. */}
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              toCall === 0
                ? 'border-[color:var(--color-ink-4)] bg-black/25 text-[color:var(--color-bone-dim)]'
                : callIsCorrect
                  ? 'border-emerald-800 bg-emerald-950/40 text-[color:var(--color-brass-bright)]'
                  : 'border-rose-900 bg-rose-950/40 text-rose-200'
            }`}
          >
            {/* Said in words first. A beginner reading "85.1%" does not know
                what it is 85.1% of, whether that is good, or what to do about
                it — and those are the only three things they need. */}
            <p className="font-medium">
              You have {madeHandInWords(hero.holeCards!, state.board)} —{' '}
              {strengthInWords(equity.equity)}.
            </p>
            <p className="mt-1 text-[13px] leading-snug opacity-90">
              You would win this {timesInTen(equity.equity)} if it went all the way.{' '}
              {toCall === 0
                ? 'Nobody has bet, so it costs nothing to see the next card.'
                : `${priceInWords(toCall, winnable)} So the price is ${callIsCorrect ? 'good' : 'bad'}.`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Tile
              label="Your hand is worth"
              value={pct(equity.equity)}
              hint={`${timesInTen(equity.equity)}${
                equity.exact ? '' : `, give or take ${(equity.errorMargin * 100).toFixed(1)} points`
              }`}
            />
            <Tile
              label="Calling needs"
              value={toCall > 0 ? pct(needed) : '—'}
              hint={toCall > 0 ? `${toCall} to call · ${potOddsRatio(toCall, winnable)}` : 'no bet to face'}
              tone={toCall > 0 ? (callIsCorrect ? 'good' : 'bad') : 'default'}
            />
          </div>

          {/* Everything else, for when somebody wants it. Closed by default:
              the two numbers above answer the question being asked. */}
          <details className="group rounded-lg border border-[color:var(--color-ink-4)] bg-black/40">
            <summary className="cursor-pointer list-none px-3 py-2 text-xs text-[color:var(--color-bone-dim)] hover:text-[color:var(--color-bone)]">
              <span className="group-open:hidden">Show the rest ▸</span>
              <span className="hidden group-open:inline">Hide the rest ▾</span>
            </summary>

            <div className="space-y-3 px-3 pb-3">
              <div>
                <Detail
                  label="Cards that put you ahead"
                  value={
                    equity.outs
                      ? String(equity.outs.cards.length)
                      : state.board.length >= 5
                        ? 'none to come'
                        : '…'
                  }
                  hint={
                    equity.outs
                      ? equity.outs.cards.length === 0
                        ? 'nothing gets you there'
                        : `${pct(equity.outs.byRiver)} by the river`
                      : 'outs'
                  }
                />
                <Detail
                  label="Stack against the pot"
                  value={pot > 0 ? stackToPotRatio(effectiveStack, pot).toFixed(1) : '—'}
                  hint={`${inBigBlinds(effectiveStack, state.bigBlind).toFixed(0)} big blinds behind`}
                />
                <Detail
                  label={state.board.length === 0 ? 'Starting hands you beat' : 'Chance you win outright'}
                  value={
                    state.board.length === 0
                      ? pct(preflopStrength(hero.holeCards!).percentile)
                      : pct(equity.win)
                  }
                  hint={state.board.length === 0 ? 'before any cards' : 'rather than chopping'}
                />
              </div>

              <div>
                <div className="stamp">
                  What they might hold
                </div>
                <div className="mt-1 space-y-1">
                  {widths.map((w) => (
                    <div key={w.name} className="flex items-center gap-2 text-xs">
                      <span className="w-14 shrink-0 truncate text-[color:var(--color-bone-dim)]">{w.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded bg-black/45">
                        <div
                          className="h-full bg-slate-500"
                          style={{ width: `${Math.min(100, w.width * 100)}%` }}
                        />
                      </div>
                      <span className="w-16 shrink-0 text-right font-mono text-[color:var(--color-bone-dim)]">
                        top {(w.width * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* The shape of the tightest range still in the hand, with your
                  own holding marked in it. */}
              <RangeGrid
                width={Math.min(...widths.map((w) => w.width))}
                title="The tightest of those ranges"
                highlight={hero.holeCards ? classOf(hero.holeCards) : undefined}
              />
            </div>
          </details>
        </>
      )}
    </div>
  )
}
