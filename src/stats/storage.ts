/**
 * Where hand history lives.
 *
 * The interface exists so the analysis code never touches IndexedDB directly:
 * the browser gets the real store, tests get an in-memory one, and an export
 * file is just the same records serialised. Local-first is only safe if the
 * data can leave, so export is part of the store rather than an extra.
 */

import type { Estimate } from './estimates'
import { exportHands, importHands, type StoredHand } from './serialize'

/**
 * A hand's verdict, kept so it is worked out once rather than once a session.
 *
 * Grading costs about a third of a second a hand, so a history of any size
 * cannot be regraded on every load. The version is what keeps that from
 * freezing the verdicts in place: improving the coach raises it, and every
 * cached verdict is ignored and worked out again.
 */
export interface CachedGrade {
  key: string
  version: number
  evLostBB: number
}

export interface HandStore {
  put(hand: StoredHand): Promise<void>
  putMany(hands: StoredHand[]): Promise<void>
  all(): Promise<StoredHand[]>
  count(): Promise<number>
  clear(): Promise<void>
  /**
   * Equity guesses.
   *
   * Kept in the same store as the hands because they are the same kind of
   * thing: a record of what the player did, worth nothing unless it survives
   * closing the tab.
   */
  putEstimates(estimates: Estimate[]): Promise<void>
  allEstimates(): Promise<Estimate[]>
  /** Verdicts already worked out, keyed by hand. */
  putGrades(grades: CachedGrade[]): Promise<void>
  allGrades(): Promise<CachedGrade[]>
}

/** In-memory store, for tests and for environments without IndexedDB. */
export class MemoryHandStore implements HandStore {
  private hands: StoredHand[] = []
  private estimates: Estimate[] = []
  private grades = new Map<string, CachedGrade>()

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
    this.estimates = []
    this.grades.clear()
  }

  async putEstimates(estimates: Estimate[]): Promise<void> {
    this.estimates.push(...estimates)
  }

  async allEstimates(): Promise<Estimate[]> {
    return [...this.estimates]
  }

  async putGrades(grades: CachedGrade[]): Promise<void> {
    for (const grade of grades) this.grades.set(grade.key, grade)
  }

  async allGrades(): Promise<CachedGrade[]> {
    return [...this.grades.values()]
  }
}

const DB_NAME = 'stat-poker'
const DB_VERSION = 3
const STORE = 'hands'
const ESTIMATES = 'estimates'
const GRADES = 'grades'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    // Another tab holding the old version blocks the upgrade. Without this the
    // promise never settles, and since the connection is cached, every read
    // and write afterwards waits on it forever with nothing said.
    request.onblocked = () =>
      reject(
        new Error(
          'Another tab has stat-poker open on an older version. Close it and reload.',
        ),
      )
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { autoIncrement: true })
        store.createIndex('playedAt', 'playedAt')
      }
      // Added in version two; an existing database gains it without losing
      // the hands already in it.
      if (!db.objectStoreNames.contains(ESTIMATES)) {
        db.createObjectStore(ESTIMATES, { autoIncrement: true })
      }
      // Version three. Keyed by the hand rather than auto-numbered, so
      // regrading a hand replaces its verdict instead of filing a second one.
      if (!db.objectStoreNames.contains(GRADES)) {
        db.createObjectStore(GRADES, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      // If this tab is the one holding an old version open, step aside rather
      // than blocking the tab doing the upgrading.
      db.onversionchange = () => db.close()
      resolve(db)
    }
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
    const db = await this.connect()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([ESTIMATES, GRADES], 'readwrite')
      transaction.objectStore(ESTIMATES).clear()
      transaction.objectStore(GRADES).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async putEstimates(estimates: Estimate[]): Promise<void> {
    if (estimates.length === 0) return
    const db = await this.connect()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ESTIMATES, 'readwrite')
      const store = transaction.objectStore(ESTIMATES)
      for (const estimate of estimates) store.add(estimate)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async allEstimates(): Promise<Estimate[]> {
    const db = await this.connect()
    const transaction = db.transaction(ESTIMATES, 'readonly')
    return asPromise(
      transaction.objectStore(ESTIMATES).getAll() as IDBRequest<Estimate[]>,
    )
  }

  async putGrades(grades: CachedGrade[]): Promise<void> {
    if (grades.length === 0) return
    const db = await this.connect()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(GRADES, 'readwrite')
      const store = transaction.objectStore(GRADES)
      for (const grade of grades) store.put(grade)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  async allGrades(): Promise<CachedGrade[]> {
    const db = await this.connect()
    const transaction = db.transaction(GRADES, 'readonly')
    return asPromise(transaction.objectStore(GRADES).getAll() as IDBRequest<CachedGrade[]>)
  }
}

/** The real store where one is available, an in-memory one otherwise. */
export function createHandStore(): HandStore {
  if (typeof indexedDB === 'undefined') return new MemoryHandStore()
  return new IndexedDbHandStore()
}

/**
 * The whole local record as one file.
 *
 * Guesses travel with the hands. Exporting half of what the app knows would
 * make the export a partial backup dressed up as a complete one, which is
 * exactly the failure the export exists to prevent.
 */
export async function exportStore(store: HandStore): Promise<string> {
  const [hands, estimates] = await Promise.all([store.all(), store.allEstimates()])
  return exportHands(hands, estimates)
}

/**
 * Read a file into a store.
 *
 * What went in comes back whole rather than as a count, because the caller has
 * to fold it into what is already on screen: hands into the statistics, guesses
 * into the running accuracy. An import that appears to have done nothing is
 * indistinguishable from one that failed.
 */
export async function importIntoStore(
  store: HandStore,
  json: string,
): Promise<{ hands: StoredHand[]; estimates: Estimate[] }> {
  const { hands, estimates } = importHands(json)
  await store.putMany(hands)
  await store.putEstimates(estimates)
  return { hands, estimates }
}
