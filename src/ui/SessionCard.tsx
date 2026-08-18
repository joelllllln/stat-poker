import { useMemo } from 'react'
import type { SessionState } from '../game/session'
import { aggregate } from '../stats/hand-stats'
import { allHands } from '../stats/archive'
import { MASTERY_SAMPLE, buildProfile } from '../stats/profile'
import { useStore } from './store'

/**
 * The running numbers, beside the table.
 *
 * Small on purpose. The dashboard answers "how do I play"; this answers "how is
 * it going", which is the question somebody has while they are still playing —
 * and it keeps the record visible rather than hiding it behind a tab that gets
 * visited once.
 */
export function SessionCard({ session }: { session: SessionState }) {
  const version = useStore((s) => s.version)
  const archive = useStore((s) => s.archive)
  const gradingLeft = useStore((s) => s.gradingLeft)
  const heroSeat = session.config.heroSeat
  const bigBlind = session.config.bigBlind

  const numbers = useMemo(() => {
    const sitting = session.history.map((hand) => hand.stats[heroSeat]!)
    const all = allHands(archive, session.history)
    const graded = all.filter((hand) => hand.evLostBB !== undefined)
    const evLostPer100 =
      graded.length === 0
        ? null
        : (graded.reduce((sum, hand) => sum + (hand.evLostBB ?? 0), 0) / graded.length) * 100

    return {
      sitting: aggregate(sitting, bigBlind),
      lifetime: aggregate(
        all.map((hand) => hand.stats[hand.heroSeat]!),
        bigBlind,
      ),
      evLostPer100,
      graded: graded.length,
    }
  }, [session, archive, version, heroSeat, bigBlind])

  if (numbers.lifetime.hands === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-500">
        Your first hands will start the record. Everything is kept on this
        machine and nothing is sent anywhere.
      </div>
    )
  }

  const profile = buildProfile(numbers.lifetime, numbers.evLostPer100 ?? 0)
  const netThisSitting = session.history.reduce(
    (sum, hand) => sum + hand.stats[heroSeat]!.net,
    0,
  )

  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">This sitting</span>
        <span className="font-mono text-[11px] text-slate-500">
          {numbers.sitting.hands} hand{numbers.sitting.hands === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex items-baseline gap-3">
        <span
          className={`font-mono text-2xl ${
            netThisSitting > 0
              ? 'text-emerald-300'
              : netThisSitting < 0
                ? 'text-rose-300'
                : 'text-slate-300'
          }`}
        >
          {netThisSitting >= 0 ? '+' : ''}
          {(netThisSitting / bigBlind).toFixed(1)}bb
        </span>
        <span className="text-[11px] text-slate-500">
          {numbers.sitting.hands > 0 &&
            `${numbers.sitting.bbPer100 >= 0 ? '+' : ''}${numbers.sitting.bbPer100.toFixed(0)} bb/100 · noise at this length`}
        </span>
      </div>

      <div className="border-t border-slate-800 pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">All time</span>
          <span className="font-mono text-[11px] text-slate-500">
            {numbers.lifetime.hands.toLocaleString('en-US')} hand
            {numbers.lifetime.hands === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-1 text-sm">{profile.label}</div>
        <div className="mt-0.5 font-mono text-[11px] text-slate-400">
          {numbers.evLostPer100 === null
            ? 'no hands graded yet'
            : `−${numbers.evLostPer100.toFixed(1)}bb/100 given up${
                numbers.graded < MASTERY_SAMPLE ? ` · ${numbers.graded}/${MASTERY_SAMPLE} graded` : ''
              }`}
        </div>
        {gradingLeft > 0 && (
          <div className="mt-1 text-[11px] text-slate-500">
            grading {gradingLeft} more in the background
          </div>
        )}
      </div>
    </div>
  )
}
