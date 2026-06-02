/**
 * Runtime messaging protocol (content ↔ background ↔ popup).
 *
 * WXT ships no messaging; we use @webext-core/messaging. The ProtocolMap is the
 * single typed contract. Routing rule of the library:
 *   - sendMessage(key, data)          → delivered to the background
 *   - sendMessage(key, data, tabId)   → delivered to that tab's content script
 * Each context registers onMessage() only for the keys it actually serves.
 */
import { defineExtensionMessaging } from '@webext-core/messaging';
import type {
  ExportResult,
  ExportWindow,
  MarkRecord,
  PanelSnapshot,
  ScreenshotReason,
  TimelineEvent,
} from './types';

export interface ProtocolMap {
  // content → background
  persistEvents(data: { events: TimelineEvent[] }): void;
  requestScreenshot(data: { reason: ScreenshotReason; dedupKey: string }): {
    screenshotId: string | null;
  };
  /** Durably store a mark with its frozen timeline snapshot. */
  persistMark(data: { record: MarkRecord }): { ok: true };

  // side panel → background
  exportContext(data: { window: ExportWindow; memo?: string }): ExportResult;
  /** Build a self-contained bundle from a single retained mark's snapshot. */
  exportMark(data: { markId: string }): ExportResult;
  /** Build one bundle from ALL retained marks for the active tab. */
  exportMarks(): ExportResult;

  // background → content (requires tabId)
  collectTimeline(data: { startTs: number; endTs: number }): {
    events: TimelineEvent[];
    pageUrl: string;
  };

  // side panel → content (requires tabId)
  getTimelineSummary(): PanelSnapshot;
  addCheckpoint(data: { label?: string }): { id: string };
  /** Create a mark from a required note + pending pick, retaining the timeline
   * window [startTs, now] (startTs is chosen by the panel's window setting). */
  addMark(data: { note: string; startTs: number }): { id: string };
  /** Discard the pending pick without creating a mark. */
  clearPick(): { ok: true };
  /** Set the "start here" cue (does NOT delete recorded events). */
  clearTimeline(): { cueTs: number };
  /** `active` omitted = toggle. Returns the resulting state. */
  setPicker(data: { active?: boolean }): { active: boolean };
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
