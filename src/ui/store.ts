import { create } from 'zustand'
import type { Action } from '../engine/types'
import { GRADER_VERSION } from '../coach/grade'
import { allHands, handKey, hydrate, type ArchivedHand } from '../stats/archive'
import { toStored, type StoredHand } from '../stats/serialize'
import {
  createHandStore,
  exportStore,
  importIntoStore,
  type CachedGrade,
} from '../stats/storage'
import type { GradeReply, LuckReply } from '../workers/analysis.worker'
import {
  createSession,
  defaultSessionConfig,
  heroAct,
  runBotsUntilHero,
  startNextHand,
  type HandRecord,
  type SessionState,
} from '../game/session'
import { ask } from './analysis-client'

/**
 * How many stored hands the statistics are built from.
 *
 * Replaying a hand is cheap, but not free, and somebody who has played for
 * months should not wait on their whole history to see this session's table.
 * The dashboard says when it is showing a window rather than everything.
 */
export const ARCHIVE_LIMIT = 5_000

/** Hands sent for grading in one message: enough to be worth a round trip. */
const GRADE_BATCH = 4

/**
 * How many ungraded hands to work through on one load.
 *
 * Grading is a third of a second a hand. The cache means each hand is only
 * ever paid for once, so this is the cost of catching up rather than a
 * recurring one, and the newest hands are graded first because those are the
 * ones somebody is asking about.
 */
const GRADE_BUDGET = 300

interface Store {
  session: SessionState
  version: number
  /** How much of the odds overlay to show while deciding. */
  hudLevel: 'full' | 'predict' | 'off'
  /** The player's equity guess this decision, in predict-then-reveal mode. */
  guess: number | null
  /** Whether the post-hand review is shown. */
  showReview: boolean

  /** Hands from earlier sittings, replayed. */
  archive: ArchivedHand[]
  /** How many hands are in storage, which may exceed the window shown. */
  storedHands: number
  /** Hands that would not replay, so the count on screen can be honest. */
  unreadable: number
  /** The luck curve over the archive, computed off the interface thread. */
  archiveLuck: Omit<LuckReply, 'kind' | 'id'> | null
  /** Hands still waiting for a verdict, for the progress the dashboard shows. */
  gradingLeft: number

  deal: () => void
  act: (action: Action) => void
  loadHistory: () => Promise<void>
  exportHistory: () => Promise<string>
  /** Returns how many hands and guesses arrived. */
  importHistory: (json: string) => Promise<{ hands: number; estimates: number }>
  setHudLevel: (level: Store['hudLevel']) => void
  /** Record a guess against the equity it was guessing at. */
  submitGuess: (guess: number, actual: number, street: string, boardSize: number) => void
  toggleReview: () => void
}

const handStore = createHandStore()

/** Stored history is read once per page load. */
let loadedHistory = false
/** Only one grading pass runs at a time, however often hands finish. */
let grading = false

export const useStore = create<Store>((set, get) => {
  const bump = () => set((s) => ({ version: s.version + 1 }))

  /**
   * Write any hands finished since `before` to storage.
   *
   * Persistence is fire-and-forget: a hand that fails to save must never block
   * the table or lose the one being played. The timestamp is stamped on the
   * record too, because from here on it is the hand's identity.
   */
  function persist(session: SessionState, before: number): void {
    const finished = session.history.slice(before)
    if (finished.length === 0) return

    const now = Date.now()
    const stored: StoredHand[] = []
    for (const record of finished) {
      record.playedAt = now
      stored.push(toStored(record, now))
    }

    void handStore
      .putMany(stored)
      .catch((error: unknown) => console.warn('Could not save hand history', error))
    void fillGrades()
  }

  /**
   * Work through hands that have no verdict yet, newest first.
   *
   * Grading happens in the worker and its results are cached, so a hand is
   * graded once ever rather than once a session. It cannot live in the review
   * panel either: the mastery rating would then exist only for players who
   * leave the review switched on.
   */
  async function fillGrades(): Promise<void> {
    if (grading) return
    grading = true

    try {
      for (;;) {
        const { archive, session } = get()
        const pending = allHands(archive, session.history)
          .filter((record) => record.evLostBB === undefined && record.playedAt !== undefined)
          .reverse()
          .slice(0, GRADE_BUDGET)

        set({ gradingLeft: pending.length })
        if (pending.length === 0) return

        const batch = pending.slice(0, GRADE_BATCH)
        const byKey = new Map(batch.map((record) => [handKey(record), record]))
        const reply = await ask<GradeReply>({
          kind: 'grade',
          hands: batch.map((record) => toStored(record, record.playedAt!)),
        })

        for (const graded of reply.graded) {
          const record = byKey.get(graded.key)
          if (!record) continue
          record.evLostBB = graded.evLostBB
          record.grades = graded.decisions
        }
        // A hand that will not grade is marked as costing nothing rather than
        // being offered to the grader again on every pass forever.
        for (const [key, record] of byKey) {
          if (!reply.graded.some((graded) => graded.key === key)) record.evLostBB = 0
        }

        void handStore
          .putGrades(
            reply.graded.map(
              (graded): CachedGrade => ({
                key: graded.key,
                version: GRADER_VERSION,
                evLostBB: graded.evLostBB,
              }),
            ),
          )
          .catch((error: unknown) => console.warn('Could not save grades', error))

        bump()
      }
    } catch (error) {
      console.warn('Could not grade hands', error)
    } finally {
      grading = false
    }
  }

  return {
    session: createSession(defaultSessionConfig(Date.now() >>> 0)),
    version: 0,
    hudLevel: 'full',
    guess: null,
    showReview: true,
    archive: [],
    storedHands: 0,
    unreadable: 0,
    archiveLuck: null,
    gradingLeft: 0,

    deal: () => {
      const { session } = get()
      if (session.current !== null && session.current.result === null) return
      const before = session.history.length
      startNextHand(session)
      runBotsUntilHero(session)
      persist(session, before)
      set((s) => ({ version: s.version + 1, guess: null }))
    },

    act: (action) => {
      const { session } = get()
      const before = session.history.length
      heroAct(session, action)
      runBotsUntilHero(session)
      persist(session, before)
      set((s) => ({ version: s.version + 1, guess: null }))
    },

    loadHistory: async () => {
      // Loading twice would double every stored guess. There is no content to
      // deduplicate against either — hand numbers restart each session and the
      // guesses come from a palette of nine — so this is guarded by having
      // happened rather than by comparing what came back.
      if (loadedHistory) return
      loadedHistory = true

      const [stored, estimates, cached] = await Promise.all([
        handStore.all(),
        handStore.allEstimates(),
        handStore.allGrades(),
      ])

      const recent = [...stored]
        .sort((a, b) => a.playedAt - b.playedAt)
        .slice(-ARCHIVE_LIMIT)
      const { hands, unreadable } = hydrate(recent)

      // Verdicts from a coach that has since changed are ignored rather than
      // shown: a stale grade is worse than an ungraded hand, because nothing
      // on screen would say it was stale.
      const grades = new Map(
        cached
          .filter((grade) => grade.version === GRADER_VERSION)
          .map((grade) => [grade.key, grade.evLostBB]),
      )
      for (const hand of hands) {
        const evLostBB = grades.get(hand.key)
        if (evLostBB !== undefined) hand.record.evLostBB = evLostBB
      }

      // Guesses from earlier sessions count towards the same running accuracy;
      // the point of the metric is that it spans more than one sitting. They go
      // in front as one batch, because inserting them one at a time would
      // reverse them and turn an improving player's trend upside down.
      const { session } = get()
      session.estimates.unshift(...estimates)

      set((s) => ({
        archive: hands,
        storedHands: stored.length,
        unreadable,
        version: s.version + 1,
      }))

      if (hands.length > 0) {
        void ask<LuckReply>({
          kind: 'luck',
          hands: recent,
          bigBlind: session.config.bigBlind,
        })
          .then(({ actual, adjusted, luckBB, allInHands }) => {
            set((s) => ({
              archiveLuck: { actual, adjusted, luckBB, allInHands },
              version: s.version + 1,
            }))
          })
          .catch((error: unknown) => console.warn('Could not price the archive', error))
      }

      void fillGrades()
    },

    exportHistory: () => exportStore(handStore),

    importHistory: async (json) => {
      const added = await importIntoStore(handStore, json)
      const { session } = get()
      session.estimates.unshift(...added.estimates)

      // Imported hands join the archive rather than waiting for a reload: an
      // import that appears to have done nothing is indistinguishable from one
      // that failed.
      const { hands } = hydrate(added.hands)
      set((s) => ({
        archive: [...s.archive, ...hands].sort((a, b) => a.playedAt - b.playedAt),
        storedHands: s.storedHands + added.hands.length,
        version: s.version + 1,
      }))
      void fillGrades()

      return { hands: added.hands.length, estimates: added.estimates.length }
    },

    setHudLevel: (hudLevel) => set({ hudLevel }),

    submitGuess: (guess, actual, street, boardSize) => {
      const { session } = get()
      // Kept on the session so the estimate survives alongside the hand it was
      // made in — a guess nobody records teaches nothing.
      const estimate = {
        handNumber: session.handNumber,
        street,
        guess,
        actual: actual * 100,
        boardSize,
      }
      session.estimates.push(estimate)
      // Saved alongside the hands, and like them never allowed to block play.
      void handStore
        .putEstimates([estimate])
        .catch((error: unknown) => console.warn('Could not save estimate', error))
      set((s) => ({ guess, version: s.version + 1 }))
    },

    toggleReview: () => set((s) => ({ showReview: !s.showReview })),
  }
})

/** Every hand behind the statistics: the archive, then this sitting. */
export const historyOf = (state: Store): HandRecord[] =>
  allHands(state.archive, state.session.history)
