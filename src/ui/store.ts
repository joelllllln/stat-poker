import { create } from 'zustand'
import type { Action } from '../engine/types'
import { GRADER_VERSION, type DecisionGrade, type GradedDecision } from '../coach/grade'
import { allHands, handKey, hydrate, type ArchivedHand } from '../stats/archive'
import { toStored, type StoredHand } from '../stats/serialize'
import type { Estimate } from '../stats/estimates'
import {
  createHandStore,
  exportStore,
  importIntoStore,
  type CachedGrade,
} from '../stats/storage'
import type { GradeReply, LuckReply } from '../workers/analysis.worker'
import {
  createSession,
  heroAct,
  stepBot,
  startNextHand,
  type SessionState,
} from '../game/session'
import {
  DEFAULT_TABLE,
  isPlayable,
  sessionConfigFor,
  type TableConfig,
} from '../game/table'
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
 * How long a bot takes to act.
 *
 * Bots decide in microseconds, and a table where five opponents act between
 * two of your own decisions is unreadable: you see the result and never the
 * hand. The pause is what turns a computation into a game you can follow.
 */
const PACE_MS = { normal: 520, fast: 0 } as const

export type Speed = keyof typeof PACE_MS

/**
 * How many ungraded hands to work through on one load.
 *
 * Grading is a third of a second a hand. The cache means each hand is only
 * ever paid for once, so this is the cost of catching up rather than a
 * recurring one, and the newest hands are graded first because those are the
 * ones somebody is asking about.
 */
const GRADE_BUDGET = 300

/** Keep the part of a verdict a history needs and drop the rest. */
const compact = (grade: DecisionGrade): GradedDecision => ({
  street: grade.street,
  toCall: grade.toCall,
  evLossBB: grade.evLossBB,
  verdict: grade.verdict,
  chosen: grade.chosen,
})

interface Store {
  session: SessionState
  /** The table currently chosen, whether or not it has been sat down at. */
  table: TableConfig
  /** Whether the player has sat down, or is still choosing a table. */
  seated: boolean
  /** Start a new game at this table. */
  sitDown: (table: TableConfig) => void
  /** Go back to choosing, without touching what has already been played. */
  leaveTable: () => void
  /** Return to the game already in progress, having chosen nothing. */
  returnToTable: () => void
  version: number
  /** How much of the odds overlay to show while deciding. */
  hudLevel: 'full' | 'predict' | 'off'
  /**
   * Whether the coach says what to do while the decision is live.
   *
   * Off is a real setting rather than a hidden one: being told the answer is
   * how a spot becomes familiar, and not being told is how you find out
   * whether it has.
   */
  adviceLive: boolean
  setAdviceLive: (live: boolean) => void
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
  /** True when this browser will not let the app store anything. */
  storageBroken: boolean
  /** The luck curve over the archive, computed off the interface thread. */
  archiveLuck: Omit<LuckReply, 'kind' | 'id'> | null
  /** Hands still waiting for a verdict, for the progress the dashboard shows. */
  gradingLeft: number
  /** How fast the bots act. */
  speed: Speed
  setSpeed: (speed: Speed) => void

  deal: () => void
  act: (action: Action) => void
  loadHistory: () => Promise<void>
  exportHistory: () => Promise<string>
  /** Returns how many hands and guesses arrived. */
  importHistory: (json: string) => Promise<{ hands: number; estimates: number; unreadable: number }>
  setHudLevel: (level: Store['hudLevel']) => void
  /** Record a guess against the equity it was guessing at. */
  submitGuess: (guess: number, actual: number, street: string, boardSize: number) => void
  toggleReview: () => void
}

/**
 * Preferences, kept across reloads.
 *
 * Somebody who has turned the odds off or sped the bots up has said something
 * about how they want to play; asking again every time the page loads is a way
 * of not listening. Written to local storage rather than the hand database
 * because losing them costs nothing and they must be readable synchronously.
 */
const PREFERENCES = 'stat-poker:preferences'

interface Preferences {
  hudLevel: Store['hudLevel']
  speed: Speed
  adviceLive: boolean
  /** The last table sat down at, so coming back does not mean choosing again. */
  table: TableConfig
  /** False until somebody has actually sat down once. */
  seated: boolean
}

function loadPreferences(): Preferences {
  const fallback: Preferences = {
    hudLevel: 'full',
    speed: 'normal',
    adviceLive: true,
    table: DEFAULT_TABLE,
    seated: false,
  }
  try {
    const raw = localStorage.getItem(PREFERENCES)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      hudLevel:
        parsed.hudLevel === 'predict' || parsed.hudLevel === 'off' || parsed.hudLevel === 'full'
          ? parsed.hudLevel
          : fallback.hudLevel,
      speed: parsed.speed === 'fast' ? 'fast' : 'normal',
      adviceLive: parsed.adviceLive !== false,
      // A remembered table is still checked before it is used: the rules can
      // tighten between visits, and what is in storage is whatever was there.
      table: parsed.table && isPlayable(parsed.table) ? parsed.table : fallback.table,
      seated: parsed.seated === true,
    }
  } catch {
    // A browser with storage switched off is not a reason to fail to start.
    return fallback
  }
}

function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES, JSON.stringify(preferences))
  } catch {
    /* nothing worth reporting: the session simply will not be remembered */
  }
}

const handStore = createHandStore()

/** Stored history is read once per page load. */
let loadedHistory = false
/** Only one grading pass runs at a time, however often hands finish. */
let grading = false
/** The pending bot action, so a new hand never races the last one's tail. */
let botTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<Store>((set, get) => {
  const preferences = loadPreferences()
  const bump = () => set((s) => ({ version: s.version + 1 }))
  const remember = () =>
    savePreferences({
      hudLevel: get().hudLevel,
      speed: get().speed,
      table: get().table,
      seated: get().seated,
      adviceLive: get().adviceLive,
    })

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

    // The count is what the screen reports as "stored in this browser", so it
    // has to grow as hands are played rather than only at load: a record that
    // says zero while you are playing reads as a record that is not being kept.
    set((s) => ({ storedHands: s.storedHands + stored.length }))
    void fillGrades()
  }

  /**
   * Let the bots act, one at a time, with a pause between them.
   *
   * Scheduled rather than looped: the table is redrawn between actions, so a
   * player can see who bet and who folded rather than being handed the
   * aftermath. It stops as soon as it is the person's turn again.
   */
  function pace(): void {
    if (botTimer !== null) {
      clearTimeout(botTimer)
      botTimer = null
    }

    const { session, speed } = get()
    const state = session.current
    if (state === null || state.result !== null) return
    if (state.toAct === session.config.heroSeat) return

    const step = () => {
      botTimer = null
      const before = session.history.length
      if (!stepBot(session)) return
      persist(session, before)
      bump()
      pace()
    }

    if (PACE_MS[speed] === 0) step()
    else botTimer = setTimeout(step, PACE_MS[speed])
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
          record.decisions = graded.decisions.map(compact)
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
                decisions: graded.decisions.map(compact),
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
    session: createSession(sessionConfigFor(preferences.table, Date.now() >>> 0)),
    table: preferences.table,
    seated: preferences.seated,
    sitDown: (table) => {
      // A fresh table is a fresh session: stacks, button and hand number all
      // start again. What was played at the last table is not lost with it —
      // the session that held those hands is about to be thrown away, so they
      // move into the archive on the way out, exactly as a reload would have
      // read them back from storage. Without this, changing tables makes the
      // hands you just played disappear from your statistics.
      const { session, archive } = get()
      const known = new Set(archive.map((hand) => hand.key))
      const carried: ArchivedHand[] = session.history
        .filter((record) => record.playedAt !== undefined)
        .map((record) => ({ record, playedAt: record.playedAt!, key: handKey(record) }))
        .filter((hand) => !known.has(hand.key))

      set((s) => ({
        session: createSession(sessionConfigFor(table, Date.now() >>> 0)),
        archive: [...s.archive, ...carried].sort((a, b) => a.playedAt - b.playedAt),
        table,
        seated: true,
        guess: null,
      }))
      remember()
      bump()
    },
    leaveTable: () => {
      set({ seated: false })
      remember()
    },
    returnToTable: () => {
      set({ seated: true })
      remember()
    },
    version: 0,
    hudLevel: preferences.hudLevel,
    adviceLive: preferences.adviceLive,
    setAdviceLive: (adviceLive) => {
      set({ adviceLive })
      remember()
    },
    guess: null,
    showReview: true,
    archive: [],
    storedHands: 0,
    unreadable: 0,
    storageBroken: false,
    archiveLuck: null,
    gradingLeft: 0,

    speed: preferences.speed,
    setSpeed: (speed) => {
      set({ speed })
      remember()
      pace()
    },

    deal: () => {
      const { session } = get()
      if (session.current !== null && session.current.result === null) return
      const before = session.history.length
      startNextHand(session)
      persist(session, before)
      set((s) => ({ version: s.version + 1, guess: null }))
      pace()
    },

    act: (action) => {
      const { session } = get()
      if (session.current === null || session.current.result !== null) return
      if (session.current.toAct !== session.config.heroSeat) return
      const before = session.history.length
      heroAct(session, action)
      persist(session, before)
      set((s) => ({ version: s.version + 1, guess: null }))
      pace()
    },

    loadHistory: async () => {
      // Loading twice would double every stored guess. There is no content to
      // deduplicate against either — hand numbers restart each session and the
      // guesses come from a palette of nine — so this is guarded by having
      // happened rather than by comparing what came back.
      if (loadedHistory) return
      loadedHistory = true

      // A browser with storage blocked — private mode, a locked-down profile —
      // must still deal cards. The record is what is lost, not the game, and
      // saying so once is better than an unhandled rejection.
      let stored: StoredHand[] = []
      let estimates: Estimate[] = []
      let cached: CachedGrade[] = []
      try {
        ;[stored, estimates, cached] = await Promise.all([
          handStore.all(),
          handStore.allEstimates(),
          handStore.allGrades(),
        ])
      } catch (error) {
        console.warn('Could not read the stored history; this session will not be recorded', error)
        set({ storageBroken: true })
        return
      }

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
          .map((grade) => [grade.key, grade]),
      )
      for (const hand of hands) {
        const grade = grades.get(hand.key)
        if (grade === undefined) continue
        hand.record.evLostBB = grade.evLostBB
        hand.record.decisions = grade.decisions ?? []
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
        storedHands: s.storedHands + hands.length,
        version: s.version + 1,
      }))
      void fillGrades()

      return {
        hands: added.hands.length,
        estimates: added.estimates.length,
        unreadable: added.unreadable,
      }
    },

    setHudLevel: (hudLevel) => {
      set({ hudLevel })
      remember()
    },

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
