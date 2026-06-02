/**
 * ISOLATED-world receiver for facts relayed from the MAIN-world page hooks.
 *
 * The MAIN world (page context) has no access to extension APIs, so it ships
 * captured facts over `window.postMessage`. This receiver listens for those
 * messages, rejects anything that is not a trusted Trawler envelope from the
 * same window/origin, then maps each payload onto a `TimelineEvent` (stamping a
 * fresh `id`/`ts`) before handing it to `onEvent`.
 *
 * DOM-only (no extension APIs).
 */
import type {
  ConsoleEvent,
  NavigationEvent,
  NetworkEvent,
  PageErrorEvent,
  PerfEvent,
  SocketEvent,
  TimelineEvent,
  UnhandledRejectionEvent,
} from '../types';
import type {
  ConsolePayload,
  ErrorPayload,
  NavPayload,
  NetworkPayload,
  PageEnvelope,
  PerfPayload,
  RejectionPayload,
  SocketPayload,
} from '../protocol';
import { isPageEnvelope } from '../protocol';
import { uid } from '../id';
import { now } from '../time';
import { truncate } from '../text';

export interface RelayReceiverOptions {
  onEvent: (e: TimelineEvent) => void;
  bodyMaxChars: number;
}

/** Re-truncate an optional body to the content-side limit. */
function clampBody(body: string | undefined, max: number): string | undefined {
  return body === undefined ? undefined : truncate(body, max);
}

function toConsole(p: ConsolePayload): ConsoleEvent {
  return { id: uid(), kind: 'console', ts: now(), level: p.level, args: p.args, stackTop: p.stackTop };
}

function toError(p: ErrorPayload): PageErrorEvent {
  return {
    id: uid(),
    kind: 'error',
    ts: now(),
    message: p.message,
    source: p.source,
    line: p.line,
    col: p.col,
    stack: p.stack,
  };
}

function toRejection(p: RejectionPayload): UnhandledRejectionEvent {
  return { id: uid(), kind: 'unhandledrejection', ts: now(), reason: p.reason, stack: p.stack };
}

function toNetwork(p: NetworkPayload, bodyMaxChars: number): NetworkEvent {
  return {
    id: uid(),
    kind: 'network',
    ts: now(),
    via: p.via,
    method: p.method,
    url: p.url,
    status: p.status,
    ok: p.ok,
    requestBody: clampBody(p.requestBody, bodyMaxChars),
    responseBody: clampBody(p.responseBody, bodyMaxChars),
    requestHeaders: p.requestHeaders,
    responseHeaders: p.responseHeaders,
    durationMs: p.durationMs,
    error: p.error,
  };
}

function toSocket(p: SocketPayload): SocketEvent {
  return {
    id: uid(),
    kind: p.socket,
    ts: now(),
    url: p.url,
    direction: p.direction,
    data: p.data,
    code: p.code,
  };
}

function toNavigation(p: NavPayload): NavigationEvent {
  return { id: uid(), kind: 'navigation', ts: now(), type: p.method, url: p.url, fromUrl: p.fromUrl };
}

function toPerf(p: PerfPayload): PerfEvent {
  return {
    id: uid(),
    kind: 'perf',
    ts: now(),
    metric: p.metric,
    url: p.url,
    initiatorType: p.initiatorType,
    ttfbMs: p.ttfbMs,
    durationMs: p.durationMs,
    transferSize: p.transferSize,
    value: p.value,
    detail: p.detail,
  };
}

/** Map a validated envelope onto a TimelineEvent, or null for unknown kinds. */
function mapEnvelope(env: PageEnvelope, bodyMaxChars: number): TimelineEvent | null {
  switch (env.kind) {
    case 'console':
      return toConsole(env.payload as ConsolePayload);
    case 'error':
      return toError(env.payload as ErrorPayload);
    case 'unhandledrejection':
      return toRejection(env.payload as RejectionPayload);
    case 'network':
      return toNetwork(env.payload as NetworkPayload, bodyMaxChars);
    case 'websocket':
    case 'eventsource':
      return toSocket(env.payload as SocketPayload);
    case 'nav':
      return toNavigation(env.payload as NavPayload);
    case 'perf':
      return toPerf(env.payload as PerfPayload);
    default:
      return null;
  }
}

export function createRelayReceiver(opts: RelayReceiverOptions): { start(): void; stop(): void } {
  const handler = (event: MessageEvent): void => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (!isPageEnvelope(event.data)) return;

    const mapped = mapEnvelope(event.data, opts.bodyMaxChars);
    if (mapped !== null) opts.onEvent(mapped);
  };

  return {
    start(): void {
      window.addEventListener('message', handler, false);
    },
    stop(): void {
      window.removeEventListener('message', handler, false);
    },
  };
}
