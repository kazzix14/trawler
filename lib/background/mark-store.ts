/**
 * Durable mark store (ADR Decision 4 — per-mark timeline retention).
 *
 * Each mark keeps a FROZEN snapshot of its page's timeline window, so per-mark
 * copy survives ring-buffer eviction, navigations and service-worker restarts.
 * Extension-origin IndexedDB — readable directly from the side panel (same
 * origin), written by the background on `persistMark`.
 */
import type { MarkRecord } from '../types';
import { openDb, reqToPromise } from './db';

const STORE = 'marks';
const BY_TAB_INDEX = 'by_tab';

export async function putMark(record: MarkRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('putMark failed'));
    tx.onabort = () => reject(tx.error ?? new Error('putMark aborted'));
  });
}

/** All marks for a tab, newest first. */
export async function listMarks(tabId: number): Promise<MarkRecord[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const index = tx.objectStore(STORE).index(BY_TAB_INDEX);
  const records = await reqToPromise(
    index.getAll(IDBKeyRange.only(tabId)) as IDBRequest<MarkRecord[]>,
  );
  return records.sort((a, b) => b.ts - a.ts);
}

export async function getMark(id: string): Promise<MarkRecord | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const result = await reqToPromise(
    tx.objectStore(STORE).get(id) as IDBRequest<MarkRecord | undefined>,
  );
  return result ?? null;
}

export async function deleteMark(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('deleteMark failed'));
    tx.onabort = () => reject(tx.error ?? new Error('deleteMark aborted'));
  });
}
