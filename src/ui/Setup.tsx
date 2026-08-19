import { useState } from 'react'
import { ARCHETYPES, ARCHETYPE_IDS } from '../bots/archetypes'
import {
  DEFAULT_TABLE,
  MAX_SEATS,
  MAX_STACK_BB,
  MIN_SEATS,
  MIN_STACK_BB,
  faultsIn,
  seatsFor,
  type TableConfig,
} from '../game/table'
import { seatSpots, seatWidthFor } from './Table'

/**
 * Choosing a table, before sitting down at one.
 *
 * A poker game starts by picking a game — how many seats, what it costs, who
 * is in it. Doing that at the door is most of what separates a game from a
 * demo, and it also puts the one honest warning where it belongs: the shape of
 * the table changes what you are practising, and somebody choosing eight
 * maniacs at five big blinds should be told they have chosen a novelty rather
 * than discovering it forty hands later.
 *
 * Every choice is shown against its consequence in the same breath — a stack
 * in chips *and* in big blinds, a seat count *and* what that game is called —
 * because the numbers only mean something next to each other.
 */

/** Stakes worth offering, rather than a free-text field nobody wants. */
const STAKES: { label: string; smallBlind: number; bigBlind: number }[] = [
  { label: '1 / 2', smallBlind: 1, bigBlind: 2 },
  { label: '2 / 5', smallBlind: 2, bigBlind: 5 },
  { label: '5 / 10', smallBlind: 5, bigBlind: 10 },
  { label: '25 / 50', smallBlind: 25, bigBlind: 50 },
]

const STACKS: { label: string; bb: number }[] = [
  { label: 'Short', bb: 40 },
  { label: 'Normal', bb: 100 },
  { label: 'Deep', bb: 200 },
]

/** What a table of this size is called, which is how players talk about it. */
function tableName(seats: number): string {
  if (seats === 2) return 'Heads-up'
  if (seats <= 4) return 'Short-handed'
  if (seats <= 6) return 'Six-max'
  return 'Full ring'
}

function Choice({
  label,
  hint,
  chosen,
  onClick,
}: {
  label: string
  hint?: string
  chosen: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={chosen}
      className={`min-h-11 flex-1 rounded-md px-3 text-sm transition ${
        chosen
          ? 'plaque plaque-brass'
          : 'plaque text-[color:var(--color-bone-dim)]'
      }`}
    >
      <span className="block leading-tight">{label}</span>
      {hint && (
        <span className="block text-[10px] font-normal normal-case tracking-normal opacity-70">
          {hint}
        </span>
      )}
    </button>
  )
}

/** A little picture of the table you are about to sit at. */
function Seating({ table }: { table: TableConfig }) {
  const spots = seatSpots(table.seats)
  const width = seatWidthFor(table.seats)
  const seats = seatsFor(table)

  return (
    <div className="felt relative mx-auto aspect-[16/10] w-full max-w-sm overflow-hidden rounded-[45%/38%]">
      {spots.map((spot, i) => (
        <div
          key={i}
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-md px-1 py-0.5 text-center ${
            i === 0
              ? 'bg-[color:var(--color-brass)] text-[#26200c]'
              : 'bg-[color:var(--color-ink-2)]/90 text-[color:var(--color-bone-dim)]'
          }`}
          style={{
            left: `${spot.left}%`,
            top: `${spot.top}%`,
            width: `${width}%`,
            fontSize: 'clamp(7px, 2.2cqw, 10px)',
          }}
        >
          <span className="block truncate">{seats[i]?.name ?? ''}</span>
        </div>
      ))}
    </div>
  )
}

export function Setup({
  table: initial,
  onSitDown,
  canReturn,
  onReturn,
}: {
  table: TableConfig
  onSitDown: (table: TableConfig) => void
  /** True once a game is already in progress behind this screen. */
  canReturn: boolean
  onReturn: () => void
}) {
  const [table, setTable] = useState<TableConfig>(initial)
  const change = (over: Partial<TableConfig>) => setTable((t) => ({ ...t, ...over }))
  const faults = faultsIn(table)
  const stackBB = Math.round(table.buyIn / table.bigBlind)

  /** Keep the stack the same depth in blinds when the stakes change. */
  const setStakes = (smallBlind: number, bigBlind: number) =>
    change({
      smallBlind,
      bigBlind,
      buyIn: Math.min(
        bigBlind * MAX_STACK_BB,
        Math.max(bigBlind * MIN_STACK_BB, stackBB * bigBlind),
      ),
    })

  const toggleOpponent = (id: string) => {
    const has = table.opponents.includes(id)
    const next = has ? table.opponents.filter((o) => o !== id) : [...table.opponents, id]
    // Never leave the table with nobody in it.
    change({ opponents: next.length === 0 ? [id] : next })
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div className="plate p-4">
        <div className="stamp">Choose a table</div>
        <h2 className="figure mt-1 text-3xl">
          {tableName(table.seats)} · {table.smallBlind}/{table.bigBlind}
        </h2>
        <p className="mt-1 text-sm text-[color:var(--color-bone-dim)]">
          {table.seats} seats · {stackBB} big blinds each ·{' '}
          {table.opponents.length === 1
            ? `everyone plays like ${ARCHETYPES[table.opponents[0]!]?.name ?? table.opponents[0]!}`
            : `${table.opponents.length} kinds of opponent`}
        </p>
      </div>

      <div className="plate p-4">
        <Seating table={table} />
      </div>

      <div className="plate space-y-2 p-4">
        <div className="stamp">Players</div>
        <input
          type="range"
          min={MIN_SEATS}
          max={MAX_SEATS}
          value={table.seats}
          onChange={(event) => change({ seats: Number(event.target.value) })}
          aria-label="Players at the table"
          className="h-11 w-full accent-[color:var(--color-brass)]"
        />
        <div className="flex justify-between text-xs text-[color:var(--color-bone-faint)]">
          <span>{MIN_SEATS} — heads-up</span>
          <span className="text-base font-semibold text-[color:var(--color-bone)]">
            {table.seats}
          </span>
          <span>{MAX_SEATS} — full ring</span>
        </div>
      </div>

      <div className="plate space-y-2 p-4">
        <div className="stamp">Blinds</div>
        <div className="flex flex-wrap gap-2">
          {STAKES.map((stake) => (
            <Choice
              key={stake.label}
              label={stake.label}
              chosen={table.smallBlind === stake.smallBlind && table.bigBlind === stake.bigBlind}
              onClick={() => setStakes(stake.smallBlind, stake.bigBlind)}
            />
          ))}
        </div>
      </div>

      <div className="plate space-y-2 p-4">
        <div className="stamp">Stack</div>
        <div className="flex flex-wrap gap-2">
          {STACKS.map((stack) => (
            <Choice
              key={stack.label}
              label={stack.label}
              hint={`${stack.bb}bb · ${stack.bb * table.bigBlind} chips`}
              chosen={stackBB === stack.bb}
              onClick={() => change({ buyIn: stack.bb * table.bigBlind })}
            />
          ))}
        </div>
      </div>

      <div className="plate space-y-2 p-4">
        <div className="stamp">Who you are playing</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {ARCHETYPE_IDS.map((id) => {
            const style = ARCHETYPES[id]!
            const chosen = table.opponents.includes(id)
            return (
              <button
                key={id}
                onClick={() => toggleOpponent(id)}
                aria-pressed={chosen}
                className={`rounded-md p-3 text-left transition ${
                  chosen
                    ? 'plate-brass'
                    : 'plate opacity-60'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-semibold text-[color:var(--color-bone)]">
                    {style.name}
                  </span>
                  <span className="text-xs text-[color:var(--color-bone-faint)]">
                    {chosen ? 'at the table' : 'sitting out'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-[color:var(--color-bone-dim)]">
                  {style.blurb}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {faults.length > 0 && (
        <div className="plate p-3 text-sm text-[color:var(--color-oxblood)]">
          {faults.map((fault) => (
            <p key={fault}>{fault}</p>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {canReturn && (
          <button onClick={onReturn} className="plaque min-h-14 flex-1 px-4 text-sm">
            Back to the game
          </button>
        )}
        <button
          onClick={() => onSitDown(table)}
          disabled={faults.length > 0}
          className="plaque plaque-brass min-h-14 flex-[2] px-4 text-base disabled:opacity-40"
        >
          Sit down
        </button>
      </div>

      <p className="px-1 text-xs leading-snug text-[color:var(--color-bone-faint)]">
        Sitting down starts a new game: fresh stacks, a fresh button, hand one. Hands you have
        already played stay in your record — they happened, at whatever table they happened at.
      </p>
      {table.seats !== DEFAULT_TABLE.seats && (
        <p className="px-1 text-xs leading-snug text-[color:var(--color-bone-faint)]">
          Worth knowing: the shape of the table changes what you are practising. A short-handed
          game plays far more hands than a full ring, and the coach prices every seat by how that
          player plays rather than by a rule of thumb, so its advice moves with the table too.
        </p>
      )}
    </div>
  )
}
