import { potSize, positionName, type HandState } from '../engine/types'
import type { SessionState } from '../game/session'
import { CardBack, CardRow, PlayingCard } from './Cards'

function SeatView({
  state,
  seat,
  isHero,
  botName,
}: {
  state: HandState
  seat: number
  isHero: boolean
  botName: string | null
}) {
  const s = state.seats[seat]!
  const toAct = state.toAct === seat
  const folded = s.status === 'folded'
  const showCards = isHero || state.result !== null

  return (
    <div
      className={`rounded-xl border px-3 py-2 transition ${
        toAct
          ? 'border-amber-400 bg-amber-400/10'
          : folded
            ? 'border-slate-800 bg-slate-900/40 opacity-45'
            : 'border-slate-700 bg-slate-900/70'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{s.name}</span>
        <span className="text-[11px] tracking-wide text-slate-400">
          {positionName(seat, state.buttonSeat, state.seats.length)}
        </span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {s.holeCards && !folded ? (
            showCards ? (
              <CardRow cards={s.holeCards} size="sm" />
            ) : (
              <>
                <CardBack size="sm" />
                <CardBack size="sm" />
              </>
            )
          ) : (
            <span className="text-xs text-slate-600">folded</span>
          )}
        </div>
        <div className="text-right">
          <div className="font-mono text-sm">{s.stack}</div>
          {s.committed > 0 && <div className="font-mono text-xs text-amber-300">+{s.committed}</div>}
        </div>
      </div>

      {botName && <div className="mt-1 text-[11px] text-slate-500">{botName}</div>}
      {s.status === 'allin' && <div className="text-[11px] font-medium text-rose-300">all in</div>}
    </div>
  )
}

export function Table({ session }: { session: SessionState }) {
  const state = session.current
  if (!state) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-slate-800 bg-[var(--color-felt-dark)] text-slate-500">
        Press Deal to start.
      </div>
    )
  }

  const heroSeat = session.config.heroSeat
  const others = state.seats.map((s) => s.index).filter((i) => i !== heroSeat)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {others.map((seat) => (
          <SeatView
            key={seat}
            state={state}
            seat={seat}
            isHero={false}
            botName={session.config.seats[seat]?.bot ?? null}
          />
        ))}
      </div>

      <div className="rounded-2xl border border-emerald-900/60 bg-[var(--color-felt)] p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-emerald-200/60">
            {state.street}
          </div>
          <div className="flex min-h-20 items-center gap-2">
            {state.board.length === 0 ? (
              <span className="text-sm text-emerald-200/40">no cards yet</span>
            ) : (
              state.board.map((card) => <PlayingCard key={card} card={card} size="lg" />)
            )}
          </div>
          <div className="font-mono text-lg text-emerald-100">Pot {potSize(state)}</div>
        </div>
      </div>

      <div className="mx-auto max-w-sm">
        <SeatView state={state} seat={heroSeat} isHero botName={null} />
      </div>
    </div>
  )
}
