/** Time helpers. All Trawler timestamps are wall-clock epoch milliseconds. */

export function now(): number {
  return Date.now();
}

/** `HH:MM:SS.mmm` in local time — compact and readable in the bundle. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Offset from a window start, e.g. `+1.234s`. */
export function formatOffset(ts: number, originTs: number): string {
  const delta = (ts - originTs) / 1000;
  const sign = delta < 0 ? '-' : '+';
  return `${sign}${Math.abs(delta).toFixed(3)}s`;
}

/** Human duration, e.g. `5m 03s` / `42s`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
