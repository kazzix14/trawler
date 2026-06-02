/**
 * IndexedDB connection for the background service worker.
 *
 * Two stores:
 *  - 'screenshots' (keyPath 'id'): screenshot metadata + the captured data URL.
 *  - 'events'      (keyPath 'id'): persisted timeline events with a 'tabId'
 *                  property and a compound index 'by_tab_ts' on ['tabId','ts']
 *                  so windowed queries can range over a single tab efficiently.
 *
 * The open promise is cached at module scope so every caller shares one
 * connection. No top-level side effects: indexedDB is only touched inside
 * openDb(), which runs at call time (never at import time).
 */

export const DB_NAME = 'trawler';

/** Schema version. Bump only alongside an onupgradeneeded migration. */
const DB_VERSION = 2;

const SCREENSHOTS_STORE = 'screenshots';
const EVENTS_STORE = 'events';
const EVENTS_TAB_TS_INDEX = 'by_tab_ts';
const MARKS_STORE = 'marks';
const MARKS_TAB_INDEX = 'by_tab';

/** Cached connection promise — lazily created on first openDb() call. */
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open (or reuse) the shared IndexedDB connection.
 *
 * Repeated calls return the same promise. If the connection closes
 * unexpectedly (e.g. a version change from another context), the cache is
 * cleared so a subsequent call re-opens cleanly.
 */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SCREENSHOTS_STORE)) {
        db.createObjectStore(SCREENSHOTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        const events = db.createObjectStore(EVENTS_STORE, { keyPath: 'id' });
        events.createIndex(EVENTS_TAB_TS_INDEX, ['tabId', 'ts']);
      }
      if (!db.objectStoreNames.contains(MARKS_STORE)) {
        const marks = db.createObjectStore(MARKS_STORE, { keyPath: 'id' });
        marks.createIndex(MARKS_TAB_INDEX, 'tabId');
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If another context triggers a version change, drop our cached handle
      // so the next openDb() re-establishes a fresh connection.
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB open blocked by an existing connection'));
    };
  });

  return dbPromise;
}

/** Wrap a single IDBRequest as a promise of its result. */
export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}
