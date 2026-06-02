/** MAIN-world error hooks: relay uncaught errors and unhandled promise
 * rejections. Lives in the page's JS realm — NO extension APIs available here.
 * Never calls preventDefault: capture must be fully transparent. */
import { type RelayFn } from '../protocol';

export function installErrorHooks(relay: RelayFn): void {
  installErrorListener(relay);
  installRejectionListener(relay);
}

function installErrorListener(relay: RelayFn): void {
  try {
    window.addEventListener('error', (e: ErrorEvent) => {
      try {
        relay('error', {
          message: e.message,
          source: e.filename || undefined,
          line: e.lineno || undefined,
          col: e.colno || undefined,
          stack: errorStack(e.error),
        });
      } catch {
        // Never let capture failures perturb the page.
      }
    });
  } catch {
    // addEventListener unavailable; nothing to capture.
  }
}

function installRejectionListener(relay: RelayFn): void {
  try {
    window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      try {
        relay('unhandledrejection', {
          reason: String(e.reason),
          stack: errorStack(e.reason),
        });
      } catch {
        // Never let capture failures perturb the page.
      }
    });
  } catch {
    // addEventListener unavailable; nothing to capture.
  }
}

/** Read a `.stack` string from an Error-like value, if present. */
function errorStack(value: unknown): string | undefined {
  if (value && typeof value === 'object') {
    const stack = (value as { stack?: unknown }).stack;
    if (typeof stack === 'string') return stack;
  }
  return undefined;
}
