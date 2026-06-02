/** Small text helpers used across capture streams. */

/** Truncate with a visible marker of how much was dropped. */
export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [+${s.length - max} chars]`;
}

/** Best-effort stringify of an arbitrary value for the log (never throws). */
export function safeStringify(value: unknown, max = 2000): string {
  let out: string;
  try {
    if (typeof value === 'string') out = value;
    else if (value instanceof Error) out = `${value.name}: ${value.message}`;
    else if (value === undefined) out = 'undefined';
    else out = JSON.stringify(value, replacer());
  } catch {
    out = String(value);
  }
  if (out === undefined) out = String(value);
  return truncate(out, max);
}

/** JSON.stringify replacer that survives circular refs and BigInt. */
function replacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${(value as { name?: string }).name || 'anonymous'}]`;
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

/** Collapse runs of whitespace into single spaces and trim. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
