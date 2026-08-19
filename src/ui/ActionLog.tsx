import { useEffect, useRef } from 'react'
import { RANKS, rankOf, suitOf, type Card } from '../engine/cards'
import type { HandState, Street } from '../engine/types'

/**
 * What just happened.
 *
 * A table tells you the state of the world but not the story that produced it:
 * a pot of 33 says nothing about who raised and who came along. This is the
 * running commentary a dealer would give — every action in order, with the
 * cards as they came out — so a hand can be followed rather than deduced.
 */

const GLYPHS = ['♣', '♦', '♥', '♠']
const SUIT_INK = ['text-[#4a9c78]', 'text-[#5b8fc9]', 'text-[#c2455a]', 'text-[color:var(--color-bone)]']

const STREET_LABEL: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/** How many board cards are out on each street. */
const BOARD_BY_STREET: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 }

function CardText({ card }: { card: Card }) {
  return (
    <span className={`font-medium ${SUIT_INK[suitOf(card)]}`}>
      {RANKS[rankOf(card)]}
      {GLYPHS[suitOf(card)]}
    </span>
  )
}

interface Line {
  key: string
  street: Street
  /** A dealt street rather than a player's action. */
  deal?: Card[]
  seat?: string
  isHero?: boolean
  text?: string
}

/** Turn the hand into sentences, in the order they happened. */
function narrate(state: HandState, heroSeat: number): Line[] {
  const lines: Line[] = []

  // Every hand starts with the blinds, and they are the reason the first
  // player faces a price at all.
  for (const which of ['small', 'big'] as const) {
    const seat = blindSeat(state, which)
    lines.push({
      key: `blind-${which}`,
      street: 'preflop',
      seat: state.seats[seat]!.name,
      isHero: seat === heroSeat,
      text: `posts the ${which} blind, ${which === 'small' ? state.smallBlind : state.bigBlind}`,
    })
  }

  let street: Street = 'preflop'
  for (const [i, entry] of state.actions.entries()) {
    if (entry.street !== street) {
      street = entry.street
      lines.push({
        key: `deal-${street}`,
        street,
        deal: state.board.slice(0, BOARD_BY_STREET[street]),
      })
    }

    const name = state.seats[entry.seat]!.name
    lines.push({
      key: `action-${i}`,
      street: entry.street,
      seat: name,
      isHero: entry.seat === heroSeat,
      text: describeAction(entry),
    })
  }

  // A street dealt with nobody left to act still happened, and the cards that
  // came out are the ones that decided the hand.
  for (const later of ['flop', 'turn', 'river'] as const) {
    if (
      state.board.length >= BOARD_BY_STREET[later] &&
      !lines.some((line) => line.deal && line.street === later)
    ) {
      lines.push({
        key: `deal-${later}`,
        street: later,
        deal: state.board.slice(0, BOARD_BY_STREET[later]),
      })
    }
  }

  return lines
}

function describeAction(entry: HandState['actions'][number]): string {
  switch (entry.action.type) {
    case 'fold':
      return 'folds'
    case 'check':
      return 'checks'
    case 'call':
      return entry.cost === 0 ? 'checks' : `calls ${entry.cost}`
    case 'raise':
      return entry.toCall === 0 ? `bets ${entry.action.to}` : `raises to ${entry.action.to}`
  }
}

const blindSeat = (state: HandState, which: 'small' | 'big'): number => {
  const n = state.seats.length
  // Heads-up, the button posts the small blind.
  if (n === 2) return which === 'small' ? state.buttonSeat : (state.buttonSeat + 1) % n
  return which === 'small' ? (state.buttonSeat + 1) % n : (state.buttonSeat + 2) % n
}

export function ActionLog({ state, heroSeat }: { state: HandState; heroSeat: number }) {
  const lines = narrate(state, heroSeat)
  const end = useRef<HTMLDivElement>(null)

  // The newest line is the interesting one, so the log follows the hand.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [lines.length])

  return (
    <div className="plate p-3">
      <div className="stamp">What happened</div>
      <div className="mt-1 max-h-44 space-y-0.5 overflow-y-auto pr-1 text-xs">
        {lines.map((line) =>
          line.deal ? (
            <div key={line.key} className="flex items-center gap-1.5 pt-1 text-[color:var(--color-bone-faint)]">
              <span className="uppercase tracking-wide">{STREET_LABEL[line.street]}</span>
              <span className="flex gap-1">
                {line.deal.map((card) => (
                  <CardText key={card} card={card} />
                ))}
              </span>
            </div>
          ) : (
            <div key={line.key} className="flex gap-1.5">
              <span className={line.isHero ? 'font-medium text-[color:var(--color-brass-bright)]' : 'text-[color:var(--color-bone-dim)]'}>
                {line.isHero ? 'You' : line.seat}
              </span>
              <span className="text-[color:var(--color-bone-dim)]">{line.text}</span>
            </div>
          ),
        )}
        <div ref={end} />
      </div>
    </div>
  )
}
