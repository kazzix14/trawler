import { defineContentScript, injectScript } from '#imports';
import { onMessage, sendMessage } from '../lib/messaging';
import { getSettings, watchSettings } from '../lib/settings';
import { uid } from '../lib/id';
import { now } from '../lib/time';
import type { MarkEvent, MarkRecord, MarkedElement, Settings, TimelineEvent } from '../lib/types';
import { TimelineStore } from '../lib/content/timeline-store';
import { createRelayReceiver } from '../lib/content/relay-receiver';
import { createInteractionTracker } from '../lib/content/interaction-tracker';
import { createDomObserver } from '../lib/content/dom-observer';
import { createNavigationTracker } from '../lib/content/navigation-tracker';
import { createElementPicker } from '../lib/content/element-picker';
import { createScreenshotTrigger } from '../lib/content/screenshot-trigger';

const FLUSH_INTERVAL_MS = 2000;

/**
 * ISOLATED-world content script: the live collector. Injects the MAIN-world
 * hooks, records the rolling timeline in memory (never the page's storage),
 * drives the picker, requests screenshots, and serves the popup/background.
 */
export default defineContentScript({
  matches: ['*://*/*'],
  runAt: 'document_start',
  world: 'ISOLATED',
  allFrames: false,
  async main(ctx) {
    // Get the page-context hooks running as early as possible.
    try {
      await injectScript('/inject.js', { keepInDom: true });
    } catch {
      // Some pages (strict CSP / restricted schemes) block injection; the
      // DOM-level collectors below still work.
    }

    let settings: Settings = await getSettings();
    const store = new TimelineStore({
      maxItems: settings.maxBufferEvents,
      maxAgeMs: settings.maxBufferSec * 1000,
    });

    const trigger = createScreenshotTrigger({
      getSettings: () => settings,
      request: async (reason, dedupKey) => {
        try {
          const res = await sendMessage('requestScreenshot', { reason, dedupKey });
          return res.screenshotId;
        } catch {
          return null;
        }
      },
      setScreenshot: (eventId, screenshotId) => store.setScreenshot(eventId, screenshotId),
    });

    const onEvent = (e: TimelineEvent): void => {
      if (e.kind === 'perf' && !settings.capturePerf) return;
      store.add(e);
      trigger.consider(e);
    };


    const receiver = createRelayReceiver({ onEvent, bodyMaxChars: settings.bodyMaxChars });
    const interactions = createInteractionTracker({ onEvent, maskInputs: settings.maskInputs });
    const dom = createDomObserver({ onEvent });
    const nav = createNavigationTracker({ onEvent });
    // Picked-but-not-yet-marked element. The picker only STAGES the element;
    // it becomes a mark when the user adds a note in the side panel.
    let pendingPick: MarkedElement | null = null;
    // "Start here" cue (Clear timeline). Marks/exports may extract from here.
    let cueTs: number | null = null;
    const picker = createElementPicker({
      onMark: (element: MarkedElement) => {
        pendingPick = element;
      },
    });

    receiver.start();
    interactions.start();
    dom.start();
    nav.start();

    const unwatch = watchSettings((s) => {
      settings = s;
    });

    // Flush pending events to the durable background log (continuity across
    // reloads). Best-effort: drop silently if the background is asleep.
    const flush = (): void => {
      const pending = store.drain();
      if (pending.length) sendMessage('persistEvents', { events: pending }).catch(() => {});
    };
    ctx.setInterval(flush, FLUSH_INTERVAL_MS);
    ctx.addEventListener(window, 'pagehide', flush);

    // ── Served by this tab (popup / background route here with our tabId) ──
    onMessage('collectTimeline', ({ data }) => {
      flush();
      return { events: store.range(data.startTs, data.endTs), pageUrl: location.href };
    });
    onMessage('getTimelineSummary', () => ({
      ...store.summary(location.href),
      pickerActive: picker.active,
      pendingPick,
      cueTs,
    }));
    onMessage('addCheckpoint', ({ data }) => {
      const id = uid();
      onEvent({ id, kind: 'checkpoint', ts: now(), label: data.label });
      return { id };
    });
    onMessage('addMark', async ({ data }) => {
      const id = uid();
      const ts = now();
      const element = pendingPick ?? undefined;
      const mark: MarkEvent = { id, kind: 'mark', ts, note: data.note, element };
      store.add(mark);
      pendingPick = null;

      // Capture the screenshot and WAIT for it, so the mark reliably carries one
      // before the user can copy it (fixes the prior async race).
      try {
        const shot = await sendMessage('requestScreenshot', {
          reason: 'mark',
          dedupKey: `mark:${id}`,
        });
        if (shot.screenshotId) {
          store.setScreenshot(id, shot.screenshotId);
          mark.screenshotId = shot.screenshotId;
        }
      } catch {
        // Screenshot is best-effort.
      }

      // Freeze the chosen window up to the mark and persist it durably, so the
      // mark survives buffer eviction / reload / SW restart. The window start is
      // chosen by the panel's current time-window setting.
      const navStartTs = Math.max(0, Math.min(data.startTs, ts));
      const record: MarkRecord = {
        id,
        ts,
        tabId: -1, // the background fills this in from sender.tab
        pageUrl: location.href,
        note: data.note,
        element,
        screenshotId: mark.screenshotId,
        navStartTs,
        events: store.range(navStartTs, ts),
      };
      try {
        await sendMessage('persistMark', { record });
      } catch {
        // Durable persistence is best-effort.
      }
      return { id };
    });
    onMessage('clearPick', () => {
      pendingPick = null;
      return { ok: true } as const;
    });
    onMessage('clearTimeline', () => {
      // A non-destructive cue: future marks/exports can start from here.
      cueTs = now();
      return { cueTs };
    });
    onMessage('setPicker', ({ data }) => {
      if (data.active === undefined) picker.toggle();
      else if (data.active) picker.activate();
      else picker.deactivate();
      return { active: picker.active };
    });

    ctx.onInvalidated(() => {
      flush();
      unwatch();
      receiver.stop();
      interactions.stop();
      dom.stop();
      nav.stop();
      picker.deactivate();
    });
  },
});
