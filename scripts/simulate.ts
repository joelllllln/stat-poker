/**
 * Serious play, headless.
 *
 * The tests prove the parts are right. This asks the question the tests do
 * not: does the whole thing behave like a poker game, and does the app's
 * central promise hold — that a player who follows the coach gives up nothing
 * and beats opponents who do not?
 *
 * Several hero policies play the same bots over the same decks, and everything
 * they do is measured: money won, expected value given up, how the grader
 * rates them, what the profile calls them, and how long every part of the
 * machinery takes. Run it with
 *
 *     npx vite-node scripts/simulate.ts -- --hands 2000
 *
 * and it writes a report to `simulation-report.md`.
 */

import { writeFileSync } from 'node:fs'
import { Rng } from '../src/engine/cards'
import { legalActions } from '../src/engine/hand'
import { potSize, type Action, type HandState, type Street } from '../src/engine/types'
import {
  createSession,
  defaultSessionConfig,
  heroAct,
  runBotsUntilHero,
  startNextHand,
  type HandRecord,
  type SessionState,
} from '../src/game/session'
import { adviseOn, decisionsTaken } from '../src/coach/advise'
import { evaluate, categoryOf, HandCategory } from '../src/engine/evaluator'
import { preflopStrength } from '../src/equity/preflop'
import { gradeHand } from '../src/coach/grade'
import { aggregate } from '../src/stats/hand-stats'
import { buildProfile, winrateInterval } from '../src/stats/profile'
import { luckCurve } from '../src/stats/all-in-adjusted'
import { biggestLeak, describeLeak, findLeaks, tagDecisions } from '../src/coach/leaks'
import { toStored } from '../src/stats/serialize'
import { hydrate } from '../src/stats/archive'
import { blocks, blockSizeFor, describeMovement } from '../src/stats/timeline'

interface Policy {
  name: string
  blurb: string
  /** Chosen from the options the engine says are legal. */
  act: (state: HandState, heroSeat: number, rng: Rng) => Action
  /** Costly policies play fewer hands. */
  scale?: number
}

const pick = <T,>(options: T[], rng: Rng): T => options[rng.nextInt(options.length)]!

/**
 * The coach's answer for a decision, worked out once.
 *
 * Pricing a decision costs about a tenth of a second, and the simulation wants
 * the same answer twice — to play it, and to record what it predicted. Asking
 * twice doubled the cost of every coach run for nothing; the position is a
 * fresh object at every decision, so its identity is the cache key.
 */
let askedAbout: HandState | null = null
let lastAnswer: ReturnType<typeof adviseOn> | null = null
function coachOn(state: HandState, heroSeat: number) {
  if (askedAbout !== state) {
    askedAbout = state
    lastAnswer = adviseOn(state, heroSeat, decisionsTaken(state, heroSeat))
  }
  return lastAnswer!
}

/** Two actions are the same decision only if they are the same size, too. */
const sameAction = (a: Action, b: Action): boolean =>
  a.type === b.type && (a.type !== 'raise' || b.type !== 'raise' || a.to === b.to)

/** A raise to about `fraction` of the pot, clamped to what is legal. */
function raiseTo(state: HandState, heroSeat: number, fraction: number): number | null {
  const option = legalActions(state).find((o) => o.type === 'raise')
  if (!option) return null
  const hero = state.seats[heroSeat]!
  const toCall = Math.max(0, state.currentBet - hero.committed)
  const target = state.currentBet + (potSize(state) + toCall) * fraction
  return Math.max(option.min!, Math.min(option.max!, Math.round(target)))
}

const POLICIES: Policy[] = [
  {
    name: 'Coach',
    blurb: 'plays whatever the live coach says is worth the most',
    scale: 0.4,
    act: (state, heroSeat) => coachOn(state, heroSeat).options[0]!.action,
  },
  {
    name: 'Solid human',
    blurb: 'a plain tight-aggressive rule: strong hands bet, weak hands fold',
    act: (state, heroSeat) => {
      const options = legalActions(state)
      const hero = state.seats[heroSeat]!
      const toCall = Math.max(0, state.currentBet - hero.committed)
      const can = (type: Action['type']) => options.some((o) => o.type === type)
      const passive = (): Action =>
        can('check') ? { type: 'check' } : can('fold') ? { type: 'fold' } : { type: 'call' }

      if (state.board.length === 0) {
        const percentile = preflopStrength(hero.holeCards!).percentile
        if (percentile >= 0.86) {
          const to = raiseTo(state, heroSeat, 0.75)
          if (to !== null) return { type: 'raise', to }
        }
        if (percentile >= 0.7 && toCall <= state.bigBlind * 4 && can('call')) {
          return { type: 'call' }
        }
        return passive()
      }

      // Postflop by what the hand actually is: a rule anybody could follow.
      const made = categoryOf(evaluate([...hero.holeCards!, ...state.board]))
      if (made >= HandCategory.TwoPair) {
        const to = raiseTo(state, heroSeat, 0.75)
        if (to !== null) return { type: 'raise', to }
        return can('call') ? { type: 'call' } : passive()
      }
      if (made >= HandCategory.Pair) {
        if (toCall === 0) return passive()
        return toCall <= potSize(state) / 3 && can('call') ? { type: 'call' } : passive()
      }
      return passive()
    },
  },
  {
    name: 'Always fold',
    blurb: 'folds everything it is allowed to fold',
    act: (state) =>
      legalActions(state).some((o) => o.type === 'fold') ? { type: 'fold' } : { type: 'check' },
  },
  {
    name: 'Calling station',
    blurb: 'never folds and never raises',
    act: (state) => {
      const options = legalActions(state)
      if (options.some((o) => o.type === 'check')) return { type: 'check' }
      if (options.some((o) => o.type === 'call')) return { type: 'call' }
      return { type: 'fold' }
    },
  },
  {
    name: 'Maniac',
    blurb: 'raises pot whenever it can',
    act: (state, heroSeat) => {
      const to = raiseTo(state, heroSeat, 1)
      if (to !== null) return { type: 'raise', to }
      const options = legalActions(state)
      return options.some((o) => o.type === 'check') ? { type: 'check' } : { type: 'call' }
    },
  },
  {
    name: 'Random',
    blurb: 'picks uniformly among the legal actions',
    act: (state, _heroSeat, rng) => {
      const choice = pick(legalActions(state), rng)
      return choice.type === 'raise' ? { type: 'raise', to: choice.min! } : { type: choice.type }
    },
  },
]

/**
 * Does the field fold as often as the coach says it will?
 *
 * This is the measurement the coach lives or dies by: it prices every bet by
 * how often it expects the field to fold, so a model whose opponents are not
 * the opponents will bet at prices that do not exist. Counting the difference
 * is what caught it doing exactly that.
 *
 * Split by street, because the two halves of the model are different claims —
 * postflop the opponents weigh a price, preflop they defend a slice of their
 * range and the price does not enter into it — and a single average hides one
 * being wrong behind the other being right.
 */
interface Tally {
  bets: number
  predicted: number
  observed: number
}

type Calibration = Tally & { byStreet: Map<Street, Tally> }

/**
 * Is an action worth what the coach says it is worth?
 *
 * Every price the coach quotes is a prediction about the rest of the hand: it
 * says this action is worth so many chips more than folding. Folding is worth
 * exactly nothing more, so what the action actually returned is simply the
 * stack at the end of the hand less the stack at the moment of the decision —
 * no model, no assumption, just the chips.
 *
 * The gap between the two is the part of the model that is not the fold
 * equity. This is a **one-street** model: it prices the branch where the bet is
 * called as though the hand went straight to showdown, and everything that
 * happens on the streets after it lands here.
 */
interface Promised {
  decisions: number
  /** Chips the model said these actions were worth, relative to folding. */
  model: number
  /** Chips they actually returned. */
  realised: number
  /** Sum of squared realised values, for the standard error on the gap. */
  realisedSquares: number
}

const promise = (into: Map<Street, Promised>, street: Street): Promised => {
  const found = into.get(street) ?? { decisions: 0, model: 0, realised: 0, realisedSquares: 0 }
  into.set(street, found)
  return found
}

const tally = (into: Map<Street, Tally>, street: Street): Tally => {
  const found = into.get(street) ?? { bets: 0, predicted: 0, observed: 0 }
  into.set(street, found)
  return found
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

interface Outcome {
  policy: Policy
  hands: number
  records: HandRecord[]
  seconds: number
  decisions: number
  /** Milliseconds spent choosing, which is what a player would wait. */
  decisionMs: number
  calibration: Calibration
  promised: Promised & {
    byStreet: Map<Street, Promised>
    /** Decisions after which the hero never acted again: the hand ended there. */
    settled: Promised
    /** Decisions the hero had to follow up on, which is where a horizon bites. */
    playedOn: Promised
    /** By what the hero did, which separates a bad equity from a bad bluff. */
    byAction: Map<string, Promised>
  }
}

function play(policy: Policy, hands: number, seed: number): Outcome {
  const session: SessionState = createSession(defaultSessionConfig(seed))
  const rng = new Rng(seed + 7)
  const started = Date.now()
  let decisions = 0
  let decisionMs = 0
  const calibration: Calibration = { bets: 0, predicted: 0, observed: 0, byStreet: new Map() }
  const blank = (): Promised => ({ decisions: 0, model: 0, realised: 0, realisedSquares: 0 })
  const promised = {
    ...blank(),
    byStreet: new Map<Street, Promised>(),
    // Where the hero never acted again — the field folded, or the chips were
    // all in — the hand ended on the street the model priced, and the model is
    // exact there. Holding those apart is what separates "the price is wrong"
    // from "the price is right and the hand that follows it is not".
    settled: blank(),
    playedOn: blank(),
    byAction: new Map<string, Promised>(),
  }
  /** Decisions in the hand being played, waiting for it to end and settle. */
  const awaiting: {
    street: Street
    kind: Action['type']
    ev: number
    stackBefore: number
    nth: number
  }[] = []
  /** How many decisions the hero has made in the hand, folds included. */
  let heroDecisions = 0

  for (let hand = 0; hand < hands; hand++) {
    startNextHand(session)
    runBotsUntilHero(session)

    let guard = 0
    while (session.current!.result === null && guard++ < 60) {
      if (session.current!.toAct !== session.config.heroSeat) break
      const at = Date.now()
      const state = session.current!
      const action = policy.act(state, session.config.heroSeat, rng)
      decisionMs += Date.now() - at
      decisions += 1

      // Only the coach knows what it predicted, so only the coach is scored on
      // it — and only for bets, which is where the prediction does the work.
      let predicted: number | null = null
      if (policy.name === 'Coach') {
        const advice = coachOn(state, session.config.heroSeat)
        if (action.type === 'raise') {
          predicted =
            advice.options.find((option) => option.action.type === 'raise')?.foldEquity ?? null
        }
        // What the coach says this action is worth, to be compared with what
        // it returns once the hand is over. Folding is the zero point on both
        // sides of that comparison, so it carries no information.
        const priced = advice.options.find((option) => sameAction(option.action, action))
        if (priced && action.type !== 'fold') {
          awaiting.push({
            street: state.street,
            kind: action.type,
            ev: priced.ev,
            stackBefore: state.seats[session.config.heroSeat]!.stack,
            nth: heroDecisions,
          })
        }
        heroDecisions += 1
      }
      const before = state.actions.length
      const street = state.street

      heroAct(session, action)
      if (session.current!.result === null) runBotsUntilHero(session)

      if (predicted !== null) {
        const after = session.current ?? session.history[session.history.length - 1]!.state
        const folded = everyoneFolded(after, before, session.config.heroSeat) ? 1 : 0
        for (const row of [calibration, tally(calibration.byStreet, street)]) {
          row.bets += 1
          row.predicted += predicted
          row.observed += folded
        }
      }
    }

    // The hand is over: every price quoted during it can now be settled
    // against the chips it actually returned.
    const finished = session.history[session.history.length - 1]
    if (finished) {
      const ended = finished.state.seats[session.config.heroSeat]!.stack
      for (const quoted of awaiting) {
        const returned = ended - quoted.stackBefore
        // A later decision of any kind counts, folding included: the point is
        // whether the hand carried on past the street the price was quoted for.
        const followed = quoted.nth < heroDecisions - 1 ? promised.playedOn : promised.settled
        const kind =
          promised.byAction.get(quoted.kind) ??
          (promised.byAction.set(quoted.kind, blank()), promised.byAction.get(quoted.kind)!)
        for (const row of [
          promised,
          promise(promised.byStreet, quoted.street),
          followed,
          kind,
        ]) {
          row.decisions += 1
          row.model += quoted.ev
          row.realised += returned
          row.realisedSquares += returned * returned
        }
      }
    }
    awaiting.length = 0
    heroDecisions = 0
  }

  return {
    policy,
    hands,
    records: session.history,
    seconds: (Date.now() - started) / 1000,
    decisions,
    decisionMs,
    calibration,
    promised,
  }
}

/** Everything the app would say about a policy after watching it play. */
function report(outcome: Outcome) {
  const { records } = outcome
  const heroSeat = records[0]?.heroSeat ?? 0
  const bigBlind = records[0]?.bigBlind ?? 2
  const stats = aggregate(
    records.map((record) => record.stats[record.heroSeat]!),
    bigBlind,
  )
  const winrate = winrateInterval(
    records.map((record) => record.stats[record.heroSeat]!),
    bigBlind,
  )

  const gradedAt = Date.now()
  // Grading every hand is the expensive part; a sample is enough to place a
  // policy, and the report says how large it was.
  const sample = records.slice(0, Math.min(records.length, 200))
  const grades = sample.map((record) => gradeHand(record, record.heroSeat))
  const gradingMs = Date.now() - gradedAt
  const evLostPer100 =
    grades.length === 0
      ? 0
      : (grades.reduce((sum, grade) => sum + grade.totalEvLossBB, 0) / grades.length) * 100

  const verdicts = { optimal: 0, fine: 0, mistake: 0, blunder: 0 }
  for (const grade of grades) {
    for (const decision of grade.decisions) verdicts[decision.verdict] += 1
  }

  const tagged = tagDecisions(
    sample.map((record, i) => ({ ...record, decisions: grades[i]!.decisions })),
    heroSeat,
    (record) => record.decisions ?? [],
  )
  const leak = biggestLeak(findLeaks(tagged))
  const curve = luckCurve(
    records.map((record) => ({
      state: record.state,
      bigBlind: record.bigBlind,
      seat: record.heroSeat,
    })),
    heroSeat,
  )

  return {
    stats,
    winrate,
    evLostPer100,
    gradedHands: grades.length,
    gradingMsPerHand: grades.length ? gradingMs / grades.length : 0,
    verdicts,
    leak: leak ? describeLeak(leak) : 'nothing stands out',
    profile: buildProfile(stats, evLostPer100),
    luckBB: curve.luckBB,
    allIns: curve.allInHands,
  }
}

/** Chips in must equal chips out, hand after hand, however they were played. */
function conservationFaults(records: HandRecord[]): number {
  let faults = 0
  for (const record of records) {
    const net = record.state.result!.net.reduce((sum, chips) => sum + chips, 0)
    if (Math.abs(net) > 1e-9) faults += 1
    const stacks = record.state.seats.reduce((sum, seat) => sum + seat.stack, 0)
    const started = record.startingStacks.reduce((sum, chips) => sum + chips, 0)
    if (Math.abs(stacks - started) > 1e-9) faults += 1
  }
  return faults
}

const argv = process.argv.slice(2)
const handsArg = argv.indexOf('--hands')
const HANDS = handsArg >= 0 ? Number(argv[handsArg + 1]) : 1_000
// `--only Coach` runs one policy at length, which is what answering "did that
// change help?" needs: the coach is the slow one, and a comparison at a sample
// size that could settle anything cannot afford the other five as well.
const onlyArg = argv.indexOf('--only')
const ONLY = onlyArg >= 0 ? argv[onlyArg + 1] : null
const PLAYING = ONLY ? POLICIES.filter((policy) => policy.name === ONLY) : POLICIES
if (PLAYING.length === 0) throw new Error(`No policy called ${ONLY}`)

console.log(`Playing ${HANDS} hands per policy (the coach plays fewer; it thinks).\n`)

const outcomes = PLAYING.map((policy) => {
  const hands = Math.max(40, Math.round(HANDS * (policy.scale ?? 1)))
  process.stdout.write(`  ${policy.name}: ${hands} hands… `)
  const outcome = play(policy, hands, 1234)
  console.log(`${outcome.seconds.toFixed(1)}s`)
  return outcome
})

const lines: string[] = []
const say = (line = '') => {
  lines.push(line)
  console.log(line)
}

say('# Simulation report')
say()
say(`Played ${new Date().toISOString().slice(0, 16).replace('T', ' ')} against the five bots.`)
say()
say('| Policy | Hands | bb/100 | 95% interval | Given up bb/100 | VPIP | PFR | AF | Profile |')
say('|---|---|---|---|---|---|---|---|---|')

const results = outcomes.map((outcome) => ({ outcome, ...report(outcome) }))

for (const result of results) {
  const { outcome, stats, winrate, evLostPer100, profile } = result
  say(
    `| ${outcome.policy.name} | ${outcome.hands} | ${winrate.bbPer100.toFixed(1)} | ` +
      `${winrate.low.toFixed(0)}–${winrate.high.toFixed(0)} | ${evLostPer100.toFixed(1)} | ` +
      `${stats.vpip.toFixed(0)}% | ${stats.pfr.toFixed(0)}% | ${stats.aggressionFactor.toFixed(2)} | ` +
      `${profile.label} |`,
  )
}

say()
say('## What the coach said about each of them')
say()
for (const result of results) {
  const { outcome, verdicts, leak, gradedHands } = result
  const total = Object.values(verdicts).reduce((a, b) => a + b, 0) || 1
  say(
    `- **${outcome.policy.name}** (${outcome.policy.blurb}) — over ${gradedHands} graded hands: ` +
      `${((verdicts.optimal / total) * 100).toFixed(0)}% optimal, ` +
      `${((verdicts.fine / total) * 100).toFixed(0)}% fine, ` +
      `${((verdicts.mistake / total) * 100).toFixed(0)}% mistakes, ` +
      `${((verdicts.blunder / total) * 100).toFixed(0)}% blunders. Biggest leak: ${leak}`,
  )
}

say()
say('## Timing')
say()
say('| Policy | Hands/second | Decision (ms) | Grading (ms/hand) |')
say('|---|---|---|---|')
for (const result of results) {
  const { outcome, gradingMsPerHand } = result
  say(
    `| ${outcome.policy.name} | ${(outcome.hands / outcome.seconds).toFixed(0)} | ` +
      `${(outcome.decisionMs / Math.max(1, outcome.decisions)).toFixed(1)} | ` +
      `${gradingMsPerHand.toFixed(0)} |`,
  )
}

const coachCalibration = outcomes.find((outcome) => outcome.policy.name === 'Coach')!.calibration
if (coachCalibration.bets > 0) {
  say()
  say('## Are the coach\'s opponents the opponents?')
  say()
  const predicted = (coachCalibration.predicted / coachCalibration.bets) * 100
  const observed = (coachCalibration.observed / coachCalibration.bets) * 100
  say(
    `Across ${coachCalibration.bets} bets the coach expected the field to fold ` +
      `**${predicted.toFixed(1)}%** of the time. It actually folded **${observed.toFixed(1)}%**.`,
  )
  say()
  say('| Street | Bets | Expected to fold | Folded |')
  say('|---|---|---|---|')
  for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
    const row = coachCalibration.byStreet.get(street)
    if (!row || row.bets === 0) continue
    say(
      `| ${street} | ${row.bets} | ${((row.predicted / row.bets) * 100).toFixed(1)}% | ` +
        `${((row.observed / row.bets) * 100).toFixed(1)}% |`,
    )
  }
  say()
  say(
    predicted > observed * 1.25
      ? 'The model credits its bets with fold equity the table does not give them.'
      : predicted * 1.25 < observed
        ? 'The model expects to be called more than it is.'
        : 'The prediction and the table agree within a quarter.',
  )

  // Fold equity is only half of what a price claims. The other half is what
  // the hand pays once the bet is called, and that is a claim about streets
  // this model does not look at.
  const coachPromised = outcomes.find((outcome) => outcome.policy.name === 'Coach')!.promised
  const bb = results.find((r) => r.outcome.policy.name === 'Coach')!.outcome.records[0]?.bigBlind ?? 2
  if (coachPromised.decisions > 0) {
    say()
    say('## Is an action worth what the coach says it is worth?')
    say()
    say(
      'Every price is a prediction about the rest of the hand: this action is worth so ' +
        'many big blinds more than folding. Folding is worth exactly nothing more, so what ' +
        'it actually returned is the stack at the end of the hand less the stack at the ' +
        'decision — chips, no model. Folds are left out; they are the zero point on both sides.',
    )
    say()
    say('| Street | Decisions | Said it was worth | Returned | Gap |')
    say('|---|---|---|---|---|')
    const line = (label: string, row: Promised) => {
      const model = row.model / row.decisions / bb
      const realised = row.realised / row.decisions / bb
      // The realised values are chips from a poker hand — mostly small,
      // occasionally enormous — so the gap is quoted with the spread behind it
      // rather than as though one number settled anything.
      const variance = Math.max(
        0,
        row.realisedSquares / row.decisions - (row.realised / row.decisions) ** 2,
      )
      const error = (1.96 * Math.sqrt(variance / row.decisions)) / bb
      say(
        `| ${label} | ${row.decisions} | ${model.toFixed(2)}bb | ${realised.toFixed(2)}bb | ` +
          `${(realised - model).toFixed(2)} ± ${error.toFixed(2)}bb |`,
      )
    }
    for (const street of ['preflop', 'flop', 'turn', 'river'] as const) {
      const row = coachPromised.byStreet.get(street)
      if (row && row.decisions > 0) line(street, row)
    }
    line('**all**', coachPromised)
    say()
    say(
      'And split by whether the hand carried on past the street the price was quoted for. ' +
        'Where it did not — the field folded, or the chips were already in — this model is ' +
        'exact, so a gap there is the price being wrong rather than the hand that follows it.',
    )
    say()
    say('| | Decisions | Said it was worth | Returned | Gap |')
    say('|---|---|---|---|---|')
    if (coachPromised.settled.decisions > 0) line('ended there', coachPromised.settled)
    if (coachPromised.playedOn.decisions > 0) line('played on', coachPromised.playedOn)
    say()
    say(
      'And by what the hero did. Checking is priced by equity alone, so a gap there is the ' +
        'equity being wrong; betting adds a claim about what the field does with it.',
    )
    say()
    say('| Action | Decisions | Said it was worth | Returned | Gap |')
    say('|---|---|---|---|---|')
    for (const [kind, row] of [...coachPromised.byAction].sort((a, b) => b[1].decisions - a[1].decisions)) {
      line(kind, row)
    }
  }
}

say()
say('## Integrity')
say()
const allRecords = outcomes.flatMap((outcome) => outcome.records)
const faults = conservationFaults(allRecords)
say(`- Chips conserved across ${allRecords.length} hands: ${faults === 0 ? 'yes' : `NO (${faults})`}`)

const storedAt = Date.now()
const stored = allRecords.map((record, i) => toStored(record, 1_700_000_000_000 + i * 60_000))
const { hands: rebuilt, unreadable } = hydrate(stored)
say(
  `- Stored and replayed ${stored.length} hands in ${Date.now() - storedAt}ms; ` +
    `${unreadable} unreadable`,
)
const sameStats = rebuilt.every(
  (hand, i) => JSON.stringify(hand.record.stats) === JSON.stringify(allRecords[i]!.stats),
)
say(`- Statistics survive the round trip unchanged: ${sameStats ? 'yes' : 'NO'}`)
const bytes = JSON.stringify(stored).length
say(
  `- Storage: ${(bytes / stored.length).toFixed(0)} bytes a hand, ` +
    `${(bytes / 1024 / 1024).toFixed(1)}MB for ${stored.length}`,
)

const coach = results.find((result) => result.outcome.policy.name === 'Coach')
const others = results.filter((result) => result.outcome.policy.name !== 'Coach')
if (coach) {
  say()
  say('## The claim the app makes')
  say()
  if (others.length > 0) {
    say(
      `The coach gives up **${coach.evLostPer100.toFixed(1)}bb/100** and every other policy gives ` +
        `up ${Math.min(...others.map((o) => o.evLostPer100)).toFixed(1)}bb/100 or more.`,
    )
  }
  say(
    `Its winrate is ${coach.winrate.bbPer100.toFixed(1)}bb/100 ` +
      `(${coach.winrate.low.toFixed(0)} to ${coach.winrate.high.toFixed(0)} at 95%)` +
      (others.length === 0
        ? '.'
        : ', against ' +
          others.map((o) => `${o.outcome.policy.name} ${o.winrate.bbPer100.toFixed(0)}`).join(', ') +
          '.'),
  )
}

// What the trend view would show about the longest run.
const longest = results.reduce((a, b) => (b.outcome.hands > a.outcome.hands ? b : a))
const size = blockSizeFor(longest.outcome.records.length)
say()
say(
  `Over ${longest.outcome.policy.name}'s ${longest.outcome.records.length} hands the trend view ` +
    `cuts ${blocks(longest.outcome.records, size).length} blocks of ${size}: ` +
    (describeMovement(longest.outcome.records) ?? 'nothing has moved further than the noise'),
)

writeFileSync('simulation-report.md', `${lines.join('\n')}\n`)
console.log('\nWritten to simulation-report.md')
