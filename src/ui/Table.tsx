import { describe as describeHand } from '../engine/evaluator'
import { potSize, positionName, type HandState, type Street } from '../engine/types'
import type { SessionState } from '../game/session'
import { tableName } from '../game/table'
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

export interface Spot {
  left: number
  top: number
}

/**
 * Where the seats go, for a table of any size.
 *
 * Six hardcoded spots were fine while there was one table. Now that the size
 * is a choice, the seats are placed on an ellipse: the player is always at the
 * bottom, and everyone else runs anticlockwise from there so that the seat to
 * the player's left — the one that acts after them — is drawn to their left,
 * the way it is at a real table.
 *
 * The ellipse is squashed toward the sides rather than being a circle inside a
 * square, because the felt is wide: a circle would leave the left and right
 * seats floating in the middle of nothing and crowd the top. The vertical
 * radius stops well short of the edge to leave room for the board and the pot,
 * which live in the middle and are what everything else has to stay clear of.
 *
 * Two sizes are special. Heads-up puts the opponent straight across the table
 * rather than at an angle, which is what heads-up looks like. And at the
 * largest sizes the seats are pushed a little further out, because nine plates
 * on one ellipse is the case that runs out of room first — which the overlap
 * test measures rather than trusting.
 */
export function seatSpots(numSeats: number): Spot[] {
  return ring(numSeats, 1)
}

/**
 * Where each seat's chips sit: beside the seat they came from.
 *
 * A ring of its own was the obvious idea and it does not survive measurement.
 * The plates are tall — nearly a third of the felt — and at five seats the gap
 * between a plate on the diagonal and the top of the board is seven tenths of
 * one per cent. There is no corridor to put anything in.
 *
 * So the chips belong to their seat rather than to a ring: pushed off the
 * plate toward the middle, along whichever axis has the room. Seats out to the
 * side push their chips inward horizontally, where the board is not; seats at
 * the top and bottom push vertically, where it is not either. That holds at
 * every table size, because it is derived from where the plate actually is
 * rather than from an angle that happens to work at six.
 */
export function chipSpots(numSeats: number, heroWidth = FELT.heroWidth): Spot[] {
  const plateWidth = seatWidthFor(numSeats)
  return seatSpots(numSeats).map((spot, i) => {
    const wide = i === 0 ? heroWidth : plateWidth
    const tall = wide * PLATE_ASPECT
    const dx = 50 - spot.left
    const dy = 49 - spot.top

    // Sideways where there is more sideways than up: the comparison is
    // weighted because the felt is wider than it is tall, so an equal number
    // of per cent is a shorter distance across than down.
    const sideways = { left: spot.left + Math.sign(dx || 1) * (wide / 2 + CHIP_GAP), top: spot.top }
    const upright = { left: spot.left, top: spot.top + Math.sign(dy || 1) * (tall / 2 + CHIP_GAP) }
    const preferred = Math.abs(dx) * 1.6 > Math.abs(dy) ? sideways : upright

    // Unless that lands in the middle, which belongs to the board and the pot.
    // Heads-up is the case: the opponent sits dead centre at the top, so the
    // only way off its plate is downward, and downward is the board.
    if (!inTheMiddle(preferred)) return preferred
    const other = preferred === sideways ? upright : sideways
    return inTheMiddle(other) ? preferred : other
  })
}

/**
 * How tall a seat plate is against how wide, and how far off it the chips sit.
 *
 * Both measured from the rendered felt rather than counted out of the markup:
 * a plate at 17% of the width comes out at 28% of the height, and the chips
 * need about four points of clearance to stay off it.
 */
const PLATE_ASPECT = 1.72
const CHIP_GAP = 4

/**
 * The middle, which belongs to the board and the pot.
 *
 * Measured from the rendered felt: the board runs from 34% to 66% across and
 * 36% to 51% down, the pot from 40% to 60% and 53% to 60%. This is the two of
 * them together with room for a pile of chips on any side.
 */
const inTheMiddle = (spot: Spot): boolean =>
  spot.left > 32 && spot.left < 68 && spot.top > 34 && spot.top < 62

/** The radii the seats sit on, which grow a little as the table fills. */
const radii = (numSeats: number) => ({
  rx: numSeats >= 8 ? 45 : 42,
  ry: numSeats >= 8 ? 36 : 34,
})

/**
 * Points spaced evenly around the felt, at a share of the seating radius.
 *
 * Heads-up is the one arrangement that is not a ring: two seats on an ellipse
 * would sit at an angle to each other, and heads-up is played across the table.
 */
function ring(numSeats: number, scaleX: number, scaleY = scaleX): Spot[] {
  const { rx, ry } = radii(numSeats)
  if (numSeats === 2) {
    return [
      { left: 50, top: 49 + ry * scaleY },
      { left: 50, top: 49 - ry * scaleY },
    ]
  }

  return Array.from({ length: numSeats }, (_, i) => {
    // Straight down is the player; go anticlockwise from there, so the seat
    // that acts after them is drawn to their left.
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / numSeats
    return {
      left: 50 + rx * scaleX * Math.cos(angle),
      top: 49 + ry * scaleY * Math.sin(angle),
    }
  })
}

/** The dealer button rides just inside its seat, toward the middle. */
const towardCentre = (spot: Spot, by: number): Spot => ({
  left: spot.left + (50 - spot.left) * by,
  top: spot.top + (49 - spot.top) * by,
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

/**
 * How wide a seat plate can be, given how many of them there are.
 *
 * Six plates at seventeen per cent of the felt fit around the ellipse with
 * room to spare. Nine do not. Rather than sizing everything for the worst case
 * — which would leave a heads-up table looking like a spreadsheet — the plate
 * shrinks as the table fills, and the overlap test measures every size to say
 * whether the numbers are right.
 */
export function seatWidthFor(numSeats: number): number {
  if (numSeats <= 4) return 20
  if (numSeats <= 6) return FELT.seatWidth
  if (numSeats === 7) return 15
  if (numSeats === 8) return 13
  return 11.5
}

/** The cards on a plate follow the plate. */
export const villainCardFor = (numSeats: number): number =>
  (seatWidthFor(numSeats) / FELT.seatWidth) * FELT.villainCard

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
  /**
   * Leave out the row of card backs when there is nothing to see in it.
   *
   * Two face-down cards say only "this seat has cards", which the plate
   * already says by not being greyed out and by the line underneath. On a
   * phone that row is thirty pixels of no information, twice over, and those
   * sixty pixels are the difference between the buttons being on the screen
   * and being below it.
   */
  hideBacks?: boolean
}

/**
 * One player.
 *
 * Everything a seat has to say lives inside its own box — cards, name, stack,
 * what they just did, what they won — so a seat can never write on top of
 * anything outside itself.
 */
function Seat({ state, seat, isHero, botName, won, scale, hideBacks = false }: SeatProps) {
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
      {(showCards || !hideBacks) && (
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
              className="flex items-center justify-center text-[color:var(--color-bone-faint)]"
              style={{ height: `calc(${scale.card} * 1.4)`, fontSize: scale.small }}
              aria-hidden
            >
              —
            </div>
          )}
        </div>
      )}

      <div className="w-full truncate text-center font-medium" style={{ fontSize: scale.text }}>
        {s.name}{' '}
        <span className="text-[color:var(--color-bone-faint)]" style={{ fontSize: scale.small }}>
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
          <span className="font-mono font-semibold text-[color:var(--color-jade-bright)]">+{won}</span>
        ) : showCards && handValue !== null && handValue !== undefined ? (
          <span className="text-[color:var(--color-bone-dim)]">{describeHand(handValue)}</span>
        ) : folded ? (
          <span className="uppercase tracking-wide text-[color:var(--color-bone-faint)]">Folded</span>
        ) : action !== null && !over ? (
          <span className="uppercase tracking-wide text-[color:var(--color-bone)]">{action}</span>
        ) : botName ? (
          <span className="uppercase tracking-wide text-[color:var(--color-bone-faint)]">{botName}</span>
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
        className="rounded-full border border-black/40 bg-[color:var(--color-oxblood)]"
        style={{ width: scale, height: `calc(${scale} * 0.55)` }}
        aria-hidden
      />
      <span className="font-mono font-semibold text-[color:var(--color-brass-bright)]" style={{ fontSize: scale }}>
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
        <span className="uppercase tracking-[0.18em] text-[color:var(--color-jade-bright)]/70">
          {STREET_LABEL[state.street]}
        </span>
        <span className="font-mono text-[color:var(--color-brass-bright)]">Pot {potSize(state)}</span>
      </div>
    </div>
  )
}

export function Table({ session }: { session: SessionState }) {
  const state = session.current
  const heroSeat = session.config.heroSeat
  const numSeats = session.config.seats.length
  // Computed per table size rather than looked up: the size is a choice now.
  const spots = seatSpots(numSeats)
  const chips = chipSpots(numSeats)

  if (!state) {
    return (
      <div className="rail rounded-[12%/22%] p-2 sm:rounded-[46%/32%] sm:p-3">
        <div className="felt flex aspect-[16/10] items-center justify-center rounded-[10%/20%] px-6 text-center text-sm text-[color:var(--color-jade-bright)]/70 sm:aspect-[16/9] sm:rounded-[46%/32%]">
          {tableName(numSeats)} no-limit hold’em. Press Deal to play a hand.
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
          plate: `${seatWidthFor(numSeats)}cqw`,
          card: `${villainCardFor(numSeats)}cqw`,
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

          <DealerButton spot={spots[(state.buttonSeat - heroSeat + numSeats) % numSeats]!} />

          {state.seats.map((s) => {
            const seatIndex = (s.index - heroSeat + numSeats) % numSeats
            const spot = spots[seatIndex]!
            const chipSpot = chips[seatIndex]!
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
      <div className="rail rounded-2xl p-1.5 sm:hidden">
        <div className="felt space-y-1.5 rounded-xl px-2 py-1.5 @container">
          <div className="grid grid-cols-3 gap-1">
            {others.map((seat) => (
              <div key={seat} className="flex justify-center">
                <Seat
                  {...seatProps(seat, false)}
                  hideBacks
                  scale={{
                    plate: '29cqw',
                    card: '7.4cqw',
                    text: 'clamp(10px, 2.9cqw, 12px)',
                    small: 'clamp(9px, 2.4cqw, 10px)',
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-1.5">
            <Board state={state} cardWidth="9.6cqw" potFontSize="clamp(11px, 3.2cqw, 14px)" />
            {state.seats.some((s) => s.committed > 0) && (
              <div className="flex flex-wrap justify-center gap-1.5">
                {state.seats
                  .filter((s) => s.committed > 0)
                  .map((s) => (
                    <div key={s.index} data-chips={s.name} className="flex items-center gap-1">
                      <span className="text-[10px] text-[color:var(--color-bone-dim)]">{s.name}</span>
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
                plate: '40cqw',
                card: '9.6cqw',
                text: 'clamp(12px, 3.4cqw, 14px)',
                small: 'clamp(10px, 2.7cqw, 11px)',
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
      className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white font-bold text-[color:var(--color-ink)] shadow-md"
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
