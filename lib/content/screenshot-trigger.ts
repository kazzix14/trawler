/**
 * Screenshot trigger (ISOLATED world).
 *
 * Decides whether a timeline event warrants a screenshot, derives a stable
 * (reason, dedupKey) pair, and fires an async capture request. The decision
 * uses the user's `screenshotTriggers` settings and, for network events, the
 * capture rule engine. Suppression itself happens downstream (the Deduper in
 * the request handler keyed by dedupKey) — this module only computes the key.
 *
 * `consider()` is synchronous and fire-and-forget: the async request is kicked
 * off without awaiting, and any request error is swallowed so collecting events
 * never throws into the capture pipeline.
 */
import type { ScreenshotReason, Settings, TimelineEvent } from '../types';
import { consoleDedupKey, networkDedupKey } from '../capture/dedup';
import { shouldCaptureNetwork, urlToFacts } from '../capture/rules';

export interface ScreenshotTriggerOptions {
  getSettings: () => Settings;
  request: (reason: ScreenshotReason, dedupKey: string) => Promise<string | null>;
  setScreenshot: (eventId: string, screenshotId: string) => void;
}

interface Decision {
  reason: ScreenshotReason;
  dedupKey: string;
}

/**
 * Resolve the (reason, dedupKey) for an event, or undefined when the event does
 * not warrant a screenshot under the current settings.
 */
function decide(event: TimelineEvent, settings: Settings): Decision | undefined {
  const triggers = settings.screenshotTriggers;
  switch (event.kind) {
    case 'checkpoint':
      // Unique per-event key so a checkpoint shot is never suppressed.
      return triggers.checkpoint
        ? { reason: 'checkpoint', dedupKey: `checkpoint:${event.id}` }
        : undefined;
    case 'mark':
      return triggers.mark ? { reason: 'mark', dedupKey: `mark:${event.id}` } : undefined;
    case 'console':
      if (!triggers.consoleError || event.level !== 'error') return undefined;
      return {
        reason: 'console-error',
        dedupKey: consoleDedupKey(event.args.join(' '), event.stackTop),
      };
    case 'error':
      if (!triggers.consoleError) return undefined;
      return {
        reason: 'page-error',
        dedupKey: consoleDedupKey(
          event.message,
          `${event.source ?? ''}:${event.line ?? ''}:${event.col ?? ''}`,
        ),
      };
    case 'unhandledrejection':
      if (!triggers.consoleError) return undefined;
      return { reason: 'page-error', dedupKey: consoleDedupKey(event.reason, '') };
    case 'network':
      if (!triggers.network) return undefined;
      if (!shouldCaptureNetwork(settings.captureRules, event.url, event.status)) return undefined;
      return { reason: 'network', dedupKey: networkDedupKeyFor(event.url, event.status) };
    default:
      return undefined;
  }
}

/** Build a network dedup key from the URL + status via the rule-engine facts. */
function networkDedupKeyFor(url: string, status: number | undefined): string {
  const facts = urlToFacts(url, status);
  return networkDedupKey(facts.domain, facts.path, facts.status);
}

export function createScreenshotTrigger(opts: ScreenshotTriggerOptions): {
  consider(e: TimelineEvent): void;
} {
  function consider(event: TimelineEvent): void {
    const decision = decide(event, opts.getSettings());
    if (decision === undefined) return;

    void Promise.resolve()
      .then(() => opts.request(decision.reason, decision.dedupKey))
      .then((screenshotId) => {
        if (screenshotId !== null) opts.setScreenshot(event.id, screenshotId);
      })
      .catch(() => {
        // Swallow request errors — a failed shot must never disrupt capture.
      });
  }

  return { consider };
}
