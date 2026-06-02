/** Builds the single fact-only clipboard text bundle (ADR Decision 7).
 *
 * Pure function over an {@link ExportInput}; no browser context. The extension
 * holds no LLM — this only packages observed facts. Inference is left to the
 * consumer (Claude Code).
 */
import type { ElementHint, ExportInput, MarkEvent, PerfEvent, TimelineEvent } from '../types';
import { formatClock, formatDuration, formatOffset } from '../time';

const PRIMING =
  'これはブラウザ検証から出たバグ報告です。再現・診断・修正してください。' +
  '以下の記録はブラウザ上で観測された事実のみで、原因はまだ推論されていません（あなたが推論してください）。' +
  'スクリーンショットは別ファイルに保存され、本文にはパスのみ記載しています。';

const BODY_ONE_LINE_MAX = 1000;
const STACK_LINES_MAX = 6;

export function serializeBundle(input: ExportInput): string {
  const { window: win, events, screenshotPaths } = input;
  const origin = win.startTs;
  const lines: string[] = [];

  lines.push(PRIMING, '');
  lines.push('== Trawler verification capture ==');
  lines.push(`Page:      ${input.pageUrl}`);
  lines.push(
    `Window:    ${win.label ? `${win.label} ` : ''}(${formatClock(win.startTs)} → ${formatClock(
      win.endTs,
    )}, ${formatDuration(win.endTs - win.startTs)})`,
  );
  lines.push(`Generated: ${input.generatedAtIso}`);
  lines.push(`Events:    ${events.length}`, '');

  lines.push(...formatPerfSummary(events));

  lines.push('--- Memo ---');
  lines.push(input.memo && input.memo.trim() ? input.memo.trim() : '(none)');
  lines.push('');

  lines.push(`--- Marks (${input.marks.length}) ---`);
  if (input.marks.length === 0) lines.push('(none)');
  input.marks.forEach((m, i) => lines.push(...formatMark(m, i + 1, screenshotPaths)));
  lines.push('');

  lines.push('--- Timeline ---');
  if (events.length === 0) lines.push('(no events in window)');
  for (const e of events) lines.push(...formatEvent(e, origin, screenshotPaths));
  lines.push('');

  const shots = collectScreenshots(input);
  lines.push(`--- Screenshots (${shots.length}) ---`);
  if (shots.length === 0) lines.push('(none)');
  for (const s of shots) lines.push(`${formatClock(s.ts)}  ${s.label.padEnd(13)}  ${s.path}`);

  return `${lines.join('\n')}\n`;
}

function formatMark(m: MarkEvent, n: number, paths: Record<string, string>): string[] {
  const out: string[] = [];
  out.push(`${n}. [${formatClock(m.ts)}] ${m.note}`);
  const el = m.element;
  if (el) {
    out.push(`     element:   ${el.htmlLine ? `L${el.htmlLine}: ` : ''}${el.startTag}`);
    if (el.leafText) out.push(`     text:      "${el.leafText}"`);
    out.push(`     selector:  ${el.selector}`);
    const data = Object.entries(el.dataAttrs);
    if (data.length) out.push(`     data-*:    ${data.map(([k, v]) => `${k}="${v}"`).join(' ')}`);
    const aria = Object.entries(el.ariaAttrs);
    if (aria.length) out.push(`     aria/role: ${aria.map(([k, v]) => `${k}="${v}"`).join(' ')}`);
    if (el.htmlLineContent && el.htmlLineContent !== el.startTag) {
      out.push(`     html line: ${el.htmlLineContent}`);
    }
  }
  if (m.screenshotId && paths[m.screenshotId]) {
    out.push(`     screenshot:${paths[m.screenshotId]}`);
  }
  return out;
}

function head(e: TimelineEvent, origin: number): string {
  return `[${formatOffset(e.ts, origin)} ${formatClock(e.ts)}]`;
}

function oneLine(s: string): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  return collapsed.length > BODY_ONE_LINE_MAX
    ? `${collapsed.slice(0, BODY_ONE_LINE_MAX)}… [+${collapsed.length - BODY_ONE_LINE_MAX} chars]`
    : collapsed;
}

function indentStack(stack: string): string[] {
  return stack
    .split('\n')
    .slice(0, STACK_LINES_MAX)
    .map((l) => `     ${l.trim()}`);
}

function describeHint(t: ElementHint): string {
  let s = t.tag;
  if (t.id) s += `#${t.id}`;
  if (t.classes?.length) s += `.${t.classes.slice(0, 2).join('.')}`;
  if (t.text) s += ` "${t.text}"`;
  return s;
}

/**
 * Single-line content summary of an event (no timestamp / no detail lines).
 * Shared by the bundle timeline and the side panel's expandable mark detail.
 */
export function summarizeEvent(e: TimelineEvent): string {
  switch (e.kind) {
    case 'network': {
      const status =
        e.status !== undefined ? `→ ${e.status}` : e.error ? `→ ERROR ${e.error}` : '→ (pending)';
      const dur = e.durationMs !== undefined ? ` (${Math.round(e.durationMs)}ms)` : '';
      return `NETWORK ${e.method} ${e.url} ${status}${dur}`;
    }
    case 'console':
      return `CONSOLE.${e.level} ${e.args.join(' ')}`;
    case 'error':
      return `ERROR ${e.message}${e.source ? ` (${e.source}:${e.line ?? '?'}:${e.col ?? '?'})` : ''}`;
    case 'unhandledrejection':
      return `UNHANDLED REJECTION ${e.reason}`;
    case 'websocket':
    case 'eventsource': {
      const label = e.kind === 'websocket' ? 'WS' : 'SSE';
      const extra = e.data ? ` ${oneLine(e.data)}` : e.code !== undefined ? ` code=${e.code}` : '';
      return `${label} ${e.direction} ${e.url}${extra}`;
    }
    case 'interaction': {
      const val = e.value !== undefined ? ` value=${JSON.stringify(e.value)}` : '';
      const key = e.key ? ` key=${e.key}` : '';
      return `${e.action.toUpperCase()} ${describeHint(e.target)}${val}${key}`;
    }
    case 'navigation':
      return `NAV ${e.type} ${e.url}${e.fromUrl ? ` (from ${e.fromUrl})` : ''}`;
    case 'mutation': {
      const s = e.summary;
      const parts = `+${s.added} -${s.removed} attr:${s.attributes} text:${s.characterData}`;
      const tags = s.sampleAddedTags?.length ? ` added:[${s.sampleAddedTags.join(',')}]` : '';
      return `DOM mutation (${parts})${tags}`;
    }
    case 'checkpoint':
      return `◉ CHECKPOINT${e.label ? ` "${e.label}"` : ''}`;
    case 'mark':
      return `✎ MARK "${e.note}"${e.element ? ` — ${e.element.startTag}` : ''}`;
    case 'perf':
      return `PERF ${perfLine(e)}`;
  }
}

function formatEvent(e: TimelineEvent, origin: number, paths: Record<string, string>): string[] {
  const out: string[] = [`${head(e, origin)} ${summarizeEvent(e)}`];
  if (e.kind === 'network') {
    if (e.requestBody) out.push(`     request:  ${oneLine(e.requestBody)}`);
    if (e.responseBody) out.push(`     response: ${oneLine(e.responseBody)}`);
  } else if (e.kind === 'console') {
    if (e.stackTop) out.push(`     at ${e.stackTop}`);
  } else if (e.kind === 'error' || e.kind === 'unhandledrejection') {
    if (e.stack) out.push(...indentStack(e.stack));
  }
  if (e.screenshotId && paths[e.screenshotId]) {
    out.push(`     ↳ screenshot: ${paths[e.screenshotId]}`);
  }
  return out;
}

interface ShotRow {
  ts: number;
  label: string;
  path: string;
}

function collectScreenshots(input: ExportInput): ShotRow[] {
  const seen = new Set<string>();
  const rows: ShotRow[] = [];
  for (const e of input.events) {
    if (!e.screenshotId || seen.has(e.screenshotId)) continue;
    const path = input.screenshotPaths[e.screenshotId];
    if (!path) continue;
    seen.add(e.screenshotId);
    rows.push({ ts: e.ts, label: e.kind, path });
  }
  return rows.sort((a, b) => a.ts - b.ts);
}

/** One-line rendering of a perf event for the timeline. */
function perfLine(e: PerfEvent): string {
  switch (e.metric) {
    case 'navigation':
      return `navigation ${e.detail ?? `ttfb=${e.ttfbMs ?? '?'}ms`}`;
    case 'resource': {
      const ttfb = e.ttfbMs !== undefined ? ` TTFB ${e.ttfbMs}ms` : '';
      const size = e.transferSize ? `, ${e.transferSize}B` : '';
      const dur = e.durationMs !== undefined ? ` (dur ${e.durationMs}ms${size})` : '';
      return `resource ${e.initiatorType ?? ''} ${e.url ?? ''}${ttfb}${dur}`.replace(/\s+/g, ' ');
    }
    case 'longtask':
      return `long task ${e.durationMs ?? 0}ms`;
    case 'lcp':
      return `LCP ${e.value ?? 0}ms`;
    case 'cls':
      return `CLS ${e.value ?? 0}`;
    case 'paint':
      return `${e.detail ?? 'paint'} ${e.value ?? 0}ms`;
  }
}

/**
 * Performance summary: surfaces the server-vs-client signal up top. A large
 * navigation/resource TTFB points at the SERVER (e.g. an N+1 query); time spent
 * after responseEnd with long tasks points at the CLIENT.
 */
function formatPerfSummary(events: TimelineEvent[]): string[] {
  const perf = events.filter((e): e is PerfEvent => e.kind === 'perf');
  if (perf.length === 0) return [];

  const out: string[] = ['--- Performance ---'];

  for (const n of perf.filter((p) => p.metric === 'navigation')) {
    out.push(`Navigation: ${n.detail ?? `ttfb=${n.ttfbMs ?? '?'}ms`}`);
  }

  const resources = perf
    .filter((p) => p.metric === 'resource')
    .sort((a, b) => (b.ttfbMs ?? -1) - (a.ttfbMs ?? -1))
    .slice(0, 5);
  if (resources.length > 0) {
    out.push('Slowest requests by server time (TTFB):');
    resources.forEach((r, i) => {
      const ttfb = r.ttfbMs !== undefined ? `${r.ttfbMs}ms` : 'n/a';
      const dur = r.durationMs !== undefined ? `${r.durationMs}ms` : '?';
      out.push(`  ${i + 1}. ${(r.initiatorType ?? '').padEnd(8)} ${r.url ?? ''}  TTFB ${ttfb} (dur ${dur})`);
    });
  }

  const longtasks = perf.filter((p) => p.metric === 'longtask');
  if (longtasks.length > 0) {
    const total = longtasks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
    out.push(`Long tasks: ${longtasks.length} (total ${total}ms blocking the main thread)`);
  }

  const lcp = perf.filter((p) => p.metric === 'lcp').reduce((m, p) => Math.max(m, p.value ?? 0), 0);
  if (lcp > 0) out.push(`LCP: ${lcp}ms`);
  const cls = perf.filter((p) => p.metric === 'cls').reduce((m, p) => Math.max(m, p.value ?? 0), 0);
  if (cls > 0) out.push(`CLS: ${cls}`);

  out.push('');
  return out;
}
