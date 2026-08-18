/**
 * Where hand history lives.
 *
 * The interface exists so the analysis code never touches IndexedDB directly:
 * the browser gets the real store, tests get an in-memory one, and an export
 * file is just the same records serialised. Local-first is only safe if the
 * data can leave, so export is part of the store rather than an extra.
 */

import { exportHands, importHands, type StoredHand } from './serialize'

export interface HandStore {
  put(hand: StoredHand): Promise<void>
  putMany(hands: StoredHand[]): Promise<void>
  all(): Promise<StoredHand[]>
  count(): Promise<number>
  clear(): Promise<void>
}

/** In-memory store, for tests and for environments without IndexedDB. */
export class MemoryHandStore implements HandStore {
  private hands: StoredHand[] = []

  async put(hand: StoredHand): Promise<void> {
    this.hands.push(hand)
  }

  async putMany(hands: StoredHand[]): Promise<void> {
    this.hands.push(...hands)
  }

  async all(): Promise<StoredHand[]> {
    return [...this.hands]
  }

  async count(): Promise<number> {
    return this.hands.length
  }

  async clear(): Promise<void> {
    this.hands = []
  }
}

const DB_NAME = 'stat-poker'
const DB_VERSION = 1
const STORE = 'hands'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { autoIncrement: true })
        store.createIndex('playedAt', 'playedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

const asPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/** Browser-backed store. */
export class IndexedDbHandStore implements HandStore {
  private db: Promise<IDBDatabase> | null = null

  private connect(): Promise<IDBDatabase> {
    this.db ??= openDatabase()
    return this.db
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.connect()
    const transaction = db.transaction(STORE, mode)
    const result = await asPromise(run(transaction.objectStore(STORE)))
    return result
  }

  async put(hand: StoredHand): Promise<void> {
    await this.withStore('readwrite', (store) => store.add(hand))
  }

  async putMany(hands: StoredHand[]): Promise<void> {
    const db = await this.connect()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      for (const hand of hands) store.add(hand)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async all(): Promise<StoredHand[]> {
    return this.withStore('readonly', (store) => store.getAll() as IDBRequest<StoredHand[]>)
  }

  async count(): Promise<number> {
    return this.withStore('readonly', (store) => store.count())
  }

  async clear(): Promise<void> {
    await this.withStore('readwrite', (store) => store.clear())
  }
}

/** The real store where one is available, an in-memory one otherwise. */
export function createHandStore(): HandStore {
  if (typeof indexedDB === 'undefined') return new MemoryHandStore()
  return new IndexedDbHandStore()
}

export async function exportStore(store: HandStore): Promise<string> {
  return exportHands(await store.all())
}

export async function importIntoStore(store: HandStore, json: string): Promise<number> {
  const hands = importHands(json)
  await store.putMany(hands)
  return hands.length
}
