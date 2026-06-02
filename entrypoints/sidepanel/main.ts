/**
 * Trawler side panel controller.
 *
 * Mark-centric workflow (ADR Decision 4/7):
 *   pick element (optional) + write a note (required) → "Add mark" → appended
 *   to the Marks list (each mark durably retains a snapshot of its page's
 *   timeline, so it is copyable on its own even after eviction/reload).
 *
 * A time window can also be copied independently — by seconds, since a
 * checkpoint, or by NAVIGATION ("this page" / "last N pages").
 *
 * The panel stays open while the user drives the page, so it tracks the active
 * tab and live-refreshes. Re-renders are change-gated so refreshes never clobber
 * the user's in-panel input or selections.
 */
import { browser } from '#imports';
import { sendMessage } from '../../lib/messaging';
import { getSettings } from '../../lib/settings';
import { getScreenshotDataUrl } from '../../lib/background/screenshot-store';
import { clearMarks, deleteMark, listMarks } from '../../lib/background/mark-store';
import { summarizeEvent } from '../../lib/export/serialize-bundle';
import { formatClock, formatDuration, now } from '../../lib/time';
import type {
  CheckpointInfo,
  ExportResult,
  MarkRecord,
  PanelSnapshot,
  Settings,
} from '../../lib/types';

type WindowMode = 'lastN' | 'checkpoint' | 'pages' | 'cue';

const REFRESH_INTERVAL_MS = 1000;
const NOTE_TIMEOUT_MS = 6000;

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in side panel markup`);
  return el as T;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

const els = {
  ready: $<HTMLElement>('ready'),
  unavailable: $<HTMLElement>('unavailable'),
  refresh: $<HTMLButtonElement>('refresh'),
  settings: $<HTMLButtonElement>('settings'),
  pageUrl: $<HTMLElement>('page-url'),
  eventCount: $<HTMLElement>('event-count'),
  span: $<HTMLElement>('span'),
  note: $<HTMLTextAreaElement>('note'),
  pick: $<HTMLButtonElement>('pick'),
  pending: $<HTMLElement>('pending'),
  pendingTag: $<HTMLElement>('pending-tag'),
  clearPick: $<HTMLButtonElement>('clear-pick'),
  addMark: $<HTMLButtonElement>('add-mark'),
  marksCount: $<HTMLElement>('marks-count'),
  marksEmpty: $<HTMLElement>('marks-empty'),
  marksList: $<HTMLUListElement>('marks-list'),
  lastN: $<HTMLInputElement>('last-n'),
  checkpointSelect: $<HTMLSelectElement>('checkpoint-select'),
  pagesN: $<HTMLInputElement>('pages-n'),
  pagesHint: $<HTMLElement>('pages-hint'),
  checkpointLabel: $<HTMLInputElement>('checkpoint-label'),
  checkpoint: $<HTMLButtonElement>('checkpoint'),
  copyWindow: $<HTMLButtonElement>('copy-window'),
  clearTimeline: $<HTMLButtonElement>('clear-timeline'),
  copyAll: $<HTMLButtonElement>('copy-all'),
  clearMarksBtn: $<HTMLButtonElement>('clear-marks'),
  cueLabel: $<HTMLElement>('cue-label'),
  status: $<HTMLElement>('status'),
};

interface PanelState {
  tabId: number | null;
  windowId: number | null;
  settings: Settings;
  snapshot: PanelSnapshot | null;
  marks: MarkRecord[];
  mode: WindowMode;
  /** Mark ids currently expanded in the list (preserved across re-renders). */
  expanded: Set<string>;
}

const state: PanelState = {
  tabId: null,
  windowId: null,
  settings: null as unknown as Settings,
  snapshot: null,
  marks: [],
  mode: 'lastN',
  expanded: new Set(),
};

let lastMarksKey = '';
let lastCheckpointKey = '';
let lastPendingKey = '';
let lastPickerActive: boolean | null = null;

// ── Clipboard ────────────────────────────────────────────────────────────────

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

// ── Feedback ───────────────────────────────────────────────────────────────────

let noteTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  els.status.textContent = message;
  els.status.dataset.kind = kind;
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    els.status.textContent = '';
    delete els.status.dataset.kind;
  }, NOTE_TIMEOUT_MS);
}

// ── Rendering (change-gated) ──────────────────────────────────────────────────

function render(snap: PanelSnapshot, marks: MarkRecord[]): void {
  els.pageUrl.textContent = snap.pageUrl || '(unknown page)';
  els.pageUrl.title = snap.pageUrl || '';
  els.eventCount.textContent = `${snap.eventCount} event${snap.eventCount === 1 ? '' : 's'}`;
  els.span.textContent = formatSpan(snap);
  els.pagesHint.textContent = snap.navigations.length
    ? `(${snap.navigations.length} navigations buffered)`
    : '(no navigation recorded yet)';
  els.cueLabel.textContent =
    snap.cueTs != null ? `Since cleared (${formatClock(snap.cueTs)})` : 'Since cleared point';

  if (snap.pickerActive !== lastPickerActive) {
    updatePickLabel(snap.pickerActive);
    lastPickerActive = snap.pickerActive;
  }

  const pendingKey = snap.pendingPick ? snap.pendingPick.startTag : '';
  if (pendingKey !== lastPendingKey) {
    renderPending(snap);
    lastPendingKey = pendingKey;
  }

  const cpKey = snap.checkpoints.map((c) => c.id).join(',');
  if (cpKey !== lastCheckpointKey) {
    renderCheckpoints(snap.checkpoints);
    lastCheckpointKey = cpKey;
  }

  const marksKey = marks.map((m) => `${m.id}:${m.screenshotId ?? ''}`).join(',');
  if (marksKey !== lastMarksKey) {
    renderMarks(marks);
    lastMarksKey = marksKey;
  }
}

function formatSpan(snap: PanelSnapshot): string {
  if (!snap.eventCount || !snap.firstTs || !snap.lastTs) return 'empty buffer';
  return `${formatClock(snap.firstTs)} – ${formatClock(snap.lastTs)} (${formatDuration(
    snap.lastTs - snap.firstTs,
  )})`;
}

function updatePickLabel(active: boolean): void {
  els.pick.textContent = active ? 'Picking… (stop)' : 'Pick element';
  els.pick.setAttribute('aria-pressed', String(active));
  els.pick.classList.toggle('active', active);
}

function renderPending(snap: PanelSnapshot): void {
  if (snap.pendingPick) {
    els.pending.hidden = false;
    els.pendingTag.textContent = snap.pendingPick.startTag;
    els.pendingTag.title = snap.pendingPick.elidedOuterHtml;
  } else {
    els.pending.hidden = true;
    els.pendingTag.textContent = '';
  }
}

function renderCheckpoints(checkpoints: CheckpointInfo[]): void {
  const select = els.checkpointSelect;
  const prev = select.value;
  select.replaceChildren();
  if (checkpoints.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No checkpoints yet';
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = state.mode !== 'checkpoint';
  for (const cp of [...checkpoints].reverse()) {
    const opt = document.createElement('option');
    opt.value = cp.id;
    opt.dataset.ts = String(cp.ts);
    opt.textContent = cp.label ? `${formatClock(cp.ts)} — ${cp.label}` : formatClock(cp.ts);
    select.appendChild(opt);
  }
  if (prev && checkpoints.some((c) => c.id === prev)) select.value = prev;
}

function renderMarks(marks: MarkRecord[]): void {
  els.marksCount.textContent = `(${marks.length})`;
  els.marksList.replaceChildren();
  els.marksEmpty.hidden = marks.length > 0;
  // listMarks already returns newest first.
  for (const mark of marks) els.marksList.appendChild(buildMarkItem(mark));
}

function buildMarkItem(mark: MarkRecord): HTMLElement {
  const li = document.createElement('li');
  li.className = 'mark';

  const row = document.createElement('div');
  row.className = 'mark-row';

  const expanded = state.expanded.has(mark.id);

  const toggle = document.createElement('button');
  toggle.className = 'mark-toggle';
  toggle.type = 'button';
  toggle.textContent = expanded ? '▾' : '▸';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.title = 'Show / hide this mark’s captured timeline';
  row.appendChild(toggle);

  const main = document.createElement('div');
  main.className = 'mark-main';
  const noteEl = document.createElement('div');
  noteEl.className = 'mark-note';
  noteEl.textContent = mark.note;
  main.appendChild(noteEl);
  const meta = document.createElement('div');
  meta.className = 'mark-meta';
  meta.textContent = `${formatClock(mark.ts)} · ${mark.events.length} events`;
  if (mark.element) {
    const code = document.createElement('code');
    code.textContent = mark.element.startTag;
    code.title = mark.element.elidedOuterHtml;
    meta.append(' · ', code);
  }
  main.appendChild(meta);
  row.appendChild(main);

  if (mark.screenshotId) {
    const img = document.createElement('img');
    img.className = 'mark-thumb';
    img.alt = 'screenshot';
    img.loading = 'lazy';
    void loadThumb(img, mark.screenshotId);
    row.appendChild(img);
  }

  const copy = document.createElement('button');
  copy.className = 'link mark-copy';
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.title = 'Copy this mark with its retained timeline';
  copy.addEventListener('click', () => void emitExport(sendMessage('exportMark', { markId: mark.id })));
  row.appendChild(copy);

  const del = document.createElement('button');
  del.className = 'link mark-delete';
  del.type = 'button';
  del.textContent = '✕';
  del.title = 'Delete this mark';
  del.setAttribute('aria-label', 'Delete mark');
  del.addEventListener('click', () => void deleteMarkItem(mark));
  row.appendChild(del);

  li.appendChild(row);

  const detail = buildMarkDetail(mark);
  detail.hidden = !expanded;
  li.appendChild(detail);

  const toggleDetail = (): void => {
    const willExpand = detail.hidden;
    detail.hidden = !willExpand;
    toggle.textContent = willExpand ? '▾' : '▸';
    toggle.setAttribute('aria-expanded', String(willExpand));
    if (willExpand) state.expanded.add(mark.id);
    else state.expanded.delete(mark.id);
  };
  toggle.addEventListener('click', toggleDetail);
  main.addEventListener('click', toggleDetail);

  return li;
}

/** The collapsible detail: the element + the mark's frozen page timeline. */
function buildMarkDetail(mark: MarkRecord): HTMLElement {
  const detail = document.createElement('div');
  detail.className = 'mark-detail';

  if (mark.element) {
    const el = document.createElement('pre');
    el.className = 'mark-el';
    const lines = [
      mark.element.htmlLine
        ? `L${mark.element.htmlLine}: ${mark.element.startTag}`
        : mark.element.startTag,
      `selector: ${mark.element.selector}`,
    ];
    if (mark.element.leafText) lines.push(`text: "${mark.element.leafText}"`);
    el.textContent = lines.join('\n');
    detail.appendChild(el);
  }

  const events = document.createElement('div');
  events.className = 'mark-events';
  if (mark.events.length === 0) {
    events.textContent = '(no events captured for this page)';
  } else {
    for (const ev of mark.events) {
      const rowEl = document.createElement('div');
      rowEl.className = 'mark-event-row';
      rowEl.textContent = `${formatClock(ev.ts)}  ${summarizeEvent(ev)}`;
      events.appendChild(rowEl);
    }
  }
  detail.appendChild(events);

  return detail;
}

async function loadThumb(img: HTMLImageElement, screenshotId: string): Promise<void> {
  try {
    const dataUrl = await getScreenshotDataUrl(screenshotId);
    if (dataUrl) img.src = dataUrl;
    else img.classList.add('missing');
  } catch {
    img.classList.add('missing');
  }
}

function setMode(mode: WindowMode): void {
  state.mode = mode;
  for (const value of ['lastN', 'checkpoint', 'pages'] as const) {
    const radio = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${value}"]`);
    if (radio) radio.checked = mode === value;
  }
  const cueRadio = document.querySelector<HTMLInputElement>('input[name="mode"][value="cue"]');
  if (cueRadio) cueRadio.checked = mode === 'cue';
  els.lastN.disabled = mode !== 'lastN';
  els.pagesN.disabled = mode !== 'pages';
  const hasCheckpoints = (state.snapshot?.checkpoints.length ?? 0) > 0;
  els.checkpointSelect.disabled = mode !== 'checkpoint' || !hasCheckpoints;
}

// ── Active-tab tracking + live refresh ─────────────────────────────────────────

async function syncActiveTab(): Promise<boolean> {
  try {
    const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs[0];
    if (!tab || tab.id == null) {
      state.tabId = null;
      return false;
    }
    state.tabId = tab.id;
    state.windowId = tab.windowId ?? null;
    return true;
  } catch {
    state.tabId = null;
    return false;
  }
}

async function refresh(): Promise<void> {
  if (!(await syncActiveTab()) || state.tabId == null) {
    showUnavailable();
    return;
  }
  try {
    const snap = await sendMessage('getTimelineSummary', undefined, state.tabId);
    state.snapshot = snap;
    state.marks = await listMarks(state.tabId).catch(() => []);
    showReady();
    render(snap, state.marks);
    setMode(state.mode);
  } catch {
    showUnavailable();
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function onTogglePick(): Promise<void> {
  if (!(await syncActiveTab()) || state.tabId == null) {
    showStatus('No active tab', 'error');
    return;
  }
  els.pick.disabled = true;
  try {
    const res = await sendMessage('setPicker', {}, state.tabId);
    updatePickLabel(res.active);
    lastPickerActive = res.active;
    if (res.active) showStatus('Click an element on the page to pick it', 'info');
  } catch (error) {
    showStatus(`Could not toggle picker: ${errMessage(error)}`, 'error');
  } finally {
    els.pick.disabled = false;
  }
}

async function onClearPick(): Promise<void> {
  if (!(await syncActiveTab()) || state.tabId == null) return;
  try {
    await sendMessage('clearPick', undefined, state.tabId);
    els.pending.hidden = true;
    lastPendingKey = '';
    await refresh();
  } catch {
    /* ignore */
  }
}

async function onAddMark(): Promise<void> {
  const note = els.note.value.trim();
  if (!note) {
    showStatus('Write a note first', 'error');
    return;
  }
  if (!(await syncActiveTab()) || state.tabId == null) {
    showStatus('No active tab', 'error');
    return;
  }
  const win = resolveWindow();
  if ('error' in win) {
    showStatus(win.error, 'error');
    return;
  }
  els.addMark.disabled = true;
  try {
    // The mark retains the selected window [startTs, now] frozen.
    await sendMessage('addMark', { note, startTs: win.startTs }, state.tabId);
    els.note.value = '';
    showStatus(`Mark added (${win.label})`, 'ok');
    await refresh();
  } catch (error) {
    showStatus(`Could not add mark: ${errMessage(error)}`, 'error');
  } finally {
    syncAddMarkEnabled();
  }
}

async function onCheckpoint(): Promise<void> {
  if (!(await syncActiveTab()) || state.tabId == null) {
    showStatus('No active tab', 'error');
    return;
  }
  const label = els.checkpointLabel.value.trim() || undefined;
  els.checkpoint.disabled = true;
  try {
    await sendMessage('addCheckpoint', { label }, state.tabId);
    els.checkpointLabel.value = '';
    showStatus('Checkpoint added', 'ok');
    await refresh();
  } catch (error) {
    showStatus(`Could not add checkpoint: ${errMessage(error)}`, 'error');
  } finally {
    els.checkpoint.disabled = false;
  }
}

/**
 * Resolve the extraction window START from the current mode. Used by BOTH the
 * window copy AND mark creation — so the time-window setting drives what a mark
 * captures, exactly as the user expects.
 */
function resolveWindow(): { startTs: number; label: string } | { error: string } {
  const snap = state.snapshot;
  if (state.mode === 'lastN') {
    const seconds = Number(els.lastN.value);
    if (!Number.isFinite(seconds) || seconds <= 0) return { error: 'Enter a positive number of seconds' };
    return { startTs: now() - seconds * 1000, label: `last ${seconds}s` };
  }
  if (state.mode === 'pages') {
    const navs = snap?.navigations ?? [];
    if (navs.length === 0) {
      return {
        startTs: now() - (state.settings?.windowDefaultSec ?? 300) * 1000,
        label: 'this page',
      };
    }
    const n = Math.max(1, Math.floor(Number(els.pagesN.value) || 1));
    const idx = Math.max(0, navs.length - n);
    const pagesBack = navs.length - idx;
    return { startTs: navs[idx].ts, label: pagesBack === 1 ? 'this page' : `last ${pagesBack} pages` };
  }
  if (state.mode === 'cue') {
    if (snap?.cueTs == null) return { error: 'No cue yet — click “Clear timeline” first' };
    return { startTs: snap.cueTs, label: `since cleared ${formatClock(snap.cueTs)}` };
  }
  const selected = els.checkpointSelect.selectedOptions[0];
  const cpTs = selected ? Number(selected.dataset.ts) : NaN;
  if (!selected || !selected.value || !Number.isFinite(cpTs)) {
    return { error: 'Select a checkpoint first' };
  }
  return { startTs: cpTs, label: `since checkpoint (${selected.textContent ?? ''})` };
}

function onCopyWindow(): void {
  const win = resolveWindow();
  if ('error' in win) {
    showStatus(win.error, 'error');
    return;
  }
  void emitExport(
    sendMessage('exportContext', {
      window: { startTs: win.startTs, endTs: now(), label: win.label },
    }),
  );
}

function onCopyAllMarks(): void {
  void emitExport(sendMessage('exportMarks'));
}

async function onClearTimeline(): Promise<void> {
  if (!(await syncActiveTab()) || state.tabId == null) {
    showStatus('No active tab', 'error');
    return;
  }
  try {
    await sendMessage('clearTimeline', undefined, state.tabId);
    setMode('cue');
    showStatus('Cue set — marks & window now extract from here', 'ok');
    await refresh();
  } catch (error) {
    showStatus(`Could not set cue: ${errMessage(error)}`, 'error');
  }
}

async function onClearMarks(): Promise<void> {
  if (state.marks.length === 0) {
    showStatus('No marks to clear', 'info');
    return;
  }
  if (!window.confirm(`Delete all ${state.marks.length} marks in this list?`)) return;
  if (!(await syncActiveTab()) || state.tabId == null) return;
  try {
    await clearMarks(state.tabId);
    state.expanded.clear();
    showStatus('Marks cleared', 'ok');
    await refresh();
  } catch (error) {
    showStatus(`Could not clear marks: ${errMessage(error)}`, 'error');
  }
}

/** Await an export, write it to the clipboard, and report the outcome. */
async function emitExport(promise: Promise<ExportResult>): Promise<void> {
  showStatus('Building context…', 'info');
  try {
    const res = await promise;
    if (!res.ok || !res.text) {
      showStatus(res.error ?? 'Export failed', 'error');
      return;
    }
    const copied = await copyText(res.text);
    const shots = res.screenshotCount ?? 0;
    const subdir = state.settings?.downloadSubdir ?? 'trawler';
    const shotNote =
      shots > 0 ? ` — ${shots} screenshot${shots === 1 ? '' : 's'} saved to Downloads/${subdir}` : '';
    showStatus(
      copied
        ? `Copied${shotNote}`
        : `Built context, but clipboard write failed${shotNote}. Try again with the panel focused.`,
      copied ? 'ok' : 'error',
    );
  } catch (error) {
    showStatus(`Export failed: ${errMessage(error)}`, 'error');
  }
}

async function deleteMarkItem(mark: MarkRecord): Promise<void> {
  if (!window.confirm(`Delete mark “${mark.note}”? This removes its retained timeline.`)) return;
  try {
    await deleteMark(mark.id);
    state.expanded.delete(mark.id);
    showStatus('Mark deleted', 'ok');
    await refresh();
  } catch (error) {
    showStatus(`Could not delete mark: ${errMessage(error)}`, 'error');
  }
}

async function openSettings(): Promise<void> {
  try {
    await browser.runtime.openOptionsPage();
  } catch (error) {
    showStatus(`Could not open settings: ${errMessage(error)}`, 'error');
  }
}

function syncAddMarkEnabled(): void {
  els.addMark.disabled = els.note.value.trim().length === 0;
}

// ── View toggles ─────────────────────────────────────────────────────────────

function showReady(): void {
  els.ready.hidden = false;
  els.unavailable.hidden = true;
}

function showUnavailable(): void {
  els.ready.hidden = true;
  els.unavailable.hidden = false;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function wireEvents(): void {
  els.refresh.addEventListener('click', () => void refresh());
  els.settings.addEventListener('click', () => void openSettings());
  els.pick.addEventListener('click', () => void onTogglePick());
  els.clearPick.addEventListener('click', () => void onClearPick());
  els.addMark.addEventListener('click', () => void onAddMark());
  els.checkpoint.addEventListener('click', () => void onCheckpoint());
  els.copyWindow.addEventListener('click', () => onCopyWindow());
  els.clearTimeline.addEventListener('click', () => void onClearTimeline());
  els.copyAll.addEventListener('click', () => onCopyAllMarks());
  els.clearMarksBtn.addEventListener('click', () => void onClearMarks());

  els.note.addEventListener('input', syncAddMarkEnabled);
  els.note.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      void onAddMark();
    }
  });

  els.lastN.addEventListener('focus', () => setMode('lastN'));
  els.checkpointSelect.addEventListener('focus', () => setMode('checkpoint'));
  els.pagesN.addEventListener('focus', () => setMode('pages'));
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) setMode(radio.value as WindowMode);
    });
  });
}

function startLiveSync(): void {
  setInterval(() => {
    if (document.visibilityState === 'visible') void refresh();
  }, REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh();
  });
  browser.tabs.onActivated.addListener(() => void refresh());
  browser.tabs.onUpdated.addListener(() => void refresh());
  if (browser.windows?.onFocusChanged) {
    browser.windows.onFocusChanged.addListener(() => void refresh());
  }
}

async function init(): Promise<void> {
  wireEvents();
  try {
    state.settings = await getSettings();
  } catch {
    state.settings = { windowDefaultSec: 300, downloadSubdir: 'trawler' } as Settings;
  }
  els.lastN.value = String(state.settings.windowDefaultSec ?? 300);
  syncAddMarkEnabled();
  await refresh();
  startLiveSync();
}

void init();
