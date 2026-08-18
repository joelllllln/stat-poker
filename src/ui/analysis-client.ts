/**
 * The one worker, and the way to ask it something.
 *
 * Kept apart from the hooks that use it so that code with no interface — the
 * session store filling in grades in the background — can reach it without
 * pretending to be a component.
 *
 * One worker keeps requests in order and means a solve and an equity query
 * never compete for two cores when the machine may only have one to spare.
 */

import type { AnalysisReply, AnalysisRequest } from '../workers/analysis.worker'

type PendingRequest = { [K in AnalysisRequest as K['kind']]: Omit<K, 'id'> }[AnalysisRequest['kind']]

let shared: Worker | null = null
let nextId = 1

function worker(): Worker {
  shared ??= new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
    type: 'module',
  })
  return shared
}

/**
 * Send a request and resolve with its reply.
 *
 * Replies are matched by id rather than by arrival, so an answer to a question
 * nobody is asking any more is discarded instead of being shown.
 */
export function ask<T extends AnalysisReply>(request: PendingRequest): Promise<T> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const instance = worker()
    const listener = (event: MessageEvent<AnalysisReply>) => {
      if (event.data.id !== id) return
      instance.removeEventListener('message', listener)
      if (event.data.kind === 'error') reject(new Error(event.data.message))
      else resolve(event.data as T)
    }
    instance.addEventListener('message', listener)
    instance.postMessage({ ...request, id } as AnalysisRequest)
  })
}
