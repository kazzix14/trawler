/** Screenshot dedup (ADR Decision 5): once an identical event is shot, suppress
 * further shots of it for a FIXED window (3s) measured from the shot time —
 * not sliding. Suppression affects screenshots ONLY; timeline events are always
 * recorded in full.
 */
export class Deduper {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowMs: number) {}

  /**
   * Returns true if a screenshot for `key` is allowed at `nowTs`, recording the
   * shot time. Returns false (suppressed) if a shot for `key` happened within
   * the last `windowMs`.
   */
  allow(key: string, nowTs: number): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && nowTs - prev < this.windowMs) return false;
    this.last.set(key, nowTs);
    return true;
  }

  /** Forget entries whose window has fully elapsed (bounds memory). */
  prune(nowTs: number): void {
    for (const [key, ts] of this.last) {
      if (nowTs - ts >= this.windowMs) this.last.delete(key);
    }
  }

  reset(): void {
    this.last.clear();
  }
}

/** Builds the dedup key for an event (ADR Decision 5). */
export function consoleDedupKey(message: string, stackTop: string | undefined): string {
  return `console|${message}|${stackTop ?? ''}`;
}

export function networkDedupKey(domain: string, path: string, status: number | undefined): string {
  return `net|${domain}|${path}|${status ?? ''}`;
}
