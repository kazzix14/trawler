/**
 * Content-side rolling timeline store (ADR Decision 3).
 *
 * Holds two views of the same event stream:
 *  - a {@link RingBuffer} pruned by age + count, used for live querying
 *    (range/all/summary) by the popup and export flows;
 *  - a `pending` array that accumulates every added event until {@link drain}
 *    is called, used to flush durably to the background event log.
 *
 * The store owns its events, so mutating a buffered event in place
 * (see {@link TimelineStore.setScreenshot}) is acceptable here.
 */

import { RingBuffer } from '../ring-buffer';
import { now } from '../time';
import type {
  CheckpointInfo,
  MarkEvent,
  ScreenshotReason,
  ThumbInfo,
  TimelineEvent,
  TimelineSummary,
} from '../types';

export interface TimelineStoreOptions {
  maxItems: number;
  maxAgeMs: number;
}

/** Derive the screenshot reason that best describes a captured event. */
function reasonForEvent(e: TimelineEvent): ScreenshotReason {
  switch (e.kind) {
    case 'checkpoint':
      return 'checkpoint';
    case 'mark':
      return 'mark';
    case 'error':
    case 'unhandledrejection':
      return 'page-error';
    case 'console':
      return e.level === 'error' ? 'console-error' : 'manual';
    case 'network':
      return 'network';
    default:
      return 'manual';
  }
}

export class TimelineStore {
  private readonly buffer: RingBuffer<TimelineEvent>;
  /** Events added since the last drain(), awaiting durable flush. */
  private pending: TimelineEvent[] = [];

  constructor(opts: TimelineStoreOptions) {
    this.buffer = new RingBuffer<TimelineEvent>({
      maxItems: opts.maxItems,
      maxAgeMs: opts.maxAgeMs,
      getTs: (e) => e.ts,
    });
  }

  /** Add an event to both the queryable buffer and the pending flush queue. */
  add(e: TimelineEvent): void {
    this.buffer.push(e, now());
    this.pending.push(e);
  }

  /**
   * Attach a stored screenshot id to a buffered event.
   *
   * The store owns its events, so mutating the buffered object in place is
   * intentional — it keeps the single owned copy authoritative for both the
   * ring buffer and any references handed out via range()/all().
   */
  setScreenshot(eventId: string, screenshotId: string): void {
    const target = this.buffer.toArray().find((e) => e.id === eventId);
    if (target) {
      target.screenshotId = screenshotId;
    }
  }

  /** Events whose timestamp falls within [startTs, endTs] (inclusive). */
  range(startTs: number, endTs: number): TimelineEvent[] {
    return this.buffer.range(startTs, endTs);
  }

  /** Snapshot of all buffered events (newest pruning applied). */
  all(): TimelineEvent[] {
    return this.buffer.toArray();
  }

  /** Build a popup-facing summary of the current buffer for a given page URL. */
  summary(pageUrl: string): TimelineSummary {
    const events = this.buffer.toArray();

    const checkpoints: CheckpointInfo[] = events
      .filter((e): e is Extract<TimelineEvent, { kind: 'checkpoint' }> => e.kind === 'checkpoint')
      .map((e) => ({ id: e.id, ts: e.ts, label: e.label }));

    const thumbs: ThumbInfo[] = events
      .filter((e): e is TimelineEvent & { screenshotId: string } => e.screenshotId !== undefined)
      .map((e) => ({
        screenshotId: e.screenshotId,
        ts: e.ts,
        reason: reasonForEvent(e),
      }));

    const firstTs = events.length > 0 ? events[0].ts : 0;
    const lastTs = events.length > 0 ? events[events.length - 1].ts : 0;

    return {
      checkpoints,
      thumbs,
      marks: this.marks(),
      firstTs,
      lastTs,
      pageUrl,
      eventCount: this.buffer.size,
    };
  }

  /** User-authored marks in chronological order (oldest first). */
  marks(): MarkEvent[] {
    return this.buffer
      .toArray()
      .filter((e): e is MarkEvent => e.kind === 'mark');
  }

  /** Return events added since the last drain(), then clear the queue. */
  drain(): TimelineEvent[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }

  get size(): number {
    return this.buffer.size;
  }
}
