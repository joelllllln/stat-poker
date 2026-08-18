import { describe as describeHand } from '../engine/evaluator'
import { potSize, positionName, type HandState, type Street } from '../engine/types'
import type { SessionState } from '../game/session'
import { CardBack, CardRow, CardSlot, PlayingCard } from './Cards'

/**
 * The table.
 *
 * Laid out the way an online client lays one out — an oval of felt inside a
 * rail, the person at the bottom, everyone else around it, the board and the
 * pot in the middle — because that arrangement carries information: who is next
 * to act, who is in the hand, and how much is in front of each player, all
 * readable without reading a word.
 *
 * Seats are placed as percentages of the felt rather than in a grid, so the
 * table keeps its shape at any size.
 */

/** Where each seat sits, clockwise from the person's own seat at the bottom. */
const SEAT_SPOTS = [
  { left: 50, top: 88 },
  { left: 12, top: 68 },
  { left: 11, top: 30 },
  { left: 50, top: 13 },
  { left: 89, top: 30 },
  { left: 88, top: 68 },
] as const

/** Where a seat's chips sit: between the seat and the middle of the table. */
const towardCentre = (spot: { left: number; top: number }, by = 0.34) => ({
  left: spot.left + (50 - spot.left) * by,
  top: spot.top + (50 - spot.top) * by,
})

const STREET_LABEL: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/** A stack of chips, drawn as chips rather than written as a number alone. */
function Chips({ amount }: { amount: number }) {
  const height = Math.min(4, Math.max(1, Math.ceil(Math.log10(amount + 1))))

  return (
    <div className="chip-in flex items-center gap-1.5">
      <div className="relative h-4 w-4">
        {Array.from({ length: height }, (_, i) => (
          <span
            key={i}
            className="absolute left-0 h-2.5 w-4 rounded-full border border-black/40"
            style={{
              bottom: i * 3,
              background: ['#e11d48', '#0ea5e9', '#22c55e', '#f5f5f4'][i % 4],
              boxShadow: '0 1px 2px rgba(0,0,0,0.5)',
            }}
          />
        ))}
      </div>
      <span className="font-mono text-xs font-semibold text-amber-100 drop-shadow">{amount}</span>
    </div>
  )
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

function SeatView({
  state,
  seat,
  isHero,
  botName,
  spot,
  won,
}: {
  state: HandState
  seat: number
  isHero: boolean
  botName: string | null
  spot: { left: number; top: number }
  won: number
}) {
  const s = state.seats[seat]!
  const toAct = state.toAct === seat
  const folded = s.status === 'folded'
  const over = state.result !== null
  const showCards = isHero || (over && s.holeCards !== null && !folded && state.result!.showdown)
  const action = lastActionLabel(state, seat)
  const handValue = over ? state.result!.handValues[seat] : null

  return (
    <div
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${spot.left}%`, top: `${spot.top}%` }}
    >
      <div
        className={`flex flex-col items-center gap-1 rounded-xl border px-2.5 py-1.5 backdrop-blur-sm transition ${
          folded
            ? 'border-white/5 bg-black/30 opacity-45'
            : won > 0
              ? 'seat-won border-emerald-400/70 bg-emerald-950/70'
              : toAct
                ? 'to-act border-amber-300/80 bg-slate-900/85'
                : 'border-white/10 bg-slate-900/75'
        }`}
      >
        {/* Cards sit above the plate, the way they do on a table. */}
        <div className="flex gap-0.5">
          {s.holeCards && !folded ? (
            showCards ? (
              <CardRow cards={s.holeCards} size={isHero ? 'lg' : 'xs'} dealt />
            ) : (
              <>
                <CardBack size="xs" dealt />
                <CardBack size="xs" dealt delay={70} />
              </>
            )
          ) : (
            <div className="h-9 text-[10px] leading-9 text-slate-500">folded</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
              isHero ? 'bg-sky-700 text-white' : 'bg-slate-700 text-slate-200'
            }`}
            aria-hidden
          >
            {s.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1 text-xs font-medium">
              {s.name}
              <span className="text-[9px] uppercase tracking-wide text-slate-500">
                {positionName(seat, state.buttonSeat, state.seats.length)}
              </span>
            </div>
            <div className="font-mono text-[11px] text-emerald-200/90">
              {s.status === 'allin' ? 'all in' : s.stack}
            </div>
          </div>
        </div>

        {botName && !folded && (
          <div className="text-[9px] uppercase tracking-wide text-slate-500">{botName}</div>
        )}

        {won > 0 && (
          <div className="font-mono text-[11px] font-semibold text-emerald-300">+{won}</div>
        )}
        {showCards && handValue !== null && handValue !== undefined && (
          <div className="max-w-32 truncate text-[10px] text-slate-400">
            {describeHand(handValue)}
          </div>
        )}
      </div>

      {action !== null && !over && (
        <div className="mt-1 flex justify-center">
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
            {action}
          </span>
        </div>
      )}
    </div>
  )
}

export function Table({ session }: { session: SessionState }) {
  const state = session.current
  const heroSeat = session.config.heroSeat
  const numSeats = session.config.seats.length

  if (!state) {
    return (
      <div className="rail rounded-[46%/32%] p-3">
        <div className="felt flex aspect-[16/9] items-center justify-center rounded-[46%/32%] text-sm text-emerald-200/50">
          Press Deal to start.
        </div>
      </div>
    )
  }

  const pot = potSize(state)
  const over = state.result !== null
  const wonBySeat = state.seats.map((_, seat) =>
    over
      ? state.result!.pots.reduce(
          (sum, p) => sum + (p.winners.includes(seat) ? Math.floor(p.amount / p.winners.length) : 0),
          0,
        )
      : 0,
  )

  return (
    <div className="rail rounded-[46%/32%] p-2 sm:p-3">
      <div className="felt relative aspect-[16/9] rounded-[46%/32%]">
        {/* Board and pot, centre stage. */}
        <div className="absolute left-1/2 top-[46%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <div className="flex gap-1 sm:gap-1.5">
            {Array.from({ length: 5 }, (_, i) => {
              const card = state.board[i]
              return card === undefined ? (
                <CardSlot key={`slot-${i}`} size="md" />
              ) : (
                <PlayingCard
                  key={card}
                  card={card}
                  size="md"
                  dealt
                  delay={Math.max(0, i - 2) * 90}
                  // Cards dealt after the betting ended decided the hand
                  // without anybody choosing anything, and are shown as such.
                  dimmed={over && i >= state.result!.runoutFrom}
                />
              )
            })}
          </div>
          {/* The street rides with the pot rather than above the board, where
              it collided with whoever was sitting at the top of the table. */}
          <div className="flex items-center gap-2 rounded-full bg-black/45 px-3 py-1">
            <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-200/60">
              {STREET_LABEL[state.street]}
            </span>
            <span className="font-mono text-sm text-amber-100">Pot {pot}</span>
          </div>
        </div>

        {/* The dealer button, on the rail side of whoever has it. */}
        <DealerButton
          spot={SEAT_SPOTS[(state.buttonSeat - heroSeat + numSeats) % numSeats]!}
        />

        {state.seats.map((s) => {
          const spot = SEAT_SPOTS[(s.index - heroSeat + numSeats) % numSeats]!
          const chipSpot = towardCentre(spot)
          return (
            <div key={s.index}>
              <SeatView
                state={state}
                seat={s.index}
                isHero={s.index === heroSeat}
                botName={session.config.seats[s.index]?.bot ?? null}
                spot={spot}
                won={wonBySeat[s.index]!}
              />
              {s.committed > 0 && (
                <div
                  className="absolute z-0 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${chipSpot.left}%`, top: `${chipSpot.top}%` }}
                >
                  <Chips amount={s.committed} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DealerButton({ spot }: { spot: { left: number; top: number } }) {
  const place = towardCentre(spot, 0.18)
  return (
    <div
      className="absolute z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-900 shadow-md"
      style={{ left: `${place.left + 7}%`, top: `${place.top}%` }}
      title="Dealer button"
    >
      D
    </div>
  )
}
