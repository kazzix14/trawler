/** MAIN-world network hooks: a transparent tee over `fetch` and `XMLHttpRequest`.
 *
 * Lives in the page's JS realm — NO extension APIs available here. The goal is
 * total transparency: return values, thrown errors, and timing are never
 * altered, and the original response body is never consumed (we always read a
 * `clone()`). Every tee branch is wrapped in try/catch so a hook failure can
 * never perturb the page. */
import { PAGE_BODY_MAX, type NetworkPayload, type RelayFn } from '../protocol';
import { truncate } from '../text';
import { now } from '../time';

/** Per-XHR capture state tracked off to the side, keyed by the instance. */
interface XhrState {
  method: string;
  url: string;
  requestBody?: string;
  startedAt: number;
}

/** Cap a body string for relay; the content side re-truncates to settings. */
function capBody(body: string): string {
  return truncate(body, PAGE_BODY_MAX);
}

/** Extract request headers from a fetch `init.headers` value (any accepted form). */
function readInitHeaders(init?: RequestInit): Record<string, string> | undefined {
  const raw = init?.headers;
  if (!raw) return undefined;
  const out: Record<string, string> = {};
  try {
    if (raw instanceof Headers) {
      raw.forEach((value, key) => {
        out[key] = value;
      });
    } else if (Array.isArray(raw)) {
      for (const pair of raw) {
        if (pair && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
      }
    } else {
      for (const key of Object.keys(raw)) {
        out[key] = String((raw as Record<string, string>)[key]);
      }
    }
  } catch {
    return undefined;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Collect response headers from a `Headers` instance into a plain record. */
function readResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    headers.forEach((value, key) => {
      out[key] = value;
    });
  } catch {
    // Leave whatever was collected so far.
  }
  return out;
}

/** Resolve the request method + absolute URL from fetch arguments. */
function resolveFetchTarget(input: RequestInfo | URL, init?: RequestInit): { method: string; url: string } {
  let method = init?.method;
  let url: string;
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else {
    // Request object.
    url = input.url;
    if (!method) method = input.method;
  }
  let absolute = url;
  try {
    absolute = new URL(url, window.location.href).href;
  } catch {
    // Keep the raw value if it cannot be resolved.
  }
  return { method: (method ?? 'GET').toUpperCase(), url: absolute };
}

/** Read a fetch request body only when it is a plain string. */
function readFetchRequestBody(init?: RequestInit): string | undefined {
  const body = init?.body;
  return typeof body === 'string' ? capBody(body) : undefined;
}

/** Relay the outcome of a settled fetch response without consuming its body. */
async function relayFetchResponse(
  relay: RelayFn,
  base: NetworkPayload,
  res: Response,
): Promise<void> {
  let responseBody: string | undefined;
  try {
    responseBody = capBody(await res.clone().text());
  } catch {
    // Body not readable (e.g. opaque/already-disturbed clone); skip it.
  }
  relay('network', {
    ...base,
    status: res.status,
    ok: res.ok,
    responseBody,
    responseHeaders: readResponseHeaders(res.headers),
    durationMs: now() - base.startedAt,
  });
}

/** Install the transparent `fetch` tee. */
function installFetchHook(relay: RelayFn): void {
  const original = window.fetch;
  if (typeof original !== 'function') return;

  const patched: typeof window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    let base: NetworkPayload | undefined;
    try {
      const { method, url } = resolveFetchTarget(input, init);
      base = {
        via: 'fetch',
        method,
        url,
        requestBody: readFetchRequestBody(init),
        requestHeaders: readInitHeaders(init),
        startedAt: now(),
      };
    } catch {
      base = undefined;
    }

    const result = original.call(this, input as RequestInfo, init);
    if (!base) return result;
    const captured = base;

    // Return a DERIVED promise that mirrors `result` and re-throws on rejection.
    // Attaching a side `.then` to `result` and returning `result` directly would
    // mark `result` as handled and SUPPRESS the page's own `unhandledrejection`
    // for un-awaited fetches. By re-throwing here, an unhandled rejection still
    // surfaces exactly once (on the returned promise) — preserving the page's
    // error semantics — at the cost of one microtask. The original Response is
    // never consumed (we read a clone).
    return result.then(
      (res) => {
        try {
          void relayFetchResponse(relay, captured, res);
        } catch {
          // Never surface tee errors to the page.
        }
        return res;
      },
      (err: unknown) => {
        try {
          relay('network', {
            ...captured,
            error: err instanceof Error ? err.message : String(err),
            durationMs: now() - captured.startedAt,
          });
        } catch {
          // Swallow tee errors.
        }
        throw err;
      },
    );
  };

  window.fetch = patched;
}

/** Parse `getAllResponseHeaders()` raw text into a record. */
function parseXhrHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Read an XHR response body only for text-compatible response types. */
function readXhrResponseBody(xhr: XMLHttpRequest): string | undefined {
  try {
    if (xhr.responseType === '' || xhr.responseType === 'text') {
      const text = xhr.responseText;
      if (typeof text === 'string') return capBody(text);
    }
  } catch {
    // responseText can throw for incompatible responseType; skip.
  }
  return undefined;
}

/** Build and relay the network payload for a completed XHR. */
function relayXhrLoadend(relay: RelayFn, xhr: XMLHttpRequest, state: XhrState): void {
  let responseHeaders: Record<string, string> | undefined;
  try {
    const raw = xhr.getAllResponseHeaders();
    if (raw) responseHeaders = parseXhrHeaders(raw);
  } catch {
    responseHeaders = undefined;
  }
  relay('network', {
    via: 'xhr',
    method: state.method,
    url: state.url,
    status: xhr.status,
    ok: xhr.status >= 200 && xhr.status < 300,
    requestBody: state.requestBody,
    responseBody: readXhrResponseBody(xhr),
    responseHeaders,
    durationMs: now() - state.startedAt,
    startedAt: state.startedAt,
  });
}

/** Install the transparent `XMLHttpRequest` tee. */
function installXhrHook(relay: RelayFn): void {
  const proto = XMLHttpRequest?.prototype;
  if (!proto) return;
  const originalOpen = proto.open;
  const originalSend = proto.send;
  if (typeof originalOpen !== 'function' || typeof originalSend !== 'function') return;

  const states = new WeakMap<XMLHttpRequest, XhrState>();

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    try {
      let absolute = String(url);
      try {
        absolute = new URL(String(url), window.location.href).href;
      } catch {
        // Keep raw value.
      }
      states.set(this, {
        method: (method ?? 'GET').toUpperCase(),
        url: absolute,
        startedAt: now(),
      });
    } catch {
      // Ignore tee bookkeeping failures.
    }
    // eslint-disable-next-line prefer-rest-params
    return originalOpen.apply(this, arguments as unknown as Parameters<XMLHttpRequest['open']>);
  } as XMLHttpRequest['open'];

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const state = states.get(this);
      if (state) {
        const next: XhrState = {
          ...state,
          requestBody: typeof body === 'string' ? capBody(body) : state.requestBody,
          startedAt: now(),
        };
        states.set(this, next);
        this.addEventListener('loadend', () => {
          try {
            const finalState = states.get(this);
            if (finalState) relayXhrLoadend(relay, this, finalState);
          } catch {
            // Never surface tee errors to the page.
          }
        });
      }
    } catch {
      // Ignore tee bookkeeping failures.
    }
    // eslint-disable-next-line prefer-rest-params
    return originalSend.apply(this, arguments as unknown as Parameters<XMLHttpRequest['send']>);
  } as XMLHttpRequest['send'];
}

/** Monkey-patch `fetch` and `XMLHttpRequest` as a transparent capture tee. */
export function installNetworkHooks(relay: RelayFn): void {
  try {
    installFetchHook(relay);
  } catch {
    // A failed install must never break page networking.
  }
  try {
    installXhrHook(relay);
  } catch {
    // A failed install must never break page networking.
  }
}
