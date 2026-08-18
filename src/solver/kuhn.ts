/**
 * Kuhn poker: a three-card game small enough to have a known equilibrium.
 *
 * Each player antes one and is dealt one card from {J, Q, K}. The first player
 * checks or bets one; a check may be bet into, and a bet may be called or
 * folded. That is the whole game — and its equilibrium has a closed form, which
 * makes it the right place to find out whether a solver works before pointing
 * it at a game where nobody knows the answer.
 *
 * At equilibrium the first player bets the jack with probability α ∈ [0, ⅓] and
 * the king with exactly 3α, never bets the queen, and the game is worth −1/18
 * to them.
 */

import { CHANCE, type Game } from './cfr'

export const JACK = 0
export const QUEEN = 1
export const KING = 2
export const CARD_NAMES = ['J', 'Q', 'K']

/** 0 is check or fold; 1 is bet or call. */
export const PASS = 0
export const BET = 1

export interface KuhnState {
  /** Null before the deal. */
  cards: readonly [number, number] | null
  history: string
}

const TERMINALS = new Set(['pp', 'bp', 'bb', 'pbp', 'pbb'])

export const kuhn: Game<KuhnState> = {
  players: 2,
  root: () => ({ cards: null, history: '' }),

  chanceOutcomes() {
    const outcomes: { state: KuhnState; probability: number }[] = []
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        if (a === b) continue
        outcomes.push({ state: { cards: [a, b], history: '' }, probability: 1 / 6 })
      }
    }
    return outcomes
  },

  isTerminal: (state) => TERMINALS.has(state.history),

  currentPlayer: (state) =>
    state.cards === null ? CHANCE : state.history.length % 2,

  actions: () => [PASS, BET],

  next: (state, action) => ({
    cards: state.cards,
    history: state.history + (action === BET ? 'b' : 'p'),
  }),

  infoSet: (state) =>
    `${CARD_NAMES[state.cards![state.history.length % 2]!]}:${state.history || '-'}`,

  payoff(state, player) {
    const [first, second] = state.cards!
    const winner = first > second ? 0 : 1
    const sign = player === winner ? 1 : -1

    switch (state.history) {
      case 'pp':
        return sign * 1
      case 'bp':
        // The second player folded to a bet.
        return player === 0 ? 1 : -1
      case 'pbp':
        // The first player folded to a bet.
        return player === 1 ? 1 : -1
      case 'bb':
      case 'pbb':
        return sign * 2
      default:
        throw new Error(`Not a terminal history: ${state.history}`)
    }
  },
}

/** The value of the game to the first player at equilibrium. */
export const KUHN_GAME_VALUE = -1 / 18
