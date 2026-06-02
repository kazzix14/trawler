/** Settings: defaults + typed storage access (shared by all extension contexts). */
import { storage } from '#imports';
import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  windowDefaultSec: 300,
  maxBufferSec: 900,
  maxBufferEvents: 5000,
  dedupWindowMs: 3000,
  screenshotTriggers: {
    checkpoint: true,
    mark: true,
    consoleError: true,
    network: true,
    manual: true,
  },
  screenshotFormat: 'png',
  captureRules: {
    // Default: capture every 4xx/5xx; ignore everything else. Refine per-app
    // in Options (e.g. ignore /analytics/*, ignore third-party domains).
    rules: [
      { status: '5xx', action: 'capture' },
      { status: '4xx', action: 'capture' },
    ],
    default: 'ignore',
  },
  maskInputs: true,
  bodyMaxChars: 4096,
  downloadSubdir: 'trawler',
};

const ITEM = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
  version: 1,
});

/** Reads settings, merging missing keys onto defaults (forward-compatible). */
export async function getSettings(): Promise<Settings> {
  const stored = await ITEM.getValue();
  return mergeSettings(stored);
}

export async function setSettings(next: Settings): Promise<void> {
  await ITEM.setValue(next);
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return ITEM.watch((value) => cb(mergeSettings(value)));
}

/** Deep-ish merge so newly-added defaults appear for users with older stored blobs. */
export function mergeSettings(stored: Partial<Settings> | null | undefined): Settings {
  const s = stored ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    screenshotTriggers: { ...DEFAULT_SETTINGS.screenshotTriggers, ...s.screenshotTriggers },
    captureRules: {
      rules: s.captureRules?.rules ?? DEFAULT_SETTINGS.captureRules.rules,
      default: s.captureRules?.default ?? DEFAULT_SETTINGS.captureRules.default,
    },
  };
}
