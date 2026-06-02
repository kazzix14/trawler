/** MAIN-world socket hooks: transparently observe WebSocket / EventSource traffic.
 *
 * Lives in the page's JS realm — NO extension APIs here. The goal is pure
 * observation: subclasses preserve `instanceof`, static constants, and the
 * page's own event handlers. All observation logic is wrapped in try/catch so
 * a failure to relay can never perturb page behavior. */
import { PAGE_BODY_MAX, type RelayFn, type SocketPayload } from '../protocol';
import { truncate } from '../text';

/** Marker so a double install (e.g. re-injection) does not re-wrap. */
const WRAPPED_FLAG = '__trawlerWrapped';

type Flagged = { [WRAPPED_FLAG]?: boolean };

/** Coerce an incoming socket message's `data` to a relayable string, or undefined. */
function messageData(data: unknown): string | undefined {
  if (typeof data !== 'string') return undefined;
  return truncate(data, PAGE_BODY_MAX);
}

/** Relay a socket fact, swallowing any error so the page is never affected. */
function safeRelay(relay: RelayFn, kind: 'websocket' | 'eventsource', payload: SocketPayload): void {
  try {
    relay(kind, payload);
  } catch {
    // Never let relay failures perturb the page.
  }
}

export function installSocketHooks(relay: RelayFn): void {
  try {
    installWebSocketHook(relay);
  } catch {
    // Leave the native WebSocket untouched on any wiring failure.
  }
  try {
    installEventSourceHook(relay);
  } catch {
    // EventSource may be absent or non-configurable; ignore.
  }
}

function installWebSocketHook(relay: RelayFn): void {
  const Native = window.WebSocket as (typeof WebSocket) & Flagged;
  if (typeof Native !== 'function' || Native[WRAPPED_FLAG]) return;

  class TrawlerWebSocket extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      const target = String(url);
      this.addEventListener('open', () => {
        safeRelay(relay, 'websocket', { socket: 'websocket', url: target, direction: 'open' });
      });
      this.addEventListener('message', (ev: MessageEvent) => {
        safeRelay(relay, 'websocket', {
          socket: 'websocket',
          url: target,
          direction: 'message',
          data: messageData(ev.data),
        });
      });
      this.addEventListener('close', (ev: CloseEvent) => {
        safeRelay(relay, 'websocket', {
          socket: 'websocket',
          url: target,
          direction: 'close',
          code: ev.code,
        });
      });
      this.addEventListener('error', () => {
        safeRelay(relay, 'websocket', { socket: 'websocket', url: target, direction: 'error' });
      });
    }

    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
      safeRelay(relay, 'websocket', {
        socket: 'websocket',
        url: this.url,
        direction: 'send',
        data: typeof data === 'string' ? truncate(data, PAGE_BODY_MAX) : undefined,
      });
      super.send(data);
    }
  }

  copyStatics(Native, TrawlerWebSocket);
  (TrawlerWebSocket as unknown as Flagged)[WRAPPED_FLAG] = true;
  window.WebSocket = TrawlerWebSocket as unknown as typeof WebSocket;
}

function installEventSourceHook(relay: RelayFn): void {
  if (typeof window.EventSource === 'undefined') return;
  const Native = window.EventSource as (typeof EventSource) & Flagged;
  if (typeof Native !== 'function' || Native[WRAPPED_FLAG]) return;

  class TrawlerEventSource extends Native {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      const target = String(url);
      this.addEventListener('open', () => {
        safeRelay(relay, 'eventsource', { socket: 'eventsource', url: target, direction: 'open' });
      });
      this.addEventListener('message', (ev: MessageEvent) => {
        safeRelay(relay, 'eventsource', {
          socket: 'eventsource',
          url: target,
          direction: 'message',
          data: messageData(ev.data),
        });
      });
      this.addEventListener('error', () => {
        safeRelay(relay, 'eventsource', { socket: 'eventsource', url: target, direction: 'error' });
      });
    }
  }

  copyStatics(Native, TrawlerEventSource);
  (TrawlerEventSource as unknown as Flagged)[WRAPPED_FLAG] = true;
  window.EventSource = TrawlerEventSource as unknown as typeof EventSource;
}

/** Copy the readyState constants (CONNECTING/OPEN/CLOSING/CLOSED) onto the
 * subclass so consumers reading `WebSocket.OPEN` etc. keep working. Subclassing
 * inherits them on the prototype chain, but explicit copies guard against any
 * code reading own-properties or replacing the static lookup. */
function copyStatics(from: object, to: object): void {
  const names = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const;
  for (const name of names) {
    const value = (from as Record<string, unknown>)[name];
    if (value === undefined) continue;
    try {
      Object.defineProperty(to, name, { value, writable: false, enumerable: false, configurable: true });
    } catch {
      // Constant already present and non-configurable; inherited value is fine.
    }
  }
}
