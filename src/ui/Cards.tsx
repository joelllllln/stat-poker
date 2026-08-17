import { RANKS, rankOf, suitOf, type Card } from '../engine/cards'

const GLYPHS = ['♣', '♦', '♥', '♠']
const IS_RED = [false, true, true, false]

export function PlayingCard({ card, size = 'md' }: { card: Card; size?: 'sm' | 'md' | 'lg' }) {
  const rank = RANKS[rankOf(card)]!
  const suit = suitOf(card)
  const dims =
    size === 'lg'
      ? 'w-14 h-20 text-2xl'
      : size === 'sm'
        ? 'w-7 h-10 text-sm'
        : 'w-10 h-14 text-lg'

  return (
    <div
      className={`${dims} flex flex-col items-center justify-center rounded-md bg-white font-semibold leading-none shadow-md ${
        IS_RED[suit] ? 'text-rose-600' : 'text-slate-900'
      }`}
    >
      <span>{rank}</span>
      <span className="text-[0.8em]">{GLYPHS[suit]}</span>
    </div>
  )
}

export function CardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const dims =
    size === 'lg' ? 'w-14 h-20' : size === 'sm' ? 'w-7 h-10' : 'w-10 h-14'
  return (
    <div
      className={`${dims} rounded-md border border-slate-700 bg-gradient-to-br from-slate-700 to-slate-800 shadow-md`}
    />
  )
}

export function CardRow({ cards, size = 'md' }: { cards: readonly Card[]; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className="flex gap-1">
      {cards.map((card) => (
        <PlayingCard key={card} card={card} size={size} />
      ))}
    </div>
  )
}
