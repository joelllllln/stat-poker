import { describe as describeHand } from '../engine/evaluator'
import { potSize, positionName, type HandState, type Street } from '../engine/types'
import type { SessionState } from '../game/session'
import { CardBack, CardRow, CardSlot, PlayingCard } from './Cards'

/**
 * The table.
 *
 * Laid out the way an online client lays one out — an oval of felt, the person
 * at the bottom, everyone else around it, the board and the pot in the middle —
 * because that arrangement carries information: who is next to act, who is in
 * the hand, and how much is in front of each player, all readable without
 * reading a word.
 *
 * **Nothing overlaps at any width, by construction.** Every size on the felt is
 * given in container units, so the whole arrangement scales with the felt
 * rather than reflowing: seats that clear each other at one width clear each
 * other at every width. Below the width where that would leave the text too
 * small to read, the oval is abandoned entirely for a plain stacked layout with
 * no absolute positioning in it — a small screen is a reason to change the
 * arrangement, not to shrink it until it collides.
 */

/** Where each seat sits, clockwise from the person's own seat at the bottom. */
const SEAT_SPOTS = [
  { left: 50, top: 82 },
  { left: 15, top: 65 },
  { left: 15, top: 31 },
  { left: 50, top: 15 },
  { left: 85, top: 31 },
  { left: 85, top: 65 },
] as const

/**
 * Where each seat's chips sit: between the seat and the board.
 *
 * Given per seat rather than computed as a fraction of the way to the middle,
 * because the seats are not the same distance from it: the same fraction put
 * the top seat's chips underneath the top seat's own plate.
 */
const CHIP_SPOTS = [
  { left: 50, top: 62.5 },
  { left: 30, top: 67 },
  { left: 30, top: 27 },
  { left: 50, top: 33 },
  { left: 70, top: 27 },
  { left: 70, top: 67 },
] as const

/** The dealer button rides just inside its seat, toward the middle. */
const towardCentre = (spot: { left: number; top: number }, by: number) => ({
  left: spot.left + (50 - spot.left) * by,
  top: spot.top + (50 - spot.top) * by,
})

const STREET_LABEL: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/**
 * Sizes on the felt, as a share of its width.
 *
 * These are the numbers that keep the seats apart, and they were measured
 * rather than guessed: the browser test reports every box on the felt and
 * fails if any two of them share a pixel. The tightest corridor is the one
 * between the pot and the player's own seat, which is why the chips there are
 * small and the hero's cards are not as large as they could be.
 */
const FELT = {
  seatWidth: 17,
  heroWidth: 19,
  villainCard: 4.4,
  heroCard: 5.4,
  boardCard: 5.8,
}

/** What a seat did last on this street, in the words a client would use. */
function lastActionLabel(state: HandState, seat: number): string | null {
  for (let i = state.actions.length - 1; i >= 0; i--) {
    const entry = state.actions[i]!
    if (entry.street !== state.street) break
    if (entry.seat !== seat) continue
    switch (entry.action.type) {
      case 'fold':
        return 'Fold'
      case 'check':
        return 'Check'
      case 'call':
        return entry.cost === 0 ? 'Check' : 'Call'
      case 'raise':
        return entry.toCall === 0 ? 'Bet' : 'Raise'
    }
  }
  return null
}

interface SeatProps {
  state: HandState
  seat: number
  isHero: boolean
  botName: string | null
  won: number
  /** CSS lengths, so the same seat renders on the felt and in the stack. */
  scale: { plate: string; card: string; text: string; small: string }
}

/**
 * One player.
 *
 * Everything a seat has to say lives inside its own box — cards, name, stack,
 * what they just did, what they won — so a seat can never write on top of
 * anything outside itself.
 */
function Seat({ state, seat, isHero, botName, won, scale }: SeatProps) {
  const s = state.seats[seat]!
  const toAct = state.toAct === seat
  const folded = s.status === 'folded'
  const over = state.result !== null
  const showCards = isHero || (over && s.holeCards !== null && !folded && state.result!.showdown)
  const action = lastActionLabel(state, seat)
  const handValue = over ? state.result!.handValues[seat] : null

  return (
    <div
      data-seat={s.name}
      className={`flex flex-col items-center rounded-xl border backdrop-blur-sm transition ${
        folded
          ? 'border-white/5 bg-black/45 opacity-45'
          : won > 0
            ? 'seat-won border-[color:var(--color-jade)]/70 bg-[#0e2a20]/90'
            : toAct
              ? 'to-act border-[color:var(--color-brass)]/80 bg-[color:var(--color-ink-3)]/95'
              : 'border-[color:var(--color-bone)]/10 bg-[color:var(--color-ink-2)]/88'
      }`}
      style={{ width: scale.plate, padding: `calc(${scale.plate} * 0.045)`, gap: '2px' }}
    >
      <div className="flex" style={{ gap: '2px' }}>
        {s.holeCards && !folded ? (
          showCards ? (
            <CardRow cards={s.holeCards} width={scale.card} dealt />
          ) : (
            <>
              <CardBack width={scale.card} dealt />
              <CardBack width={scale.card} dealt delay={70} />
            </>
          )
        ) : (
          <div
            className="flex items-center justify-center text-slate-600"
            style={{ height: `calc(${scale.card} * 1.4)`, fontSize: scale.small }}
            aria-hidden
          >
            —
          </div>
        )}
      </div>

      <div className="w-full truncate text-center font-medium" style={{ fontSize: scale.text }}>
        {s.name}{' '}
        <span className="text-slate-500" style={{ fontSize: scale.small }}>
          {positionName(seat, state.buttonSeat, state.seats.length)}
        </span>
      </div>

      <div
        className="font-mono text-[color:var(--color-brass-bright)]/90"
        style={{ fontSize: scale.text }}
      >
        {s.status === 'allin' ? 'all in' : s.stack}
      </div>

      {/* One line that changes rather than a stack of badges: what this seat
          did, or what it won, or what it held. */}
      <div
        className="w-full truncate text-center"
        style={{ fontSize: scale.small, minHeight: `calc(${scale.small} * 1.4)` }}
      >
        {won > 0 ? (
          <span className="font-mono font-semibold text-emerald-300">+{won}</span>
        ) : showCards && handValue !== null && handValue !== undefined ? (
          <span className="text-slate-400">{describeHand(handValue)}</span>
        ) : folded ? (
          <span className="uppercase tracking-wide text-slate-500">Folded</span>
        ) : action !== null && !over ? (
          <span className="uppercase tracking-wide text-slate-300">{action}</span>
        ) : botName ? (
          <span className="uppercase tracking-wide text-slate-500">{botName}</span>
        ) : (
          ' '
        )}
      </div>
    </div>
  )
}

/** Chips in front of a seat: drawn as chips, and labelled as a number. */
function Chips({ amount, scale }: { amount: number; scale: string }) {
  return (
    <div
      className="chip-in flex items-center rounded-full bg-black/50"
      style={{ gap: `calc(${scale} * 0.4)`, padding: `calc(${scale} * 0.25) calc(${scale} * 0.5)` }}
    >
      <span
        className="rounded-full border border-black/40 bg-rose-600"
        style={{ width: scale, height: `calc(${scale} * 0.55)` }}
        aria-hidden
      />
      <span className="font-mono font-semibold text-amber-100" style={{ fontSize: scale }}>
        {amount}
      </span>
    </div>
  )
}

function Board({
  state,
  cardWidth,
  potFontSize,
}: {
  state: HandState
  cardWidth: string
  potFontSize: string
}) {
  const over = state.result !== null
  return (
    <div className="flex flex-col items-center" style={{ gap: `calc(${cardWidth} * 0.22)` }}>
      <div data-board className="flex" style={{ gap: `calc(${cardWidth} * 0.14)` }}>
        {Array.from({ length: 5 }, (_, i) => {
          const card = state.board[i]
          return card === undefined ? (
            <CardSlot key={`slot-${i}`} width={cardWidth} />
          ) : (
            <PlayingCard
              key={card}
              card={card}
              width={cardWidth}
              dealt
              delay={Math.max(0, i - 2) * 90}
              // Cards dealt after the betting ended decided the hand without
              // anybody choosing anything, and are shown as such.
              dimmed={over && i >= state.result!.runoutFrom}
            />
          )
        })}
      </div>
      <div
        data-pot
        className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1"
        style={{ fontSize: potFontSize }}
      >
        <span className="uppercase tracking-[0.18em] text-emerald-200/60">
          {STREET_LABEL[state.street]}
        </span>
        <span className="font-mono text-amber-100">Pot {potSize(state)}</span>
      </div>
    </div>
  )
}

export function Table({ session }: { session: SessionState }) {
  const state = session.current
  const heroSeat = session.config.heroSeat
  const numSeats = session.config.seats.length

  if (!state) {
    return (
      <div className="rail rounded-[12%/22%] p-2 sm:rounded-[46%/32%] sm:p-3">
        <div className="felt flex aspect-[16/10] items-center justify-center rounded-[10%/20%] px-6 text-center text-sm text-emerald-200/60 sm:aspect-[16/9] sm:rounded-[46%/32%]">
          Six-max no-limit hold’em. Press Deal to play a hand.
        </div>
      </div>
    )
  }

  const over = state.result !== null
  const wonBySeat = state.seats.map((_, seat) =>
    over
      ? state.result!.pots.reduce(
          (sum, p) => sum + (p.winners.includes(seat) ? Math.floor(p.amount / p.winners.length) : 0),
          0,
        )
      : 0,
  )

  const seatProps = (seat: number, isHero: boolean): SeatProps => ({
    state,
    seat,
    isHero,
    botName: session.config.seats[seat]?.bot ?? null,
    won: wonBySeat[seat]!,
    scale: isHero
      ? {
          plate: `${FELT.heroWidth}cqw`,
          card: `${FELT.heroCard}cqw`,
          text: 'clamp(10px, 1.9cqw, 15px)',
          small: 'clamp(8px, 1.5cqw, 12px)',
        }
      : {
          plate: `${FELT.seatWidth}cqw`,
          card: `${FELT.villainCard}cqw`,
          text: 'clamp(9px, 1.7cqw, 14px)',
          small: 'clamp(8px, 1.4cqw, 11px)',
        },
  })

  const others = state.seats.map((s) => s.index).filter((i) => i !== heroSeat)

  return (
    <>
      {/* Wide enough for an oval: everything sized against the felt, so the
          arrangement is the same at every width. */}
      <div className="rail hidden rounded-[46%/32%] p-3 sm:block">
        <div className="felt relative aspect-[16/9] rounded-[46%/32%] @container">
          <div className="absolute left-1/2 top-[48%] -translate-x-1/2 -translate-y-1/2">
            <Board
              state={state}
              cardWidth={`${FELT.boardCard}cqw`}
              potFontSize="clamp(10px, 1.7cqw, 14px)"
            />
          </div>

          <DealerButton spot={SEAT_SPOTS[(state.buttonSeat - heroSeat + numSeats) % numSeats]!} />

          {state.seats.map((s) => {
            const seatIndex = (s.index - heroSeat + numSeats) % numSeats
            const spot = SEAT_SPOTS[seatIndex]!
            const chipSpot = CHIP_SPOTS[seatIndex]!
            return (
              <div key={s.index}>
                <div
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${spot.left}%`, top: `${spot.top}%` }}
                >
                  <Seat {...seatProps(s.index, s.index === heroSeat)} />
                </div>
                {s.committed > 0 && (
                  <div
                    data-chips={s.name}
                    className="absolute z-0 -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${chipSpot.left}%`, top: `${chipSpot.top}%` }}
                  >
                    <Chips amount={s.committed} scale="clamp(8px, 1.2cqw, 11px)" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Too narrow for an oval. The same pieces, stacked in reading order:
          opponents, then the board, then you. Nothing is positioned, so
          nothing can land on anything else. */}
      <div className="rail rounded-2xl p-2 sm:hidden">
        <div className="felt space-y-2 rounded-xl px-2 py-2 @container">
          <div className="grid grid-cols-3 gap-1.5">
            {others.map((seat) => (
              <div key={seat} className="flex justify-center">
                <Seat
                  {...seatProps(seat, false)}
                  scale={{
                    plate: '30cqw',
                    card: '6.4cqw',
                    text: 'clamp(10px, 3cqw, 13px)',
                    small: 'clamp(9px, 2.5cqw, 11px)',
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <Board state={state} cardWidth="10.5cqw" potFontSize="clamp(11px, 3.2cqw, 14px)" />
            {state.seats.some((s) => s.committed > 0) && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {state.seats
                  .filter((s) => s.committed > 0)
                  .map((s) => (
                    <div key={s.index} data-chips={s.name} className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-400">{s.name}</span>
                      <Chips amount={s.committed} scale="11px" />
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="flex justify-center">
            <Seat
              {...seatProps(heroSeat, true)}
              scale={{
                plate: '42cqw',
                card: '10.5cqw',
                text: 'clamp(12px, 3.6cqw, 15px)',
                small: 'clamp(10px, 2.8cqw, 12px)',
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}

function DealerButton({ spot }: { spot: { left: number; top: number } }) {
  const place = towardCentre(spot, 0.2)
  return (
    <div
      className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white font-bold text-slate-900 shadow-md"
      style={{
        left: `${place.left + 9}%`,
        top: `${place.top}%`,
        width: 'clamp(14px, 2.4cqw, 22px)',
        height: 'clamp(14px, 2.4cqw, 22px)',
        fontSize: 'clamp(8px, 1.4cqw, 12px)',
      }}
      title="Dealer button"
    >
      D
    </div>
  )
}
