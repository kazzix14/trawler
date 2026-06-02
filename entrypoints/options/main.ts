/**
 * Trawler Options page controller.
 *
 * Populates a settings form from stored Settings, validates + persists edits
 * (including the capture-rules JSON), and supports resetting to defaults.
 */
import { DEFAULT_SETTINGS, getSettings, setSettings } from '../../lib/settings';
import type { CaptureRulesConfig, RuleAction, Settings } from '../../lib/types';

/** Strongly-typed lookup so element ids stay honest at the call sites. */
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Options: missing element #${id}`);
  return el as T;
}

const numberFields = [
  'windowDefaultSec',
  'maxBufferSec',
  'maxBufferEvents',
  'dedupWindowMs',
  'bodyMaxChars',
] as const;

type NumberField = (typeof numberFields)[number];

const triggerKeys = ['checkpoint', 'mark', 'consoleError', 'network', 'manual'] as const;

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Writes a stored Settings blob into every form control. */
function populate(s: Settings): void {
  for (const key of numberFields) {
    byId<HTMLInputElement>(key).value = String(s[key as NumberField]);
  }
  byId<HTMLSelectElement>('screenshotFormat').value = s.screenshotFormat;
  byId<HTMLInputElement>('maskInputs').checked = s.maskInputs;
  byId<HTMLInputElement>('downloadSubdir').value = s.downloadSubdir;

  for (const key of triggerKeys) {
    byId<HTMLInputElement>(`trigger-${key}`).checked = s.screenshotTriggers[key];
  }

  byId<HTMLTextAreaElement>('captureRules').value = JSON.stringify(s.captureRules, null, 2);
  clearRuleError();
}

/** Reads a numeric control, falling back to the default when blank/invalid. */
function readNumber(field: NumberField): number {
  const raw = byId<HTMLInputElement>(field).value.trim();
  const parsed = Number(raw);
  if (raw === '' || !Number.isFinite(parsed)) return DEFAULT_SETTINGS[field];
  return parsed;
}

function readTriggers(): Settings['screenshotTriggers'] {
  return {
    checkpoint: byId<HTMLInputElement>('trigger-checkpoint').checked,
    mark: byId<HTMLInputElement>('trigger-mark').checked,
    consoleError: byId<HTMLInputElement>('trigger-consoleError').checked,
    network: byId<HTMLInputElement>('trigger-network').checked,
    manual: byId<HTMLInputElement>('trigger-manual').checked,
  };
}

function isRuleAction(v: unknown): v is RuleAction {
  return v === 'capture' || v === 'ignore';
}

/** Parses + structurally validates the capture-rules JSON. Throws on any problem. */
function parseCaptureRules(raw: string): CaptureRulesConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expected an object with "rules" and "default".');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.rules)) {
    throw new Error('"rules" must be an array.');
  }
  if (!isRuleAction(obj.default)) {
    throw new Error('"default" must be "capture" or "ignore".');
  }
  obj.rules.forEach((rule, i) => validateRule(rule, i));
  return parsed as CaptureRulesConfig;
}

function validateRule(rule: unknown, index: number): void {
  if (typeof rule !== 'object' || rule === null) {
    throw new Error(`rules[${index}] must be an object.`);
  }
  const r = rule as Record<string, unknown>;
  if (!isRuleAction(r.action)) {
    throw new Error(`rules[${index}].action must be "capture" or "ignore".`);
  }
  for (const opt of ['domain', 'path', 'status'] as const) {
    if (r[opt] !== undefined && typeof r[opt] !== 'string') {
      throw new Error(`rules[${index}].${opt} must be a string.`);
    }
  }
}

function showRuleError(message: string): void {
  const el = byId<HTMLParagraphElement>('captureRules-error');
  el.textContent = message;
  el.hidden = false;
  byId<HTMLTextAreaElement>('captureRules').setAttribute('aria-invalid', 'true');
}

function clearRuleError(): void {
  const el = byId<HTMLParagraphElement>('captureRules-error');
  el.textContent = '';
  el.hidden = true;
  byId<HTMLTextAreaElement>('captureRules').removeAttribute('aria-invalid');
}

function showToast(message: string): void {
  const toast = byId<HTMLDivElement>('toast');
  toast.textContent = message;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2400);
}

/** Builds the next Settings object from the form, or null if rules are invalid. */
function collectSettings(): Settings | null {
  let captureRules: CaptureRulesConfig;
  try {
    captureRules = parseCaptureRules(byId<HTMLTextAreaElement>('captureRules').value);
  } catch (error: unknown) {
    showRuleError(error instanceof Error ? error.message : 'Invalid capture rules.');
    return null;
  }
  clearRuleError();

  return {
    windowDefaultSec: readNumber('windowDefaultSec'),
    maxBufferSec: readNumber('maxBufferSec'),
    maxBufferEvents: readNumber('maxBufferEvents'),
    dedupWindowMs: readNumber('dedupWindowMs'),
    bodyMaxChars: readNumber('bodyMaxChars'),
    screenshotFormat: byId<HTMLSelectElement>('screenshotFormat').value === 'jpeg' ? 'jpeg' : 'png',
    screenshotTriggers: readTriggers(),
    captureRules,
    maskInputs: byId<HTMLInputElement>('maskInputs').checked,
    downloadSubdir: byId<HTMLInputElement>('downloadSubdir').value.trim(),
  };
}

async function handleSave(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const next = collectSettings();
  if (!next) return;
  try {
    await setSettings(next);
    showToast('Saved');
  } catch (error: unknown) {
    showToast(`Save failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

async function handleReset(): Promise<void> {
  const ok = window.confirm('Reset all Trawler settings to their defaults?');
  if (!ok) return;
  const defaults = structuredClone(DEFAULT_SETTINGS);
  try {
    await setSettings(defaults);
    populate(defaults);
    showToast('Reset to defaults');
  } catch (error: unknown) {
    showToast(`Reset failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

async function init(): Promise<void> {
  try {
    populate(await getSettings());
  } catch (error: unknown) {
    showToast(`Could not load settings: ${error instanceof Error ? error.message : 'unknown error'}`);
    populate(structuredClone(DEFAULT_SETTINGS));
  }
  byId<HTMLFormElement>('settings-form').addEventListener('submit', handleSave);
  byId<HTMLButtonElement>('reset').addEventListener('click', handleReset);
  byId<HTMLTextAreaElement>('captureRules').addEventListener('input', clearRuleError);
}

void init();
