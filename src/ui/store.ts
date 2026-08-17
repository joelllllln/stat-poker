import { create } from 'zustand'
import type { Action } from '../engine/types'
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

  deal: () => void
  act: (action: Action) => void
  setHudLevel: (level: Store['hudLevel']) => void
  submitGuess: (guess: number) => void
  toggleReview: () => void
}

export const useStore = create<Store>((set, get) => ({
  session: createSession(defaultSessionConfig(Date.now() >>> 0)),
  version: 0,
  hudLevel: 'full',
  guess: null,
  showReview: true,

  deal: () => {
    const { session } = get()
    if (session.current !== null && session.current.result === null) return
    startNextHand(session)
    runBotsUntilHero(session)
    set((s) => ({ version: s.version + 1, guess: null }))
  },

  act: (action) => {
    const { session } = get()
    heroAct(session, action)
    runBotsUntilHero(session)
    set((s) => ({ version: s.version + 1, guess: null }))
  },

  setHudLevel: (hudLevel) => set({ hudLevel }),
  submitGuess: (guess) => set({ guess }),
  toggleReview: () => set((s) => ({ showReview: !s.showReview })),
}))
