import { browser, defineBackground } from '#imports';
import { onMessage, sendMessage } from '../lib/messaging';
import { getSettings } from '../lib/settings';
import { Deduper } from '../lib/capture/dedup';
import { uid } from '../lib/id';
import { now } from '../lib/time';
import type { ScreenshotMeta } from '../lib/types';
import { createCapturer } from '../lib/background/screenshot';
import { putScreenshot, pruneScreenshots } from '../lib/background/screenshot-store';
import { appendEvents, pruneEvents } from '../lib/background/event-log';
import { runExport, runExportMark } from '../lib/background/export';
import { putMark } from '../lib/background/mark-store';

const SCREENSHOT_MIN_INTERVAL_MS = 550; // captureVisibleTab is hard-capped at 2/sec
const PRUNE_INTERVAL_MS = 60_000;
const PRUNE_SLACK_MS = 60_000;

/**
 * Background service worker (Chrome) / event page (Firefox). Owns screenshot
 * capture (throttled + deduped), screenshot + durable-event storage in the
 * EXTENSION-origin IndexedDB (never the page's), and export assembly.
 *
 * Listeners are registered synchronously on the first tick so they survive SW
 * restarts; settings-derived state is refreshed asynchronously afterwards.
 */
export default defineBackground({
  type: 'module',
  persistent: false,
  main() {
    let capturer = createCapturer({ format: 'png', minIntervalMs: SCREENSHOT_MIN_INTERVAL_MS });
    let deduper = new Deduper(3000);

    getSettings()
      .then((s) => {
        capturer = createCapturer({
          format: s.screenshotFormat,
          minIntervalMs: SCREENSHOT_MIN_INTERVAL_MS,
        });
        deduper = new Deduper(s.dedupWindowMs);
      })
      .catch(() => {});

    onMessage('persistEvents', async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return;
      await appendEvents(tabId, data.events).catch(() => {});
    });

    onMessage('requestScreenshot', async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      const windowId = sender.tab?.windowId;
      if (tabId === undefined) return { screenshotId: null };
      if (!deduper.allow(`${tabId}:${data.dedupKey}`, now())) return { screenshotId: null };
      try {
        const dataUrl = await capturer.capture(windowId);
        const id = uid('shot');
        const mime = dataUrl.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png';
        const meta: ScreenshotMeta = { id, ts: now(), tabId, reason: data.reason, mime };
        await putScreenshot(meta, dataUrl);
        return { screenshotId: id };
      } catch {
        return { screenshotId: null };
      }
    });

    onMessage('exportContext', async ({ data }) => {
      const settings = await getSettings();
      const tab = await activeTab();
      if (!tab?.id) return { ok: false, error: 'No active tab to export from.' };
      return runExport({
        tabId: tab.id,
        windowId: tab.windowId,
        window: data.window,
        memo: data.memo,
        settings,
      });
    });

    onMessage('persistMark', async ({ data, sender }) => {
      const tabId = sender.tab?.id;
      const record = tabId === undefined ? data.record : { ...data.record, tabId };
      await putMark(record).catch(() => {});
      return { ok: true } as const;
    });

    onMessage('exportMark', async ({ data }) => {
      const settings = await getSettings();
      return runExportMark(data.markId, settings);
    });

    // Side panel open behaviour. Chrome (`sidePanel`) and Firefox
    // (`sidebarAction`) use entirely different APIs, so branch per build.
    if (import.meta.env.BROWSER === 'firefox') {
      // Make the generic toolbar icon toggle the sidebar (Firefox also shows a
      // native sidebar button from the `sidebar_action` manifest key).
      browser.action?.onClicked.addListener(() => {
        void sidebarAction()?.toggle();
      });
    } else {
      // Chrome: clicking the toolbar action icon opens the side panel.
      const sp = sidePanel();
      if (sp) void sp.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    }

    // Keyboard commands. `open-panel` must call the open API SYNCHRONOUSLY
    // inside the gesture (no await before it) or the user-gesture token is lost.
    browser.commands.onCommand.addListener((command, tab) => {
      if (command === 'open-panel') {
        if (import.meta.env.BROWSER === 'firefox') {
          void sidebarAction()?.toggle();
        } else if (tab?.windowId !== undefined) {
          void sidePanel()?.open({ windowId: tab.windowId });
        }
        return;
      }
      void forwardTabCommand(command);
    });

    // Best-effort housekeeping of storage beyond the rolling window.
    const prune = async (): Promise<void> => {
      const s = await getSettings().catch(() => null);
      const horizon = now() - (s ? s.maxBufferSec * 1000 : 900_000) - PRUNE_SLACK_MS;
      await pruneScreenshots(horizon).catch(() => {});
      await pruneEvents(horizon).catch(() => {});
    };
    void prune();
    setInterval(() => void prune(), PRUNE_INTERVAL_MS);
  },
});

async function activeTab(): Promise<{ id?: number; windowId?: number } | undefined> {
  const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0];
}

/** Forward a keyboard command to the active tab's content script (async OK —
 * these do not need a user-gesture token like sidePanel.open does). */
async function forwardTabCommand(command: string): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    if (command === 'checkpoint') await sendMessage('addCheckpoint', {}, tab.id);
    else if (command === 'toggle-picker') await sendMessage('setPicker', {}, tab.id);
  } catch {
    // No content script on this page (e.g. chrome:// / about:).
  }
}

// `sidePanel` (Chrome) and `sidebarAction` (Firefox) are not both present in
// WXT's unified `browser` types, so access them through narrow typed accessors.
interface SidePanelApi {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  open(options: { windowId?: number; tabId?: number }): Promise<void>;
}
interface SidebarActionApi {
  toggle(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<void>;
}

function sidePanel(): SidePanelApi | undefined {
  return (browser as unknown as { sidePanel?: SidePanelApi }).sidePanel;
}
function sidebarAction(): SidebarActionApi | undefined {
  return (browser as unknown as { sidebarAction?: SidebarActionApi }).sidebarAction;
}
