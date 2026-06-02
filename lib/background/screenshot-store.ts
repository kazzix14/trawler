/**
 * Screenshot persistence on top of the shared IndexedDB connection.
 *
 * Records in the 'screenshots' store carry the full {@link ScreenshotMeta}
 * plus the captured `dataUrl`. Readers can fetch either the data URL (for
 * rendering / export) or just the metadata (without paying to deserialize the
 * potentially large data URL beyond IndexedDB's own read cost).
 */

import type { ScreenshotMeta } from '../types';
import { openDb, reqToPromise } from './db';

const SCREENSHOTS_STORE = 'screenshots';

/** Shape stored in IndexedDB: metadata fields plus the encoded image. */
interface StoredScreenshot extends ScreenshotMeta {
  dataUrl: string;
}

/** Persist a screenshot's metadata and its data URL (overwrites by id). */
export async function putScreenshot(meta: ScreenshotMeta, dataUrl: string): Promise<void> {
  const db = await openDb();
  const record: StoredScreenshot = { ...meta, dataUrl };
  await runWrite(db, (store) => store.put(record));
}

/** Return the stored data URL for `id`, or null if absent. */
export async function getScreenshotDataUrl(id: string): Promise<string | null> {
  const record = await readRecord(id);
  return record?.dataUrl ?? null;
}

/** Return the {@link ScreenshotMeta} for `id` (without the data URL), or null. */
export async function getScreenshotMeta(id: string): Promise<ScreenshotMeta | null> {
  const record = await readRecord(id);
  if (!record) return null;
  // Strip the data URL so callers get a lean metadata object.
  const { dataUrl: _dataUrl, ...meta } = record;
  return meta;
}

/** Delete every screenshot recorded strictly before `beforeTs`. */
export async function pruneScreenshots(beforeTs: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SCREENSHOTS_STORE, 'readwrite');
    const store = tx.objectStore(SCREENSHOTS_STORE);
    const cursorReq = store.openCursor();

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const value = cursor.value as StoredScreenshot;
      if (value.ts < beforeTs) cursor.delete();
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error('Cursor failed'));

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('pruneScreenshots transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('pruneScreenshots transaction aborted'));
  });
}

/** Read one stored record by id (includes the data URL), or null. */
async function readRecord(id: string): Promise<StoredScreenshot | null> {
  const db = await openDb();
  const tx = db.transaction(SCREENSHOTS_STORE, 'readonly');
  const store = tx.objectStore(SCREENSHOTS_STORE);
  const result = await reqToPromise(store.get(id) as IDBRequest<StoredScreenshot | undefined>);
  return result ?? null;
}

/** Run a single write operation inside a readwrite transaction. */
function runWrite(db: IDBDatabase, op: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SCREENSHOTS_STORE, 'readwrite');
    op(tx.objectStore(SCREENSHOTS_STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('screenshot write transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('screenshot write transaction aborted'));
  });
}
