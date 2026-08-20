/**
 * The table you sit down at.
 *
 * Everything about a game that is decided before a card is dealt: how many
 * seats, what the blinds are, what everybody buys in for, and who is sitting
 * there. It is separate from the session because it is a *choice*, made once
 * and then lived with — the session is what happens next.
 *
 * The rules here are the ones the engine would otherwise discover the hard
 * way. Two players is a game and ten is not one this app deals; a big blind
 * has to be more than a small blind or the betting has no ladder to climb; a
 * stack shorter than a big blind cannot post it. Each of those is a real
 * constraint rather than a matter of taste, so each is checked in one place
 * and reported in words, and nothing downstream has to defend itself against a
 * table that could not exist.
 */

import { ARCHETYPES, ARCHETYPE_IDS } from '../bots/archetypes'
import { Rng } from '../engine/cards'
import type { SeatConfig, SessionConfig } from './session'

/** The sizes the app deals. Heads-up at one end, a full ring at the other. */
export const MIN_SEATS = 2
export const MAX_SEATS = 9

/** What a seat can afford to be, in big blinds. */
export const MIN_STACK_BB = 10
export const MAX_STACK_BB = 500

export interface TableConfig {
  /** Everyone at the table, the player included. */
  seats: number
  smallBlind: number
  bigBlind: number
  /** What every seat starts with, and is topped back up to. */
  buyIn: number
  /**
   * Which kinds of opponent may be seated, as archetype ids.
   *
   * A pool rather than a running order: each seat is drawn from it at random,
   * so picking two kinds at a six-handed table might give you four of one and
   * one of the other. That is the point — a table with exactly one of each is
   * a shape you learn to read, and no real table has it.
   */
  opponents: string[]
  /**
   * Sit down against strangers.
   *
   * Every style is in the pool, and nothing on screen says which seat is
   * which — no style badge, and names that carry no hint. Reading an opponent
   * from how they play is the skill; being told is the answer key, and there
   * has to be a way to put the answer key away.
   */
  random: boolean
}

/** A six-handed game against one of each, which is the game this app grew up on. */
export const DEFAULT_TABLE: TableConfig = {
  seats: 6,
  smallBlind: 1,
  bigBlind: 2,
  buyIn: 200,
  opponents: ['nit', 'tag', 'lag', 'station', 'maniac'],
  random: false,
}

/**
 * What is wrong with this table, in words, or nothing.
 *
 * Returns every fault rather than the first, because a setup screen that
 * reports one problem at a time makes somebody fix a form three times.
 */
export function faultsIn(table: TableConfig): string[] {
  const faults: string[] = []

  if (!Number.isInteger(table.seats) || table.seats < MIN_SEATS || table.seats > MAX_SEATS) {
    faults.push(`A table seats ${MIN_SEATS} to ${MAX_SEATS} players.`)
  }
  if (!Number.isInteger(table.smallBlind) || table.smallBlind < 1) {
    faults.push('The small blind has to be at least one chip.')
  }
  if (!Number.isInteger(table.bigBlind) || table.bigBlind < 2) {
    faults.push('The big blind has to be at least two chips.')
  }
  if (table.bigBlind <= table.smallBlind) {
    faults.push('The big blind has to be bigger than the small blind.')
  }
  if (!Number.isInteger(table.buyIn) || table.buyIn < table.bigBlind * MIN_STACK_BB) {
    faults.push(
      `A stack of ${MIN_STACK_BB} big blinds is the shortest worth playing — ` +
        `${table.bigBlind * MIN_STACK_BB} chips at these blinds.`,
    )
  }
  if (table.buyIn > table.bigBlind * MAX_STACK_BB) {
    faults.push(`Stacks stop at ${MAX_STACK_BB} big blinds.`)
  }
  // A random table draws from every style, so an empty pool is only a fault
  // when the pool is what the table is made from.
  if (!table.random && table.opponents.length === 0) {
    faults.push('Pick at least one kind of opponent.')
  }
  for (const id of table.opponents) {
    if (!ARCHETYPE_IDS.includes(id)) faults.push(`There is no player called "${id}".`)
  }

  return faults
}

export const isPlayable = (table: TableConfig): boolean => faultsIn(table).length === 0

/**
 * Name the opponents so a table of three Rocks is readable.
 *
 * The archetype's own name where there is one of it, numbered where there are
 * several. "Rock" and "Rock 2" is how a person would say it, and the numbering
 * only appears once it is needed.
 */
function nameSeats(ids: string[]): string[] {
  const total = new Map<string, number>()
  for (const id of ids) total.set(id, (total.get(id) ?? 0) + 1)

  const seen = new Map<string, number>()
  return ids.map((id) => {
    // "The Rock" is the archetype; "Rock" is what you call it at the table.
    const base = (ARCHETYPES[id]?.name ?? id).replace(/^The /, '')
    const n = (seen.get(id) ?? 0) + 1
    seen.set(id, n)
    return (total.get(id) ?? 0) > 1 ? `${base} ${n}` : base
  })
}

/**
 * Names for a table of strangers.
 *
 * Short, so they fit on a plate, and deliberately saying nothing: "Rock" and
 * "Maniac" are how somebody plays, and half the point of a random table is
 * that you have to work that out rather than read it off the felt.
 */
const STRANGERS = [
  'Ari', 'Bo', 'Cleo', 'Dana', 'Eli', 'Fen', 'Gio', 'Hal', 'Ines', 'Jo',
  'Kai', 'Lena', 'Milo', 'Nadia', 'Otto', 'Pia', 'Rey', 'Sam', 'Tess', 'Uma',
]

/** Pick `count` distinct names, in a shuffled order. */
function strangerNames(count: number, rng: Rng): string[] {
  const pool = [...STRANGERS]
  const picked: string[] = []
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) {
      // More seats than names, which the table sizes make impossible today.
      picked.push(`Seat ${i + 2}`)
      continue
    }
    picked.push(pool.splice(rng.nextInt(pool.length), 1)[0]!)
  }
  return picked
}

/** The styles a table may seat: every one of them, or the ones chosen. */
export const poolFor = (table: TableConfig): string[] =>
  table.random ? [...ARCHETYPE_IDS] : table.opponents

/**
 * The opponents this table seats, in order.
 *
 * Each seat is drawn from the pool independently, so the mix is different
 * every time you sit down — four maniacs and a rock is a table that happens,
 * and it is a different game from one of each. `seed` is what makes it a draw
 * rather than a shuffle you can predict, and what makes the same sitting deal
 * the same table twice.
 */
export function opponentsFor(table: TableConfig, seed = 0): string[] {
  const wanted = table.seats - 1
  const pool = poolFor(table)
  if (wanted <= 0 || pool.length === 0) return []
  const rng = new Rng(seed)
  return Array.from({ length: wanted }, () => pool[rng.nextInt(pool.length)]!)
}

/** The seats of this table, the player first. */
export function seatsFor(table: TableConfig, seed = 0): SeatConfig[] {
  const ids = opponentsFor(table, seed)
  // Named from a separate stream so that who is sitting where and what they
  // are called are independent: reusing the draw would make the name a tell.
  const names = table.random
    ? strangerNames(ids.length, new Rng(seed ^ 0x5f5f5f5f))
    : nameSeats(ids)
  return [
    { name: 'You', bot: null, hidden: false },
    ...ids.map((bot, i) => ({ name: names[i]!, bot, hidden: table.random })),
  ]
}

/**
 * Turn a chosen table into a session to play at it.
 *
 * Throws on a table that is not playable rather than dealing a broken game:
 * the setup screen will not let one through, so reaching here with one is a
 * bug and should read like one.
 */
export function sessionConfigFor(table: TableConfig, seed: number): SessionConfig {
  const faults = faultsIn(table)
  if (faults.length > 0) throw new Error(`That table cannot be dealt: ${faults.join(' ')}`)

  return {
    seats: seatsFor(table, seed),
    heroSeat: 0,
    buyIn: table.buyIn,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    seed,
  }
}

/**
 * What a table of this size is called, which is how players talk about it.
 *
 * Lives here rather than on the setup screen because the game itself has to
 * name the table it is dealing: everything used to be six-max, and now the
 * only place that is true is a table with six seats at it.
 */
export function tableName(seats: number): string {
  if (seats === 2) return 'Heads-up'
  if (seats <= 4) return 'Short-handed'
  if (seats <= 6) return 'Six-max'
  return 'Full ring'
}
