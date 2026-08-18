import { RANKS, rankOf, suitOf, type Card } from '../engine/cards'

const GLYPHS = ['♣', '♦', '♥', '♠']

/**
 * Four-colour suits.
 *
 * Two-colour decks are traditional and cost people pots: clubs and spades read
 * the same at a glance, which is exactly the mistake a trainer should not be
 * teaching. Every online client offers this; here it is simply the default.
 */
const SUIT_INK = ['#15803d', '#1d4ed8', '#be123c', '#0f172a']

const SIZES = {
  xs: { box: 'w-6 h-9 rounded', rank: 'text-[11px]', suit: 'text-[13px]', corner: 'text-[8px]' },
  sm: { box: 'w-8 h-11 rounded-md', rank: 'text-sm', suit: 'text-base', corner: 'text-[9px]' },
  md: { box: 'w-11 h-15 rounded-md', rank: 'text-lg', suit: 'text-xl', corner: 'text-[10px]' },
  lg: { box: 'w-14 h-20 rounded-lg', rank: 'text-2xl', suit: 'text-3xl', corner: 'text-xs' },
} as const

export type CardSize = keyof typeof SIZES

export function PlayingCard({
  card,
  size = 'md',
  dealt = false,
  delay = 0,
  dimmed = false,
}: {
  card: Card
  size?: CardSize
  /** Play the dealing animation on mount. */
  dealt?: boolean
  delay?: number
  dimmed?: boolean
}) {
  const rank = RANKS[rankOf(card)]!
  const suit = suitOf(card)
  const style = SIZES[size]

  return (
    <div
      className={`${style.box} relative flex select-none items-center justify-center bg-white font-semibold leading-none shadow-[0_2px_6px_rgba(0,0,0,0.45)] ${
        dealt ? 'deal-in' : ''
      } ${dimmed ? 'opacity-60 saturate-50' : ''}`}
      style={{ color: SUIT_INK[suit], animationDelay: `${delay}ms` }}
      aria-label={`${rank}${GLYPHS[suit]}`}
    >
      <span className={`absolute left-[3px] top-[2px] ${style.corner} leading-none`}>{rank}</span>
      <span className={`${style.suit} leading-none`}>{GLYPHS[suit]}</span>
    </div>
  )
}

export function CardBack({
  size = 'md',
  dealt = false,
  delay = 0,
}: {
  size?: CardSize
  dealt?: boolean
  delay?: number
}) {
  const style = SIZES[size]
  return (
    <div
      className={`${style.box} border border-slate-900/60 shadow-[0_2px_6px_rgba(0,0,0,0.45)] ${
        dealt ? 'deal-in' : ''
      }`}
      style={{
        animationDelay: `${delay}ms`,
        backgroundImage:
          'repeating-linear-gradient(45deg, #1e3a8a 0 4px, #172554 4px 8px)',
      }}
    />
  )
}

/** An empty slot, so the board keeps its shape before the cards land. */
export function CardSlot({ size = 'md' }: { size?: CardSize }) {
  return (
    <div
      className={`${SIZES[size].box} border border-dashed border-white/10 bg-black/15`}
      aria-hidden
    />
  )
}

export function CardRow({
  cards,
  size = 'md',
  dealt = false,
}: {
  cards: readonly Card[]
  size?: CardSize
  dealt?: boolean
}) {
  return (
    <div className="flex gap-1">
      {cards.map((card, i) => (
        <PlayingCard key={card} card={card} size={size} dealt={dealt} delay={i * 70} />
      ))}
    </div>
  )
}
