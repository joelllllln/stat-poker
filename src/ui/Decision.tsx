import { useMemo } from 'react'
import type { Card } from '../engine/cards'
import { legalActions, winnablePot } from '../engine/hand'
import { potSize, type HandState } from '../engine/types'
import { splitAgainstAll, type RangeSplit } from '../equity/breakdown'
import { modelledWidth } from '../equity/opponent'
import { parseRange } from '../equity/range'
import { preflopStrength, topPercentRange } from '../equity/preflop'
import { classOf } from '../solver/blueprint'
import { breakEvenFold, inBigBlinds, potOddsRatio, requiredEquity, stackToPotRatio } from '../coach/odds'
import type { AdviseReply } from '../workers/analysis.worker'
import { Dial, Key, RankedBars, StackedBar } from './Figures'
import { RangeGrid } from './RangeGrid'
import { useEquity } from './useAnalysis'
import { madeHandInWords, timesInTen } from './plain'
import { useStore } from './store'

/**
 * The decision, in one panel.
 *
 * This used to be two — one that priced the spot and one that said what to do
 * about it — and each of them tried to be complete on its own. The same two
 * numbers ended up on screen five times, three of them as sentences, and the
 * things a player cannot work out for themselves were nowhere.
 *
 * So: every fact once, in the smallest form that still reads. What the hand is
 * worth, what the price asks, what beats you and what it is made of, what the
 * best play is, and — where they apply — the two numbers that explain a bet
 * rather than merely price it: how often it has to work, and how deep you are
 * committed if you make it. Prose only where a number would not be understood
 * without it.
 */

const pct = (value: number) => `${Math.round(value * 100)}%`
const bb = (chips: number, bigBlind: number) => `${(chips / bigBlind).toFixed(1)}bb`

/** A label and a number on one line, which is most of this panel. */
function Line({
  label,
  value,
  tone = 'plain',
  note,
}: {
  label: string
  value: string
  tone?: 'plain' | 'good' | 'bad' | 'mark'
  note?: string
}) {
  const colour =
    tone === 'good'
      ? 'text-[color:var(--color-jade-bright)]'
      : tone === 'bad'
        ? 'text-[color:var(--color-oxblood-bright)]'
        : tone === 'mark'
          ? 'text-[color:var(--color-brass-bright)]'
          : 'text-[color:var(--color-bone)]'
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      {/* Wraps rather than truncates. A row whose label is cut to "Bet…" has
          spent its width saying nothing. */}
      <span className="min-w-0 text-[color:var(--color-bone-dim)]">{label}</span>
      <span className="shrink-0 text-right">
        <span className={`font-mono ${colour}`}>{value}</span>
        {note && <span className="ml-2 text-[11px] text-[color:var(--color-bone-faint)]">{note}</span>}
      </span>
    </div>
  )
}

/**
 * Your share against what the price asks for.
 *
 * One track, one fill, and a mark where the limit sits — a meter, not a chart.
 */
/**
 * What beats you, not just how often.
 *
 * A share on its own cannot tell you whether you are comfortably ahead or
 * either crushing or crushed, and those are different decisions. One bar in
 * three parts, and the two kinds of hand doing most of the beating named
 * underneath — which is the whole of range-reading in two lines.
 */
function AgainstTheirRange({ split }: { split: RangeSplit }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="stamp">Their range, right now</span>
        <span className="text-[11px] text-[color:var(--color-bone-dim)]">
          <span className="font-mono text-[color:var(--color-oxblood-bright)]">
            {pct(split.behind)}
          </span>{' '}
          has you
        </span>
      </div>
      <div className="mt-1">
        <StackedBar
          height={12}
          parts={[
            { key: 'ahead', share: split.ahead, colour: 'var(--chart-lead)', label: 'you lead' },
            { key: 'tied', share: split.tied, colour: 'var(--chart-cool)', label: 'chop' },
            { key: 'behind', share: split.behind, colour: 'var(--chart-behind)', label: 'has you' },
          ]}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
        <Key colour="var(--chart-lead)">you lead {pct(split.ahead)}</Key>
        {split.tied > 0.005 && <Key colour="var(--chart-cool)">chop {pct(split.tied)}</Key>}
      </div>
      {/* Each kind of hand on its own baseline. In one stacked bar a set at
          three per cent is a sliver you cannot see, and it is the reason you
          are folding. */}
      {split.beatenBy.length > 0 && (
        <div className="mt-2">
          <RankedBars rows={split.beatenBy.slice(0, 4).map((k) => ({ label: k.name, share: k.share }))} />
        </div>
      )}
    </div>
  )
}

/**
 * Before the flop there is no board to read, so the reading is the grid.
 *
 * The 169 starting hands in the layout every poker player already knows, with
 * the range still in the pot shaded and this hand marked in it. A percentage
 * says how wide they are; the grid says *which* hands, which is the thing a
 * number never manages — and it is a shape rather than another bar.
 *
 * Where nobody has acted yet there is nothing to shade: a seat that has only
 * posted a blind is holding everything, and 169 filled cells is a picture of
 * no information. The grid then shows only where this hand sits among the
 * 169, which is the thing that *is* knowable before anybody has done anything.
 */
function BeforeTheFlop({ hole, width }: { hole: readonly [Card, Card]; width: number }) {
  const narrowed = width < 0.9
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="stamp">{narrowed ? 'What they are playing' : 'Nobody has acted yet'}</span>
        <span className="font-mono text-[color:var(--color-bone-dim)]">
          {narrowed ? `top ${pct(width)}` : 'your hand marked'}
        </span>
      </div>
      <div className="mt-1">
        <RangeGrid width={narrowed ? width : 0} highlight={classOf(hole)} />
      </div>
    </div>
  )
}

export function Decision({
  state,
  heroSeat,
  advice,
  advicePending,
  showOdds,
}: {
  state: HandState
  heroSeat: number
  /** Null when the coach is switched off, or still working. */
  advice: AdviseReply | null
  advicePending: boolean
  /** False when the odds overlay is switched off. */
  showOdds: boolean
}) {
  const hudLevel = useStore((s) => s.hudLevel)
  const guess = useStore((s) => s.guess)
  const submitGuess = useStore((s) => s.submitGuess)

  const hero = state.seats[heroSeat]!
  const pot = potSize(state)
  const toCall = Math.min(Math.max(0, state.currentBet - hero.committed), hero.stack)
  const winnable = winnablePot(state, heroSeat, toCall)
  const needed = requiredEquity(toCall, winnable)

  const live = state.seats.filter((s) => s.index !== heroSeat && s.status !== 'folded')
  const widths = useMemo(
    () => live.map((s) => ({ name: s.name, width: modelledWidth(state, s.index) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // The same modelled ranges the equity is measured against, split by what
  // they actually hold on this board. Cheap enough to do here: a few hundred
  // five-card evaluations, once per decision.
  const split = useMemo(() => {
    if (!hero.holeCards || state.board.length < 3 || widths.length === 0) return null
    return splitAgainstAll(
      hero.holeCards,
      state.board,
      widths.map((w) => parseRange(topPercentRange(w.width))),
    )
  }, [hero.holeCards, state.board, widths])

  const best = advice?.options[0]
  const runnerUp = advice?.options[1]
  const tooClose =
    best !== undefined &&
    runnerUp !== undefined &&
    best.ev - runnerUp.ev < 1.96 * Math.hypot(best.error, runnerUp.error)

  // What a bet would have to do, and what it would cost you to make. Both are
  // about the raise in front of you rather than the call, so both appear only
  // when raising is legal and there is a size to talk about.
  const raise = legalActions(state).find((o) => o.type === 'raise')

  // The bet this is about is the one the player is looking at, not the one
  // the coach would make. The coach will not bluff — that is the whole point
  // of its rule — so keying this to its recommendation would hide the number
  // in every spot where somebody is thinking about bluffing, which is exactly
  // where it teaches. So: the coach's size where it wants to bet, and the
  // three-quarter-pot the controls default to otherwise.
  const defaultRaise = raise
    ? Math.max(raise.min!, Math.min(raise.max!, Math.round(state.currentBet + (pot + toCall) * 0.75)))
    : null
  const raiseTo =
    best?.action.type === 'raise' ? best.action.to : defaultRaise
  const betSize = raiseTo === null ? null : raiseTo - hero.committed
  const mustFold =
    equity && betSize !== null && betSize > 0 ? breakEvenFold(equity.equity, betSize, pot) : null
  const theyFold = best?.foldEquity
  const behindAfter = raise && betSize !== null ? hero.stack - betSize : null
  const spr =
    behindAfter !== null && betSize !== null ? stackToPotRatio(behindAfter, pot + 2 * betSize) : null

  // Behind on the board as it stands where there is a board to read, and by
  // the forecast where there is not.
  const behind = split ? split.behind > split.ahead : (equity?.equity ?? 1) < 0.5

  const guessing = hudLevel === 'predict' && guess === null
  const toAct = live.filter((s) => s.status === 'active').length

  if (!equity && !advice) {
    return (
      <div className="plate px-3 py-3 text-sm text-[color:var(--color-bone-faint)]">
        {pending || advicePending ? 'Working out the odds…' : 'Nothing to decide right now.'}
      </div>
    )
  }

  const share = equity?.equity ?? advice?.equity ?? 0

  return (
    <div className="plate space-y-3 p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="stamp">
          {madeHandInWords(hero.holeCards!, state.board)}
        </span>
        <span className="text-[11px] text-[color:var(--color-bone-faint)]">
          {pending || advicePending ? 'updating…' : `${toAct} still to act`}
        </span>
      </div>

      {guessing && showOdds ? (
        <div>
          <p className="text-sm text-[color:var(--color-bone-dim)]">
            Your guess first — how often does this win?
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((value) => (
              <button
                key={value}
                onClick={() => submitGuess(value, share, state.street, state.board.length)}
                className="min-h-11 min-w-11 rounded bg-black/40 px-2 text-sm fine:min-h-9 fine:min-w-9"
              >
                {value}%
              </button>
            ))}
          </div>
        </div>
      ) : (
        showOdds && (
          <>
            {/* One dial rather than a figure with a bar under it: your share
                is the fill, the price is the tick, and the answer is whether
                one has passed the other. */}
            <Dial
              share={share}
              limit={needed}
              caption={needed > 0 ? `price asks ${pct(needed)}` : 'nothing to call'}
            >
              <span className="figure text-4xl leading-none text-[color:var(--color-bone)]">
                {pct(share)}
              </span>
              <span className="text-[11px] text-[color:var(--color-bone-dim)]">
                {timesInTen(share)}
              </span>
            </Dial>
            {hudLevel === 'predict' && guess !== null && (
              <p className="-mt-1 text-center text-[11px] text-[color:var(--color-bone-faint)]">
                you guessed {guess}% — off by {Math.abs(guess - share * 100).toFixed(0)} points
              </p>
            )}

            {split ? (
              <AgainstTheirRange split={split} />
            ) : (
              hero.holeCards &&
              widths.length > 0 && (
                <BeforeTheFlop
                  hole={hero.holeCards}
                  width={Math.min(...widths.map((w) => w.width))}
                />
              )
            )}
          </>
        )
      )}

      {best && (
        <div className="plate-brass p-2.5">
          <div className="stamp flex items-center gap-1.5 !text-[color:var(--color-brass-bright)]">
            <span aria-hidden>◆</span>
            <span>Statistically the best play</span>
          </div>
          <div className="figure mt-0.5 text-2xl text-[color:var(--color-bone)] sm:text-3xl">
            {best.label}
            {tooClose && runnerUp && (
              <span className="text-base font-normal text-[color:var(--color-bone-dim)]">
                {' '}
                or {runnerUp.label.toLowerCase()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* The numbers that explain rather than price. Each is one line, and
          each appears only where it means something. */}
      <div className="divide-y divide-[color:var(--color-ink-4)]/70">
        {toCall > 0 && (
          <Line
            label="To call"
            value={`${toCall}`}
            note={potOddsRatio(toCall, winnable)}
            tone={share >= needed ? 'good' : 'bad'}
          />
        )}
        {mustFold !== null && mustFold > 0 && (
          <Line
            label={`Betting ${betSize} needs`}
            value={`${pct(mustFold)} folds`}
            // Only where the fold frequency is actually known. "This table
            // folds less" without a number is a claim, not a fact, and the
            // pairing is the whole lesson: what it needs against what it gets.
            {...(theyFold === undefined ? {} : { note: `they fold ${pct(theyFold)}` })}
            tone={theyFold !== undefined && theyFold >= mustFold ? 'good' : 'bad'}
          />
        )}
        {/* Only where there is a stack left to be committed with. Betting
            everything is not commitment — it is the end of the decision, and
            the button already says All in. */}
        {spr !== null &&
          Number.isFinite(spr) &&
          spr < 1.5 &&
          betSize !== null &&
          behindAfter !== null &&
          behindAfter > 0 && (
            <Line
              label="Betting leaves"
              value={`${behindAfter} behind`}
              note={`${spr.toFixed(1)}× the pot — you are committed`}
              tone="mark"
            />
          )}
        {/* Outs answer a question only somebody who is behind is asking. Shown
            to a hand that is already ahead, "none — nothing gets you there"
            reads as drawing dead to a player who is winning. So the line
            appears when the board says the hand needs help, and at zero as
            well as above it: the difference between a draw and drawing dead
            is worth being told. */}
        {equity?.outs && behind && (
          <Line
            label="Cards that put you ahead"
            value={equity.outs.cards.length === 0 ? 'none' : String(equity.outs.cards.length)}
            note={
              equity.outs.cards.length === 0
                ? 'nothing gets you there'
                : `${pct(equity.outs.byRiver)} by the river`
            }
            tone={equity.outs.cards.length === 0 ? 'bad' : 'plain'}
          />
        )}
      </div>

      <details className="group">
        <summary className="stamp cursor-pointer list-none py-1">
          <span className="group-open:hidden">Show the rest ▸</span>
          <span className="hidden group-open:inline">Hide the rest ▾</span>
        </summary>

        <div className="mt-2 space-y-3">
          {advice && advice.options.length > 0 && (
            <div>
              <div className="stamp">What every option is worth</div>
              <div className="mt-1 space-y-1.5">
                {advice.options.map((option) => {
                  const worst = advice.options[advice.options.length - 1]!
                  const span = Math.max(1, advice.options[0]!.ev - worst.ev)
                  const width = ((option.ev - worst.ev) / span) * 100
                  const isBest = option === advice.options[0]
                  return (
                    <div key={option.label} className="flex items-center gap-2 text-xs">
                      <span
                        className={`w-24 shrink-0 truncate ${isBest ? 'text-[color:var(--color-brass-bright)]' : 'text-[color:var(--color-bone-dim)]'}`}
                      >
                        {option.label}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-black/50">
                        <div
                          className={`h-full rounded ${isBest ? 'bg-[color:var(--color-brass)]' : 'bg-[color:var(--color-ink-4)]'}`}
                          style={{ width: `${Math.max(2, width)}%` }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right font-mono text-[color:var(--color-bone-dim)]">
                        {bb(option.ev, state.bigBlind)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <div className="stamp">What they might hold</div>
            <div className="mt-1 space-y-1">
              {widths.map((w) => (
                <div key={w.name} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 truncate text-[color:var(--color-bone-dim)]">{w.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-black/45">
                    <div
                      className="h-full bg-[color:var(--color-bone-faint)]"
                      style={{ width: `${Math.min(100, w.width * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 shrink-0 text-right font-mono text-[color:var(--color-bone-dim)]">
                    top {pct(w.width)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="divide-y divide-[color:var(--color-ink-4)]/70">
            <Line
              label="Stack against the pot"
              value={pot > 0 ? stackToPotRatio(hero.stack, pot).toFixed(1) : '—'}
              note={`${inBigBlinds(hero.stack, state.bigBlind).toFixed(0)} big blinds behind`}
            />
            {state.board.length === 0 ? (
              <Line
                label="Starting hands you beat"
                value={pct(preflopStrength(hero.holeCards!).percentile)}
                note="before any cards"
              />
            ) : (
              <Line label="You win outright" value={pct(equity?.win ?? 0)} note="rather than chopping" />
            )}
          </div>

          <RangeGrid
            width={Math.min(...widths.map((w) => w.width))}
            title="The tightest of those ranges"
            {...(hero.holeCards ? { highlight: classOf(hero.holeCards) } : {})}
          />

          <p className="text-[11px] leading-snug text-[color:var(--color-bone-faint)]">
            bb means big blinds — one is {state.bigBlind} chips here. Everything above is priced
            against the ranges these players are modelled to hold, one street at a time, relative
            to folding. It is the arithmetic, not the whole game.
          </p>
        </div>
      </details>
    </div>
  )
}
