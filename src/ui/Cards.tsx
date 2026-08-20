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

/**
 * A card is sized by its width, and everything else follows from it.
 *
 * Named sizes are plain pixels for cards in panels. The table passes a width in
 * container units instead, so every card on the felt scales with the felt: a
 * layout that does not overlap at one width cannot overlap at another, which is
 * a stronger guarantee than checking a handful of screen sizes.
 */
const PRESETS = { xs: '26px', sm: '32px', md: '44px', lg: '58px' } as const

export type CardSize = keyof typeof PRESETS

/** Playing cards are 2.5 by 3.5 inches; keeping the ratio keeps them cards. */
const sizing = (width: string) => ({
  width,
  height: `calc(${width} * 1.4)`,
  borderRadius: `calc(${width} * 0.1)`,
})

export function PlayingCard({
  card,
  size = 'md',
  width,
  dealt = false,
  delay = 0,
  dimmed = false,
}: {
  card: Card
  size?: CardSize
  /** Any CSS length, which overrides the named size. */
  width?: string
  /** Play the dealing animation on mount. */
  dealt?: boolean
  delay?: number
  dimmed?: boolean
}) {
  const rank = RANKS[rankOf(card)]!
  const suit = suitOf(card)
  const box = width ?? PRESETS[size]

  return (
    <div
      className={`relative flex shrink-0 select-none items-center justify-center bg-white font-semibold leading-none shadow-[0_2px_6px_rgba(0,0,0,0.45)] ${
        dealt ? 'deal-in' : ''
      } ${dimmed ? 'opacity-60 saturate-50' : ''}`}
      style={{
        ...sizing(box),
        color: SUIT_INK[suit],
        animationDelay: `${delay}ms`,
        fontSize: `calc(${box} * 0.46)`,
      }}
      aria-label={`${rank}${GLYPHS[suit]}`}
    >
      <span
        className="absolute leading-none"
        style={{
          top: `calc(${box} * 0.05)`,
          left: `calc(${box} * 0.07)`,
          fontSize: `calc(${box} * 0.26)`,
        }}
      >
        {rank}
      </span>
      <span className="leading-none">{GLYPHS[suit]}</span>
    </div>
  )
}

export function CardBack({
  size = 'md',
  width,
  dealt = false,
  delay = 0,
}: {
  size?: CardSize
  width?: string
  dealt?: boolean
  delay?: number
}) {
  const box = width ?? PRESETS[size]
  return (
    <div
      className={`shrink-0 border border-[color:var(--color-ink-4)] shadow-[0_2px_6px_rgba(0,0,0,0.45)] ${
        dealt ? 'deal-in' : ''
      }`}
      style={{
        ...sizing(box),
        animationDelay: `${delay}ms`,
        backgroundImage: 'repeating-linear-gradient(45deg, #1e3a8a 0 4px, #172554 4px 8px)',
      }}
    />
  )
}

/** An empty slot, so the board keeps its shape before the cards land. */
export function CardSlot({ size = 'md', width }: { size?: CardSize; width?: string }) {
  return (
    <div
      className="shrink-0 border border-dashed border-white/10 bg-black/15"
      style={sizing(width ?? PRESETS[size])}
      aria-hidden
    />
  )
}

export function CardRow({
  cards,
  size = 'md',
  width,
  dealt = false,
  gap = '2px',
}: {
  cards: readonly Card[]
  size?: CardSize
  width?: string
  dealt?: boolean
  gap?: string
}) {
  return (
    <div className="flex" style={{ gap }}>
      {cards.map((card, i) => (
        <PlayingCard
          key={card}
          card={card}
          size={size}
          {...(width === undefined ? {} : { width })}
          dealt={dealt}
          delay={i * 70}
        />
      ))}
    </div>
  )
}
