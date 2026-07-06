/**
 * Minimal promise-based IndexedDB key-value store.
 *
 * Used for workspace/snapshot persistence: IndexedDB structured-clones values
 * natively (no JSON round-trip) and has far higher quotas than localStorage's
 * ~5MB, which whole-canvas snapshots exceed quickly.
 */

const DB_NAME = 'tutor-whiteboard-kv'
const STORE_NAME = 'kv'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION)
			request.onupgradeneeded = () => {
				if (!request.result.objectStoreNames.contains(STORE_NAME)) {
					request.result.createObjectStore(STORE_NAME)
				}
			}
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
		})
		// Allow a retry after a failed open (e.g. private-mode restrictions)
		dbPromise.catch(() => {
			dbPromise = null
		})
	}
	return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
	})
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
	const db = await openDb()
	const tx = db.transaction(STORE_NAME, 'readonly')
	return requestToPromise(tx.objectStore(STORE_NAME).get(key)) as Promise<T | undefined>
}

export async function kvSet(key: string, value: unknown): Promise<void> {
	const db = await openDb()
	const tx = db.transaction(STORE_NAME, 'readwrite')
	await requestToPromise(tx.objectStore(STORE_NAME).put(value, key))
}

export async function kvDelete(key: string): Promise<void> {
	const db = await openDb()
	const tx = db.transaction(STORE_NAME, 'readwrite')
	await requestToPromise(tx.objectStore(STORE_NAME).delete(key))
}
