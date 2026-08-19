/**
 * Does the coach bluff too much, and does the arithmetic support it?
 *
 * A bet is a claim about how often the field folds. For a bet of B into a pot
 * of P, made with equity e when it is called, the value against giving up is
 *
 *     EV = f·P + (1 − f)·[ e·(P + B) − (1 − e)·B ]
 *
 * and setting that to zero gives the fold frequency the bet *needs*:
 *
 *     f* = −C / (P − C),    C = e·(P + 2B) − B
 *
 * With no equity at all that reduces to the number every poker book quotes,
 * f* = B / (P + B): a pot-sized bluff has to work half the time. That is the
 * yardstick. This measures every bet the coach recommends against it — what it
 * needed, what the model expected, and what the table actually did — and then
 * against the chips it actually returned.
 *
 *     npx vite-node scripts/bluffs.ts -- --hands 600
 */

import { writeFileSync } from 'node:fs'
import { legalActions } from '../src/engine/hand'
import { potSize, type HandState } from '../src/engine/types'
import {
  createSession, defaultSessionConfig, heroAct, runBotsUntilHero, startNextHand,
} from '../src/game/session'
import { adviseOn, decisionsTaken } from '../src/coach/advise'
import { preflopStrength } from '../src/equity/preflop'

const argv = process.argv.slice(2)
const at = argv.indexOf('--hands')
const HANDS = at >= 0 ? Number(argv[at + 1]) : 400

interface Decision {
  street: string
  /** Equity against the field the model priced this with. */
  equity: number
  /** Where the two cards rank among all starting hands, 1 being the best. */
  rank: number
  action: 'fold' | 'check' | 'call' | 'raise'
  /** Chips the bet adds, and the pot it goes into. */
  bet: number
  pot: number
  /** Fold frequency this bet needs to beat giving up. */
  needs: number
  /** What the model expected the field to do. */
  expected: number
  /** What the field did: 1 if every one of them folded. */
  folded: number | null
  /** The model's price for it, and for the best passive alternative. */
  ev: number
  passiveEv: number
  stackBefore: number
  realised: number
}

/** The fold frequency a bet needs to be worth making at all. */
export function needsToFold(equity: number, bet: number, pot: number): number {
  const called = equity * (pot + 2 * bet) - bet
  if (called >= 0) return 0 // it makes money even when called
  return Math.min(1, -called / (pot - called))
}

/** Did every villain still to act fold to the hero's bet? */
function everyoneFolded(state: HandState, from: number, heroSeat: number): boolean {
  const street = state.actions[from]?.street
  let folded = 0
  for (let i = from + 1; i < state.actions.length; i++) {
    const entry = state.actions[i]!
    if (entry.street !== street) break
    if (entry.seat === heroSeat) break
    if (entry.action.type !== 'fold') return false
    folded += 1
  }
  return folded > 0
}

const session = createSession(defaultSessionConfig(1234))
const heroSeat = session.config.heroSeat
const bb = session.config.bigBlind
const decisions: Decision[] = []

for (let hand = 0; hand < HANDS; hand++) {
  startNextHand(session)
  runBotsUntilHero(session)
  const pending: Decision[] = []

  let guard = 0
  while (session.current!.result === null && guard++ < 60) {
    if (session.current!.toAct !== heroSeat) break
    const state = session.current!
    const advice = adviseOn(state, heroSeat, decisionsTaken(state, heroSeat))
    const best = advice.options[0]!
    const action = best.action

    const hero = state.seats[heroSeat]!
    const pot = potSize(state)
    const bet = action.type === 'raise' ? action.to - hero.committed : 0
    const passive = advice.options.find(
      (o) => o.action.type === 'check' || o.action.type === 'call' || o.action.type === 'fold',
    )
    const before = state.actions.length
    const street = state.street

    const row: Decision = {
      street,
      equity: advice.equity,
      rank: preflopStrength(hero.holeCards!).percentile,
      action: action.type,
      bet,
      pot,
      needs: action.type === 'raise' ? needsToFold(advice.equity, bet, pot) : 0,
      expected: best.foldEquity ?? 0,
      folded: null,
      ev: best.ev,
      passiveEv: passive?.ev ?? 0,
      stackBefore: hero.stack,
      realised: 0,
    }

    heroAct(session, action)
    if (session.current!.result === null) runBotsUntilHero(session)

    if (action.type === 'raise') {
      const after = session.current ?? session.history[session.history.length - 1]!.state
      row.folded = everyoneFolded(after, before, heroSeat) ? 1 : 0
    }
    pending.push(row)
  }

  const finished = session.history[session.history.length - 1]
  if (finished) {
    const ended = finished.state.seats[heroSeat]!.stack
    for (const row of pending) row.realised = ended - row.stackBefore
    decisions.push(...pending)
  }
}

const lines: string[] = []
const say = (line = '') => {
  lines.push(line)
  console.log(line)
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

say('# Does the coach bluff too much?')
say()
say(`${decisions.length} decisions over ${HANDS} hands.`)
say()

// How often is a raise recommended, by how good the hand is?
const BANDS = [
  { label: 'the worst quarter', from: 0, to: 0.25 },
  { label: 'below average', from: 0.25, to: 0.5 },
  { label: 'above average', from: 0.5, to: 0.75 },
  { label: 'the best quarter', from: 0.75, to: 1.01 },
]

say('## What it tells you to do, by how good your hand is')
say()
say('| Starting hand | Decisions | Told to raise | Told to check or call | Told to fold |')
say('|---|---|---|---|---|')
for (const band of BANDS) {
  const inBand = decisions.filter((d) => d.rank >= band.from && d.rank < band.to)
  if (inBand.length === 0) continue
  const share = (type: string) => pct(inBand.filter((d) => d.action === type).length / inBand.length)
  say(
    `| ${band.label} | ${inBand.length} | ${share('raise')} | ` +
      `${pct(inBand.filter((d) => d.action === 'check' || d.action === 'call').length / inBand.length)} | ` +
      `${share('fold')} |`,
  )
}

// The arithmetic, for the bets it recommends.
say()
say('## What those bets need, and what they get')
say()
say('| Starting hand | Bets | Size vs pot | Needs them to fold | Model expects | They actually fold | Returned |')
say('|---|---|---|---|---|---|---|')
for (const band of BANDS) {
  const bets = decisions.filter(
    (d) => d.action === 'raise' && d.rank >= band.from && d.rank < band.to,
  )
  if (bets.length === 0) continue
  say(
    `| ${band.label} | ${bets.length} | ` +
      `${mean(bets.map((d) => d.bet / Math.max(1, d.pot))).toFixed(2)}× | ` +
      `${pct(mean(bets.map((d) => d.needs)))} | ` +
      `${pct(mean(bets.map((d) => d.expected)))} | ` +
      `${pct(mean(bets.filter((d) => d.folded !== null).map((d) => d.folded!)))} | ` +
      `${(mean(bets.map((d) => d.realised)) / bb).toFixed(2)}bb |`,
  )
}

// The sharpest cut: bets made with a hand that has almost nothing.
const pure = decisions.filter((d) => d.action === 'raise' && d.equity < 0.35)
say()
say('## The ones that are close to pure bluffs')
say()
if (pure.length > 0) {
  say(
    `${pure.length} bets were made holding under 35% equity. They needed the field to fold ` +
      `**${pct(mean(pure.map((d) => d.needs)))}** of the time to be worth making at all. ` +
      `The model expected **${pct(mean(pure.map((d) => d.expected)))}**. The field folded ` +
      `**${pct(mean(pure.filter((d) => d.folded !== null).map((d) => d.folded!)))}**.`,
  )
  say()
  say(
    `The model priced them at ${(mean(pure.map((d) => d.ev)) / bb).toFixed(2)}bb against ` +
      `${(mean(pure.map((d) => d.passiveEv)) / bb).toFixed(2)}bb for giving up. They returned ` +
      `**${(mean(pure.map((d) => d.realised)) / bb).toFixed(2)}bb**.`,
  )
  const short = pure.filter((d) => d.expected < d.needs)
  say()
  say(
    `On its own numbers, ${short.length} of ${pure.length} (${pct(short.length / pure.length)}) ` +
      `were recommended while the model itself expected fewer folds than the bet needed.`,
  )
}

writeFileSync('bluff-report.md', `${lines.join('\n')}\n`)
console.log('\nWritten to bluff-report.md')
