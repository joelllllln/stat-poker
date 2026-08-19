/**
 * Is the joint fold probability wrong because the opponents share a deck?
 *
 * The model multiplies each opponent's chance of folding as though they
 * decided independently. They are dealt from one deck: a weak hand at one seat
 * leaves the strong cards available to the next. This compares the product
 * with a joint deal under the model's own rules, and both with what happened.
 */
import { Rng } from '../src/engine/cards'
import type { HandState } from '../src/engine/types'
import {
  createSession, defaultSessionConfig, heroAct, runBotsUntilHero, startNextHand,
} from '../src/game/session'
import { adviseOn, decisionsTaken } from '../src/coach/advise'
import { legalActions } from '../src/engine/hand'
import { modelOpponentRange } from '../src/equity/opponent'
import { preflopStrength } from '../src/equity/preflop'
import { defendWidthOf, preflopRaises, styleAt } from '../src/coach/opponents'
import { rangeWeight } from '../src/equity/range'

/** The model's own marginal fold probability for one villain, preflop. */
function marginalFold(state: HandState, seat: number): number | null {
  const style = styleAt(state, seat)
  if (!style) return null
  const width = defendWidthOf(style, preflopRaises(state) + 1)
  const range = modelOpponentRange(state, seat)
  const total = rangeWeight(range)
  if (total === 0) return null
  let folding = 0
  for (const combo of range) {
    if (preflopStrength(combo.cards).percentile < 1 - width) folding += combo.weight
  }
  return folding / total
}

/**
 * The same rules, but dealing every villain a hand from one deck.
 *
 * Their ranges are all "the top w% of starting hands", and the model's rule is
 * a threshold on where the hand ranks, so a joint deal is just a deal.
 */
function jointFold(state: HandState, villains: number[], rng: Rng, trials: number): number {
  const dead = new Set<number>()
  for (const card of state.board) dead.add(card)
  const hero = state.seats.find((s) => s.holeCards && !villains.includes(s.index))
  if (hero?.holeCards) {
    dead.add(hero.holeCards[0])
    dead.add(hero.holeCards[1])
  }

  // Each villain is dealt from its own modelled range, not from the deck: the
  // point of the comparison is the shared deck, not a different range model.
  const seats = villains.map((seat) => {
    const style = styleAt(state, seat)
    const range = modelOpponentRange(state, seat).filter(
      (combo) => !dead.has(combo.cards[0]) && !dead.has(combo.cards[1]),
    )
    const total = range.reduce((sum, combo) => sum + combo.weight, 0)
    return {
      range,
      total,
      bar: style ? 1 - defendWidthOf(style, preflopRaises(state) + 1) : null,
    }
  })
  if (seats.some((seat) => seat.total <= 0)) return 0

  let all = 0
  let dealt = 0
  for (let t = 0; t < trials * 8 && dealt < trials; t++) {
    const used = new Set<number>()
    let every = true
    let ok = true
    for (const seat of seats) {
      // Draw one combo by weight, and give up on the deal if it clashes.
      let target = rng.nextFloat() * seat.total
      let picked = seat.range[seat.range.length - 1]!
      for (const combo of seat.range) {
        target -= combo.weight
        if (target <= 0) { picked = combo; break }
      }
      if (used.has(picked.cards[0]) || used.has(picked.cards[1])) { ok = false; break }
      used.add(picked.cards[0])
      used.add(picked.cards[1])
      if (seat.bar !== null && preflopStrength(picked.cards).percentile >= seat.bar) every = false
    }
    if (!ok) continue
    dealt += 1
    if (every) all += 1
  }
  return dealt > 0 ? all / dealt : 0
}

const at = process.argv.indexOf('--hands')
const HANDS = at >= 0 ? Number(process.argv[at + 1]) : 150

let bets = 0, product = 0, joint = 0, observed = 0
const rng = new Rng(555)
const session = createSession(defaultSessionConfig(1234))
const heroSeat = session.config.heroSeat

for (let hand = 0; hand < HANDS; hand++) {
  startNextHand(session)
  runBotsUntilHero(session)
  let guard = 0
  while (session.current!.result === null && guard++ < 60) {
    if (session.current!.toAct !== heroSeat) break
    const state = session.current!
    const raise = legalActions(state).find((o) => o.type === 'raise')
    const advice = adviseOn(state, heroSeat, decisionsTaken(state, heroSeat))
    const action = raise
      ? advice.options.find((o) => o.action.type === 'raise')?.action ?? advice.options[0]!.action
      : advice.options[0]!.action

    const preflop = state.street === 'preflop' && action.type === 'raise'
    const villains = state.seats
      .filter((s) => s.index !== heroSeat && s.status !== 'folded')
      .map((s) => s.index)
    const before = state.actions.length

    let marginals: number[] = []
    let jointHere = 0
    if (preflop) {
      marginals = villains.map((s) => marginalFold(state, s) ?? 1)
      jointHere = jointFold(state, villains, rng, 400)
    }

    heroAct(session, action)
    if (session.current!.result === null) runBotsUntilHero(session)

    if (preflop) {
      const after = session.current ?? session.history[session.history.length - 1]!.state
      let all = true, any = false
      for (const seat of villains) {
        const acted = after.actions
          .slice(before + 1)
          .find((e) => e.seat === seat && e.street === 'preflop')
        if (!acted) { all = false; continue }
        any = true
        if (acted.action.type !== 'fold') all = false
      }
      bets += 1
      product += marginals.reduce((p, f) => p * f, 1)
      joint += jointHere
      observed += any && all ? 1 : 0
    }
  }
}

console.log(`preflop bets: ${bets}`)
console.log(`  product of marginals : ${((product / bets) * 100).toFixed(1)}%`)
console.log(`  joint, one deck      : ${((joint / bets) * 100).toFixed(1)}%`)
console.log(`  actually all folded  : ${((observed / bets) * 100).toFixed(1)}%`)
