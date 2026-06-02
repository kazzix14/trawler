/**
 * Durable cross-navigation event log backed by IndexedDB.
 *
 * Events outlive a single page lifetime (the in-page ring buffer is reset on
 * navigation), so the content script periodically flushes drained events here
 * keyed by the owning tab. Export later queries a time window across all the
 * navigations that happened within one tab.
 *
 * Object store 'events' uses `event.id` as its keyPath and indexes
 * ['tabId', 'ts'] as 'by_tab_ts'. Records are stored as `{...event, tabId}`;
 * the extra `tabId` field is stripped back out on read.
 */

import { openDb, reqToPromise } from './db';
import type { TimelineEvent } from '../types';

const EVENTS_STORE = 'events';
const BY_TAB_TS_INDEX = 'by_tab_ts';

/** A stored record: a TimelineEvent augmented with its owning tab id. */
type StoredEvent = TimelineEvent & { tabId: number };

/**
 * Persist events for a tab in a single readwrite transaction.
 *
 * Each event's `id` is the keyPath and event ids are unique uuids, so repeated
 * puts of the same event are idempotent (the latest write wins, which lets us
 * fill in a `screenshotId` on re-flush).
 */
export async function appendEvents(
  tabId: number,
  events: TimelineEvent[],
): Promise<void> {
  if (events.length === 0) return;
  // The connection is shared/cached by db.ts for the worker's lifetime — never
  // close it here, or concurrent screenshot/export operations would fail with
  // InvalidStateError on the closing connection.
  const db = await openDb();
  await runReadWrite(db, (store) => {
    for (const event of events) {
      const record: StoredEvent = { ...event, tabId };
      store.put(record);
    }
  });
}

/**
 * Collect every event for `tabId` whose `ts` falls within [startTs, endTs],
 * stripped back to plain TimelineEvents and sorted by `ts` ascending.
 */
export async function queryWindow(
  tabId: number,
  startTs: number,
  endTs: number,
): Promise<TimelineEvent[]> {
  const db = await openDb();
  const tx = db.transaction(EVENTS_STORE, 'readonly');
  const index = tx.objectStore(EVENTS_STORE).index(BY_TAB_TS_INDEX);
  const range = IDBKeyRange.bound([tabId, startTs], [tabId, endTs]);
  const records = await reqToPromise(index.getAll(range) as IDBRequest<StoredEvent[]>);
  return records.map(stripTabId).sort((a, b) => a.ts - b.ts);
}

/** Cursor-delete every record older than `beforeTs`, across all tabs. */
export async function pruneEvents(beforeTs: number): Promise<void> {
  const db = await openDb();
  await runReadWrite(db, (store) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as StoredEvent;
      if (record.ts < beforeTs) cursor.delete();
      cursor.continue();
    };
  });
}

/** Drop the persisted `tabId` field, returning a plain TimelineEvent. */
function stripTabId(record: StoredEvent): TimelineEvent {
  const { tabId: _tabId, ...event } = record;
  return event as TimelineEvent;
}

/**
 * Run a readwrite transaction against the events store and resolve when it
 * commits (or reject on error/abort). The `body` issues store operations;
 * any cursor iteration it starts is awaited via the transaction's completion.
 */
function runReadWrite(
  db: IDBDatabase,
  body: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EVENTS_STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('events transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('events transaction aborted'));
    body(tx.objectStore(EVENTS_STORE));
  });
}
