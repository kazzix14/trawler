/**
 * Trawler shared domain types.
 *
 * This module has NO runtime imports — it is the contract every other module
 * (MAIN-world hooks, ISOLATED content collectors, background, popup) codes
 * against. Keep it dependency-free.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Timeline events
// ─────────────────────────────────────────────────────────────────────────────

export type EventKind =
  | 'console'
  | 'network'
  | 'error'
  | 'unhandledrejection'
  | 'websocket'
  | 'eventsource'
  | 'interaction'
  | 'navigation'
  | 'mutation'
  | 'checkpoint'
  | 'mark'
  | 'perf';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface BaseEvent {
  /** Unique per event. */
  id: string;
  kind: EventKind;
  /** Epoch milliseconds (Date.now()). */
  ts: number;
  /** Set once a screenshot has been captured and stored for this event. */
  screenshotId?: string;
}

export interface ConsoleEvent extends BaseEvent {
  kind: 'console';
  level: ConsoleLevel;
  /** Stringified arguments. */
  args: string[];
  /** Top stack frame "file:line:col" — used for screenshot dedup of errors. */
  stackTop?: string;
}

export interface NetworkEvent extends BaseEvent {
  kind: 'network';
  via: 'fetch' | 'xhr';
  method: string;
  url: string;
  /** Undefined when the request failed before a response arrived. */
  status?: number;
  ok?: boolean;
  requestBody?: string;
  responseBody?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  durationMs?: number;
  /** Network-level failure message (DNS, CORS, abort, …). */
  error?: string;
}

export interface PageErrorEvent extends BaseEvent {
  kind: 'error';
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
}

export interface UnhandledRejectionEvent extends BaseEvent {
  kind: 'unhandledrejection';
  reason: string;
  stack?: string;
}

export interface SocketEvent extends BaseEvent {
  kind: 'websocket' | 'eventsource';
  url: string;
  direction: 'open' | 'send' | 'message' | 'close' | 'error';
  data?: string;
  /** Close code for 'close'. */
  code?: number;
}

export type InteractionAction =
  | 'click'
  | 'input'
  | 'change'
  | 'scroll'
  | 'focus'
  | 'keydown'
  | 'submit';

export interface InteractionEvent extends BaseEvent {
  kind: 'interaction';
  action: InteractionAction;
  target: ElementHint;
  /** Masked when the field is sensitive (see Settings.maskInputs). */
  value?: string;
  /** For keydown — normalized key combo, e.g. "Ctrl+Enter". */
  key?: string;
  scrollX?: number;
  scrollY?: number;
}

export type NavigationType =
  | 'load'
  | 'domcontentloaded'
  | 'pushState'
  | 'replaceState'
  | 'popstate'
  | 'hashchange';

export interface NavigationEvent extends BaseEvent {
  kind: 'navigation';
  type: NavigationType;
  url: string;
  fromUrl?: string;
}

export interface MutationSummary {
  added: number;
  removed: number;
  attributes: number;
  characterData: number;
  sampleAddedTags?: string[];
  sampleTargets?: string[];
}

export interface MutationEvent extends BaseEvent {
  kind: 'mutation';
  summary: MutationSummary;
}

export interface CheckpointEvent extends BaseEvent {
  kind: 'checkpoint';
  label?: string;
}

export interface MarkEvent extends BaseEvent {
  kind: 'mark';
  /** Required user note describing the observation (ADR Decision 4/7). */
  note: string;
  /** Element picked before marking — optional (a mark can be note-only). */
  element?: MarkedElement;
}

/** Performance metrics captured via PerformanceObserver (server vs client signal). */
export type PerfMetric = 'navigation' | 'resource' | 'longtask' | 'lcp' | 'cls' | 'paint';

export interface PerfEvent extends BaseEvent {
  kind: 'perf';
  metric: PerfMetric;
  url?: string;
  initiatorType?: string;
  /** Server think time = responseStart − requestStart. Big TTFB ⇒ server slow. */
  ttfbMs?: number;
  durationMs?: number;
  transferSize?: number;
  /** Scalar value for lcp (ms) / cls (score) / paint (ms). */
  value?: number;
  detail?: string;
}

export type TimelineEvent =
  | ConsoleEvent
  | NetworkEvent
  | PageErrorEvent
  | UnhandledRejectionEvent
  | SocketEvent
  | InteractionEvent
  | NavigationEvent
  | MutationEvent
  | CheckpointEvent
  | MarkEvent
  | PerfEvent;

// ─────────────────────────────────────────────────────────────────────────────
// Element descriptors (ADR Decision 4)
// ─────────────────────────────────────────────────────────────────────────────

/** Brief descriptor attached to interaction events. */
export interface ElementHint {
  tag: string;
  id?: string;
  classes?: string[];
  selector?: string;
  /** Short direct (leaf) text. */
  text?: string;
  /** Subset of data-* / aria-* / role attributes. */
  attrs?: Record<string, string>;
}

/** Rich descriptor produced by the element picker (grep ammunition). */
export interface MarkedElement {
  /** Opening tag with ALL attributes, children elided. e.g. `<button data-action="cart#add">`. */
  startTag: string;
  /** start tag + `...` + leaf text, per ADR Decision 4. */
  elidedOuterHtml: string;
  selector: string;
  id?: string;
  classes: string[];
  dataAttrs: Record<string, string>;
  ariaAttrs: Record<string, string>;
  /** Short direct text of the element (kept — strongest grep hint). */
  leafText?: string;
  /** 1-based line number of the start tag within the serialized DOM. */
  htmlLine?: number;
  /** The start tag exactly as found on that line. */
  htmlLineContent?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Screenshots
// ─────────────────────────────────────────────────────────────────────────────

export type ScreenshotReason =
  | 'checkpoint'
  | 'mark'
  | 'console-error'
  | 'page-error'
  | 'network'
  | 'manual';

export interface ScreenshotMeta {
  id: string;
  ts: number;
  tabId?: number;
  reason: ScreenshotReason;
  /** MIME type of the stored data URL. */
  mime: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture rule engine (ADR Decision 6)
// ─────────────────────────────────────────────────────────────────────────────

export type RuleAction = 'capture' | 'ignore';

export interface CaptureRule {
  /** Glob against the host, e.g. "api.myapp.com" or "*.thirdparty.*". */
  domain?: string;
  /** Glob against the path, or "/regex/flags" for a regex. */
  path?: string;
  /** "5xx" | "4xx" | "429" | "400-499" | exact number as string. */
  status?: string;
  action: RuleAction;
}

export interface CaptureRulesConfig {
  /** Evaluated top-down; first match wins. */
  rules: CaptureRule[];
  /** Action when nothing matches. */
  default: RuleAction;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export interface ScreenshotTriggers {
  checkpoint: boolean;
  mark: boolean;
  /** console.error + window.onerror + unhandledrejection. */
  consoleError: boolean;
  /** When a network response matches a `capture` rule. */
  network: boolean;
  manual: boolean;
}

export interface Settings {
  /** Default "last N seconds" window for export. */
  windowDefaultSec: number;
  /** Rolling buffer retention cap (seconds). */
  maxBufferSec: number;
  /** Rolling buffer retention cap (event count). */
  maxBufferEvents: number;
  /** Fixed same-event screenshot suppression window (ms). ADR: 3000. */
  dedupWindowMs: number;
  screenshotTriggers: ScreenshotTriggers;
  screenshotFormat: 'png' | 'jpeg';
  captureRules: CaptureRulesConfig;
  /** Mask values of password/sensitive inputs in the interaction trace. */
  maskInputs: boolean;
  /** Truncate request/response/socket bodies to this many characters. */
  bodyMaxChars: number;
  /** Subdirectory under the Downloads folder for screenshots. */
  downloadSubdir: string;
  /** Capture PerformanceObserver metrics (navigation/resource/longtask/LCP/CLS). */
  capturePerf: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportWindow {
  startTs: number;
  endTs: number;
  /** Human label, e.g. "since checkpoint 'login'" or "last 300s". */
  label?: string;
}

export interface ExportInput {
  window: ExportWindow;
  memo?: string;
  events: TimelineEvent[];
  marks: MarkEvent[];
  /** screenshotId -> saved on-disk path. */
  screenshotPaths: Record<string, string>;
  pageUrl: string;
  generatedAtIso: string;
}

export interface ExportResult {
  ok: boolean;
  text?: string;
  error?: string;
  screenshotCount?: number;
}

/**
 * A durably-retained mark: the note + optional element + screenshot AND a frozen
 * snapshot of the timeline for the mark's page window [navStartTs, ts]. Stored in
 * the extension-origin IndexedDB so per-mark copy survives buffer eviction,
 * navigations and service-worker restarts (ADR Decision 3/4).
 */
export interface MarkRecord {
  id: string;
  ts: number;
  tabId: number;
  pageUrl: string;
  note: string;
  element?: MarkedElement;
  screenshotId?: string;
  /** Start of the retained window (the mark's page = last navigation ≤ ts). */
  navStartTs: number;
  /** Frozen timeline for [navStartTs, ts], including the mark event itself. */
  events: TimelineEvent[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Popup ↔ content summary
// ─────────────────────────────────────────────────────────────────────────────

export interface ThumbInfo {
  screenshotId: string;
  ts: number;
  reason: ScreenshotReason;
}

export interface CheckpointInfo {
  id: string;
  ts: number;
  label?: string;
}

/** A navigation boundary (a "page") used for nav-based window selection. */
export interface NavInfo {
  ts: number;
  url: string;
  type: NavigationType;
}

export interface TimelineSummary {
  checkpoints: CheckpointInfo[];
  thumbs: ThumbInfo[];
  /** Navigation boundaries in chronological order (oldest first). */
  navigations: NavInfo[];
  firstTs: number;
  lastTs: number;
  pageUrl: string;
  eventCount: number;
}

/** What the side panel polls: the timeline summary plus live picker state. */
export interface PanelSnapshot extends TimelineSummary {
  /** Whether the element picker is currently active on the tab. */
  pickerActive: boolean;
  /** Element picked but not yet attached to a mark (awaiting a note). */
  pendingPick: MarkedElement | null;
}
