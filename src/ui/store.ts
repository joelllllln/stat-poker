import { create } from 'zustand'
import type { Action } from '../engine/types'
import { gradeHand } from '../coach/grade'
import { toStored } from '../stats/serialize'
import { createHandStore, exportStore, importIntoStore } from '../stats/storage'
import {
  createSession,
  defaultSessionConfig,
  heroAct,
  runBotsUntilHero,
  startNextHand,
  type SessionState,
} from '../game/session'

/**
 * Session state for the UI.
 *
 * The session carries a live random generator and a growing history, so it is
 * held by identity and re-renders are driven by a version counter rather than
 * by cloning the whole thing on every action.
 */
interface Store {
  session: SessionState
  version: number
  /** How much of the odds overlay to show while deciding. */
  hudLevel: 'full' | 'predict' | 'off'
  /** The player's equity guess this decision, in predict-then-reveal mode. */
  guess: number | null
  /** Whether the post-hand review is shown. */
  showReview: boolean

  /** Hands recovered from storage, kept apart from this session's own. */
  storedHands: number

  deal: () => void
  act: (action: Action) => void
  loadHistory: () => Promise<void>
  exportHistory: () => Promise<string>
  importHistory: (json: string) => Promise<number>
  setHudLevel: (level: Store['hudLevel']) => void
  /** Record a guess against the equity it was guessing at. */
  submitGuess: (guess: number, actual: number, street: string, boardSize: number) => void
  toggleReview: () => void
}

const handStore = createHandStore()

/**
 * Write any hands finished since `before` to storage.
 *
 * Persistence is fire-and-forget: a hand that fails to save must never block
 * the table or lose the one being played.
 */
function persistNewHands(session: SessionState, before: number): void {
  const finished = session.history.slice(before)
  if (finished.length === 0) return
  const now = Date.now()
  void handStore
    .putMany(finished.map((record) => toStored(record, now)))
    .catch((error: unknown) => console.warn('Could not save hand history', error))
}

/**
 * Grade finished hands off the critical path.
 *
 * Grading costs a few hundred milliseconds, which is far too long to spend
 * between a hand ending and the table being ready again. It also cannot live in
 * the review panel: the mastery rating would then exist only for players who
 * leave the review switched on.
 */
function gradeNewHands(
  session: SessionState,
  before: number,
  done: () => void,
): void {
  const finished = session.history.slice(before)
  if (finished.length === 0) return

  setTimeout(() => {
    for (const record of finished) {
      if (record.evLostBB !== undefined) continue
      try {
        const grade = gradeHand(record, session.config.heroSeat)
        record.evLostBB = grade.totalEvLossBB
        record.grades = grade.decisions
      } catch (error) {
        console.warn('Could not grade hand', error)
      }
    }
    done()
  }, 0)
}

export const useStore = create<Store>((set, get) => ({
  session: createSession(defaultSessionConfig(Date.now() >>> 0)),
  version: 0,
  hudLevel: 'full',
  guess: null,
  showReview: true,
  storedHands: 0,

  deal: () => {
    const { session } = get()
    if (session.current !== null && session.current.result === null) return
    const before = session.history.length
    startNextHand(session)
    runBotsUntilHero(session)
    persistNewHands(session, before)
    gradeNewHands(session, before, () => set((s) => ({ version: s.version + 1 })))
    set((s) => ({ version: s.version + 1, guess: null }))
  },

  act: (action) => {
    const { session } = get()
    const before = session.history.length
    heroAct(session, action)
    runBotsUntilHero(session)
    persistNewHands(session, before)
    gradeNewHands(session, before, () => set((s) => ({ version: s.version + 1 })))
    set((s) => ({ version: s.version + 1, guess: null }))
  },

  loadHistory: async () => {
    const count = await handStore.count()
    set({ storedHands: count })
  },

  exportHistory: () => exportStore(handStore),

  importHistory: async (json) => {
    const added = await importIntoStore(handStore, json)
    set((s) => ({ storedHands: s.storedHands + added, version: s.version + 1 }))
    return added
  },

  setHudLevel: (hudLevel) => set({ hudLevel }),
  submitGuess: (guess, actual, street, boardSize) => {
    const { session } = get()
    // Kept on the session so the estimate survives alongside the hand it was
    // made in — a guess nobody records teaches nothing.
    session.estimates.push({
      handNumber: session.handNumber,
      street,
      guess,
      actual: actual * 100,
      boardSize,
    })
    set((s) => ({ guess, version: s.version + 1 }))
  },
  toggleReview: () => set((s) => ({ showReview: !s.showReview })),
}))
