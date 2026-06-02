/** MAIN-world console hooks: tee console.* calls to the relay, then pass
 * through to the original method unchanged. Lives in the page's JS realm —
 * NO extension APIs available here. */
import { PAGE_BODY_MAX, type RelayFn } from '../protocol';
import { safeStringify, truncate } from '../text';
import type { ConsoleLevel } from '../types';

/** Console methods we tee, each mapped to its ConsoleLevel. */
const HOOKED_METHODS: ReadonlyArray<readonly [keyof Console, ConsoleLevel]> = [
  ['log', 'log'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['debug', 'debug'],
  ['error', 'error'],
];

/** Per-argument cap so a single huge value can't dominate the body budget. */
const ARG_MAX = 2000;

export function installConsoleHooks(relay: RelayFn): void {
  for (const [method, level] of HOOKED_METHODS) {
    patchMethod(relay, method, level);
  }
}

function patchMethod(relay: RelayFn, method: keyof Console, level: ConsoleLevel): void {
  const original = console[method] as (...args: unknown[]) => void;
  if (typeof original !== 'function') return;

  const patched = function (this: unknown, ...args: unknown[]): void {
    try {
      relay('console', {
        level,
        args: mapArgs(args),
        stackTop: level === 'error' ? stackTop() : undefined,
      });
    } catch {
      // Never let capture failures perturb the page's logging.
    }
    // ALWAYS forward to the original, with the original arguments unchanged.
    original.apply(console, args);
  };

  try {
    (console as unknown as Record<string, unknown>)[method] = patched;
  } catch {
    // Some environments freeze console; leave the original in place.
  }
}

/** Stringify each argument safely and cap total body size. */
function mapArgs(args: unknown[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const arg of args) {
    if (used >= PAGE_BODY_MAX) {
      out.push('… [args truncated]');
      break;
    }
    const s = truncate(safeStringify(arg, ARG_MAX), PAGE_BODY_MAX - used);
    used += s.length;
    out.push(s);
  }
  return out;
}

/** First stack frame outside this hook — the page caller — as file:line:col. */
function stackTop(): string | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;
  const lines = stack.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'Error') continue;
    // Skip frames inside this module's own functions.
    if (line.includes('stackTop') || line.includes('patched') || line.includes('mapArgs')) {
      continue;
    }
    const frame = extractLocation(line);
    if (frame) return frame;
  }
  return undefined;
}

/** Extract a `file:line:col` location from a single stack frame line. */
function extractLocation(line: string): string | undefined {
  // Matches the trailing "url:line:col" present in both V8 and SpiderMonkey.
  const match = line.match(/((?:https?|file|blob|data):[^\s)]+):(\d+):(\d+)/);
  if (match) return `${match[1]}:${match[2]}:${match[3]}`;
  const bare = line.match(/([^\s(@]+):(\d+):(\d+)\)?$/);
  if (bare) return `${bare[1]}:${bare[2]}:${bare[3]}`;
  return undefined;
}
