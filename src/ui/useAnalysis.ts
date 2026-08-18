import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card } from '../engine/cards'
import type { EquityReply, SolveReply } from '../workers/analysis.worker'
import { ask } from './analysis-client'

export interface EquityQuery {
  hero: readonly [Card, Card]
  villains: string[]
  board: readonly Card[]
  iterations?: number
  withOuts?: boolean
}

/**
 * Live equity for the current decision.
 *
 * While a fresh answer is in flight the previous one stays on screen rather
 * than blanking: a number that flickers away every time the board changes is
 * harder to read than one that is briefly a moment behind, and the `pending`
 * flag says which it is.
 */
export function useEquity(query: EquityQuery | null): {
  result: EquityReply | null
  pending: boolean
} {
  const [result, setResult] = useState<EquityReply | null>(null)
  const [pending, setPending] = useState(false)
  const latest = useRef(0)

  const key = useMemo(
    () =>
      query
        ? JSON.stringify([
            query.hero,
            query.villains,
            query.board,
            query.iterations,
            query.withOuts,
          ])
        : null,
    [query],
  )

  useEffect(() => {
    if (!query || key === null) {
      setResult(null)
      return
    }

    const token = ++latest.current
    setPending(true)
    ask<EquityReply>({
      kind: 'equity',
      hero: [query.hero[0], query.hero[1]],
      villains: query.villains,
      board: [...query.board],
      ...(query.iterations === undefined ? {} : { iterations: query.iterations }),
      ...(query.withOuts === undefined ? {} : { withOuts: query.withOuts }),
    })
      .then((reply) => {
        // A reply for a decision the player has already moved past is stale.
        if (token !== latest.current) return
        setResult(reply)
        setPending(false)
      })
      .catch(() => {
        if (token !== latest.current) return
        setResult(null)
        setPending(false)
      })
    // `key` captures everything the query depends on.
  }, [key])

  return { result, pending }
}

export interface SolveQuery {
  board: readonly Card[]
  heroRange: string
  villainRange: string
  pot: number
  stack: number
  iterations?: number
}

/**
 * Solve a river on demand.
 *
 * Deliberately not automatic: a solve costs seconds, and running one for every
 * hand a player clicks past would heat their laptop to no purpose.
 */
export function useRiverSolve(): {
  result: SolveReply | null
  pending: boolean
  error: string | null
  solve: (query: SolveQuery) => void
} {
  const [result, setResult] = useState<SolveReply | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  return {
    result,
    pending,
    error,
    solve: (query) => {
      const token = ++latest.current
      setPending(true)
      setError(null)
      ask<SolveReply>({
        kind: 'solve',
        board: [...query.board],
        heroRange: query.heroRange,
        villainRange: query.villainRange,
        pot: query.pot,
        stack: query.stack,
        ...(query.iterations === undefined ? {} : { iterations: query.iterations }),
      })
        .then((reply) => {
          if (token !== latest.current) return
          setResult(reply)
          setPending(false)
        })
        .catch((cause: unknown) => {
          if (token !== latest.current) return
          setError(cause instanceof Error ? cause.message : String(cause))
          setPending(false)
        })
    },
  }
}
