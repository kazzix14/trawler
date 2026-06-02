/**
 * Export orchestration (ADR Decision 7).
 *
 * Gathers the timeline for a window from both the live content script and the
 * durable IndexedDB log, resolves every referenced screenshot to an on-disk
 * file, then hands a pure {@link ExportInput} to {@link serializeBundle} to
 * produce the fact-only clipboard text. All browser access is indirect, via the
 * imported helpers; this module owns no extension APIs of its own.
 */
import { sendMessage } from '../messaging';
import { now } from '../time';
import type {
  ExportInput,
  ExportResult,
  ExportWindow,
  MarkEvent,
  Settings,
  TimelineEvent,
} from '../types';
import { serializeBundle } from '../export/serialize-bundle';
import { queryWindow } from './event-log';
import { getMark } from './mark-store';
import { getScreenshotDataUrl, getScreenshotMeta } from './screenshot-store';
import { saveDataUrl } from './downloads';

export interface RunExportOptions {
  tabId: number;
  windowId?: number;
  window: ExportWindow;
  memo?: string;
  settings: Settings;
}

interface LiveTimeline {
  events: TimelineEvent[];
  pageUrl: string;
}

/** Collect (live + durable), merge, resolve and serialize a window capture. */
export async function runExport(opts: RunExportOptions): Promise<ExportResult> {
  try {
    const { startTs, endTs } = opts.window;
    const live = await collectLive(opts.tabId, startTs, endTs);
    const durable = await collectDurable(opts.tabId, startTs, endTs);
    const merged = mergeEvents(live.events, durable);
    return await assemble(opts.window, opts.memo, merged, live.pageUrl || '', opts.settings);
  } catch (error: unknown) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Serialize a single retained mark from its frozen snapshot (eviction-proof). */
export async function runExportMark(markId: string, settings: Settings): Promise<ExportResult> {
  try {
    const rec = await getMark(markId);
    if (!rec) return { ok: false, error: 'Mark not found (it may have been cleared).' };
    const win: ExportWindow = {
      startTs: rec.navStartTs,
      endTs: rec.ts,
      label: `mark "${rec.note}"`,
    };
    return await assemble(win, rec.note, rec.events, rec.pageUrl, settings);
  } catch (error: unknown) {
    return { ok: false, error: errorMessage(error) };
  }
}

/** Resolve screenshots + serialize a set of events into a bundle. */
async function assemble(
  win: ExportWindow,
  memo: string | undefined,
  events: TimelineEvent[],
  pageUrl: string,
  settings: Settings,
): Promise<ExportResult> {
  const marks = events.filter((e): e is MarkEvent => e.kind === 'mark');
  const screenshotPaths = await resolveScreenshots(events, settings);
  const input: ExportInput = {
    window: win,
    memo,
    events,
    marks,
    screenshotPaths,
    pageUrl,
    generatedAtIso: new Date(now()).toISOString(),
  };
  return {
    ok: true,
    text: serializeBundle(input),
    screenshotCount: Object.keys(screenshotPaths).length,
  };
}

/** Ask the tab's content script for its in-memory timeline; tolerate absence. */
async function collectLive(
  tabId: number,
  startTs: number,
  endTs: number,
): Promise<LiveTimeline> {
  try {
    const res = await sendMessage('collectTimeline', { startTs, endTs }, tabId);
    return { events: res?.events ?? [], pageUrl: res?.pageUrl ?? '' };
  } catch {
    // Content script may be absent (e.g. extension page, blocked origin).
    return { events: [], pageUrl: '' };
  }
}

/** Read the durable IndexedDB log for the window; tolerate read errors. */
async function collectDurable(
  tabId: number,
  startTs: number,
  endTs: number,
): Promise<TimelineEvent[]> {
  try {
    return await queryWindow(tabId, startTs, endTs);
  } catch {
    return [];
  }
}

/**
 * Merge live + durable events deduped by id, preferring the live copy (it
 * carries the freshest `screenshotId`). Sorted ascending by timestamp.
 */
function mergeEvents(
  live: TimelineEvent[],
  durable: TimelineEvent[],
): TimelineEvent[] {
  const byId = new Map<string, TimelineEvent>();
  for (const e of durable) byId.set(e.id, e);
  for (const e of live) byId.set(e.id, e); // live wins on collision
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * For every unique screenshotId, fetch the stored data URL and persist it to
 * disk, returning a screenshotId -> path map. Per-screenshot errors are
 * swallowed so one bad screenshot never fails the whole export.
 */
async function resolveScreenshots(
  events: TimelineEvent[],
  settings: Settings,
): Promise<Record<string, string>> {
  const ids = uniqueScreenshotIds(events);
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        return await resolveOne(id, settings);
      } catch {
        return null;
      }
    }),
  );

  const paths: Record<string, string> = {};
  for (const entry of entries) {
    if (entry) paths[entry.id] = entry.path;
  }
  return paths;
}

interface ResolvedShot {
  id: string;
  path: string;
}

/** Fetch one screenshot's data URL and save it under the configured subdir. */
async function resolveOne(
  id: string,
  settings: Settings,
): Promise<ResolvedShot | null> {
  const dataUrl = await getScreenshotDataUrl(id);
  if (!dataUrl) return null;

  const meta = await getScreenshotMeta(id);
  const ext = screenshotExt(meta?.mime, settings.screenshotFormat);
  const filename = `${settings.downloadSubdir}/trawler-${id}.${ext}`;
  const path = await saveDataUrl(dataUrl, filename);
  return { id, path };
}

/** Distinct screenshot ids referenced by the merged events, in first-seen order. */
function uniqueScreenshotIds(events: TimelineEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.screenshotId) seen.add(e.screenshotId);
  }
  return [...seen];
}

/** Prefer the stored MIME's extension; fall back to the configured format. */
function screenshotExt(mime: string | undefined, format: Settings['screenshotFormat']): string {
  if (mime?.includes('jpeg')) return 'jpg';
  return format === 'jpeg' ? 'jpg' : 'png';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
