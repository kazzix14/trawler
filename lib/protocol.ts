/**
 * MAIN-world ↔ ISOLATED-world bridge protocol.
 *
 * MAIN-world code (the injected page-context hooks) has NO access to extension
 * APIs, so it relays captured facts to the ISOLATED content script via
 * `window.postMessage`. Both producer and consumer share the envelope and
 * payload shapes defined here.
 */
import type { ConsoleLevel, PerfMetric } from './types';

/** Private tag distinguishing Trawler messages from arbitrary page messages. */
export const TRAWLER_TAG = '__TRAWLER__' as const;

/** MAIN-world bodies are capped here; the content side re-truncates to settings. */
export const PAGE_BODY_MAX = 16384;

export type PageMsgKind =
  | 'console'
  | 'error'
  | 'unhandledrejection'
  | 'network'
  | 'websocket'
  | 'eventsource'
  | 'nav'
  | 'perf';

export interface ConsolePayload {
  level: ConsoleLevel;
  args: string[];
  stackTop?: string;
}

export interface ErrorPayload {
  message: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
}

export interface RejectionPayload {
  reason: string;
  stack?: string;
}

export interface NetworkPayload {
  via: 'fetch' | 'xhr';
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  requestBody?: string;
  responseBody?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  durationMs?: number;
  error?: string;
  startedAt: number;
}

export interface SocketPayload {
  socket: 'websocket' | 'eventsource';
  url: string;
  direction: 'open' | 'send' | 'message' | 'close' | 'error';
  data?: string;
  code?: number;
}

export interface NavPayload {
  method: 'pushState' | 'replaceState' | 'popstate' | 'hashchange';
  url: string;
  fromUrl?: string;
}

export interface PerfPayload {
  metric: PerfMetric;
  url?: string;
  initiatorType?: string;
  ttfbMs?: number;
  durationMs?: number;
  transferSize?: number;
  value?: number;
  detail?: string;
}

export interface PayloadByKind {
  console: ConsolePayload;
  error: ErrorPayload;
  unhandledrejection: RejectionPayload;
  network: NetworkPayload;
  websocket: SocketPayload;
  eventsource: SocketPayload;
  nav: NavPayload;
  perf: PerfPayload;
}

export interface PageEnvelope<K extends PageMsgKind = PageMsgKind> {
  source: typeof TRAWLER_TAG;
  kind: K;
  payload: PayloadByKind[K];
}

/** Function MAIN-world hooks use to relay a captured fact. */
export type RelayFn = <K extends PageMsgKind>(kind: K, payload: PayloadByKind[K]) => void;

/** Validates an untrusted `MessageEvent.data` is a Trawler envelope. */
export function isPageEnvelope(data: unknown): data is PageEnvelope {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.source === TRAWLER_TAG && typeof d.kind === 'string' && 'payload' in d;
}
