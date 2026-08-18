import { useMemo } from 'react'
import { recordsForSeat, type SessionState } from '../game/session'
import { aggregate } from '../stats/hand-stats'
import { luckCurve } from '../stats/all-in-adjusted'
import {
  MASTERY_SAMPLE,
  STYLE_SAMPLE,
  buildProfile,
  handsForPrecision,
  rateInterval,
  winrateInterval,
} from '../stats/profile'
import { biggestLeak, describeLeak, findLeaks, tagDecisions, MIN_SAMPLE } from '../coach/leaks'
import { describeAccuracy, summarise } from '../stats/estimates'
import { STREET_SAMPLE, styleByStreet, styleContradiction } from '../stats/profile'
import { LuckChart } from './LuckChart'
import { useStore } from './store'

/**
 * A stat with its confidence interval.
 *
 * The interval is the feature, not decoration: a rate quoted without one is the
 * main way poker software misleads people about how well they are playing.
 */
function StatTile({
  label,
  value,
  interval,
  reliable,
}: {
  label: string
  value: string
  interval?: [number, number]
  reliable: boolean
}) {
  return (
    <div className={`rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 ${reliable ? '' : 'opacity-60'}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-lg">{value}</div>
      {interval && (
        <div className="font-mono text-[10px] text-slate-500">
          {interval[0].toFixed(0)}–{interval[1].toFixed(0)}%
        </div>
      )}
    </div>
  )
}

export function Dashboard({ session }: { session: SessionState }) {
  // The session is held by identity and mutated in place, so this counter is
  // what tells React anything changed — including grades arriving after the
  // hand they belong to has already been recorded.
  const version = useStore((s) => s.version)
  const heroSeat = session.config.heroSeat
  const bigBlind = session.config.bigBlind

  const data = useMemo(() => {
    const records = recordsForSeat(session, heroSeat)
    const stats = aggregate(records, bigBlind)
    const curve = luckCurve(
      session.history.map((hand) => ({ state: hand.state, bigBlind })),
      heroSeat,
    )
    const winrate = winrateInterval(records, bigBlind)
    return { records, stats, curve, winrate }
  }, [session, version, heroSeat, bigBlind])

  // Hooks must all run before any early return, so this sits with the rest.
  // Grading already happened off the critical path; this reuses those results
  // rather than paying for them a second time.
  const leak = useMemo(() => {
    const graded = session.history.filter((hand) => hand.grades !== undefined)
    if (graded.length === 0) return null
    const tagged = tagDecisions(graded, heroSeat, (record) => record.grades ?? [])
    return {
      leak: biggestLeak(findLeaks(tagged)),
      decisions: tagged.length,
      // The same graded decisions answer a different and often sharper
      // question: whether the player is the same player on every street.
      streets: styleByStreet(
        tagged.map((item) => ({ street: item.street, action: item.grade.chosen.type })),
      ),
    }
  }, [session, version, heroSeat])

  const estimates = useMemo(
    () => summarise(session.estimates),
    [session, version],
  )

  const { records, stats, curve, winrate } = data
  if (stats.hands === 0) return null

  // EV given up is filled in by the review panel as hands are graded; until a
  // hand has been graded it contributes nothing rather than a guess.
  const graded = session.history.filter((h) => h.evLostBB !== undefined)
  const evLostPer100 =
    graded.length === 0
      ? 0
      : (graded.reduce((sum, h) => sum + (h.evLostBB ?? 0), 0) / graded.length) * 100

  const profile = buildProfile(stats, evLostPer100)

  const played = records.filter((r) => r.vpip).length
  const raised = records.filter((r) => r.pfr).length
  const handsNeeded = handsForPrecision(winrate.standardDeviation, 10)

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Your game</span>
        <span className="text-[11px] text-slate-500">{stats.hands} hands</span>
      </div>

      {/* Style and mastery are separate questions: how you play, and how well. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
        <div>
          <div className="text-lg font-medium">{profile.label}</div>
          <div className="text-xs text-slate-400">{profile.style.blurb}</div>
        </div>
        <div className="ml-auto text-right text-xs">
          {graded.length >= MASTERY_SAMPLE ? (
            <span className="font-mono text-slate-300">
              −{evLostPer100.toFixed(1)}bb/100 given up
            </span>
          ) : (
            <span className="text-amber-500/80">
              {graded.length}/{MASTERY_SAMPLE} graded hands — placement is provisional
            </span>
          )}
          {stats.hands < STYLE_SAMPLE && (
            <div className="text-amber-500/80">
              {stats.hands}/{STYLE_SAMPLE} hands — style is provisional too
            </div>
          )}
        </div>
      </div>

      {leak && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            Where it goes
          </div>
          {leak.leak ? (
            <div className="mt-0.5 text-sm text-amber-200">{describeLeak(leak.leak)}</div>
          ) : (
            <div className="mt-0.5 text-xs text-slate-400">
              {leak.decisions < MIN_SAMPLE
                ? `${leak.decisions} graded decisions so far — a leak needs at least ${MIN_SAMPLE} in one kind of spot before it is a habit rather than a bad afternoon.`
                : 'No single spot stands out yet: what you give up is spread evenly rather than concentrated anywhere.'}
            </div>
          )}
        </div>
      )}

      {leak && leak.streets.length > 0 && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">
              Street by street
            </span>
            {styleContradiction(leak.streets) && (
              <span className="text-[11px] text-amber-300">
                {styleContradiction(leak.streets)}
              </span>
            )}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {leak.streets.map((street) => (
              <div key={street.street} className={street.decisions >= STREET_SAMPLE ? '' : 'opacity-50'}>
                <div className="text-[11px] capitalize text-slate-500">{street.street}</div>
                <div className="text-sm capitalize">{street.label}</div>
                <div className="font-mono text-[10px] text-slate-500">
                  {(street.aggression * 100).toFixed(0)}% aggressive · {street.decisions}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="VPIP"
          value={`${stats.vpip.toFixed(0)}%`}
          interval={rateInterval(played, stats.hands)}
          reliable={stats.hands >= STYLE_SAMPLE}
        />
        <StatTile
          label="PFR"
          value={`${stats.pfr.toFixed(0)}%`}
          interval={rateInterval(raised, stats.hands)}
          reliable={stats.hands >= STYLE_SAMPLE}
        />
        <StatTile
          label="WTSD"
          value={`${stats.wtsd.toFixed(0)}%`}
          reliable={stats.hands >= STYLE_SAMPLE}
        />
        <StatTile
          label="Aggression"
          value={stats.aggressionFactor.toFixed(2)}
          reliable={stats.hands >= STYLE_SAMPLE}
        />
      </div>

      {estimates.count > 0 && (
        <div className="rounded-lg border border-sky-900/60 bg-sky-950/20 px-3 py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-sky-300/70">
              Reading equity
            </span>
            <span className="font-mono text-sm text-sky-100">
              {estimates.meanError.toFixed(1)} points out — {describeAccuracy(estimates.meanError)}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-sky-200/60">
            {estimates.count} guess{estimates.count === 1 ? '' : 'es'};{' '}
            {(estimates.withinFive * 100).toFixed(0)}% within five points.
            {Math.abs(estimates.bias) > 3 &&
              ` You run ${estimates.bias > 0 ? 'optimistic' : 'pessimistic'} by ${Math.abs(estimates.bias).toFixed(1)} points on average.`}
            {estimates.improvement !== null &&
              ` Your later guesses are ${Math.abs(estimates.improvement).toFixed(1)} points ${estimates.improvement > 0 ? 'closer' : 'further off'} than your early ones.`}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Winrate</span>
          <span className="font-mono text-sm">
            {winrate.bbPer100 >= 0 ? '+' : ''}
            {winrate.bbPer100.toFixed(1)} bb/100
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {Number.isFinite(winrate.low)
            ? `Anywhere from ${winrate.low.toFixed(0)} to ${winrate.high.toFixed(0)} bb/100 at 95% confidence. `
            : 'Not enough hands to bound this at all. '}
          {handsNeeded > 0 &&
            `At your spread it takes about ${handsNeeded.toLocaleString('en-US')} hands to pin this down to ±5.`}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">
            Actual against what the hands were worth
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            {curve.allInHands > 0
              ? `${curve.luckBB >= 0 ? '+' : ''}${curve.luckBB.toFixed(1)}bb of luck over ${curve.allInHands} all-in${curve.allInHands === 1 ? '' : 's'}`
              : 'no all-ins yet'}
          </span>
        </div>
        <LuckChart actual={curve.actual} adjusted={curve.adjusted} />
      </div>
    </div>
  )
}
