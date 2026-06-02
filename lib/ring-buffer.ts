/** Bounded rolling buffer pruned by BOTH age and item count.
 *
 * Used by the content-side timeline store (ADR Decision 3). Kept generic and
 * pure so it can be unit-tested without any browser context.
 */
export interface RingBufferOptions<T> {
  maxItems: number;
  maxAgeMs: number;
  /** Extracts the timestamp (epoch ms) used for age pruning. */
  getTs: (item: T) => number;
}

export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly opts: RingBufferOptions<T>) {}

  push(item: T, nowTs: number): void {
    this.items.push(item);
    this.prune(nowTs);
  }

  /** Drop items older than maxAgeMs, then cap to the newest maxItems. */
  prune(nowTs: number): void {
    const minTs = nowTs - this.opts.maxAgeMs;
    if (minTs > -Infinity) {
      this.items = this.items.filter((item) => this.opts.getTs(item) >= minTs);
    }
    if (this.items.length > this.opts.maxItems) {
      this.items = this.items.slice(this.items.length - this.opts.maxItems);
    }
  }

  /** Items whose timestamp falls within [startTs, endTs] (inclusive). */
  range(startTs: number, endTs: number): T[] {
    return this.items.filter((item) => {
      const t = this.opts.getTs(item);
      return t >= startTs && t <= endTs;
    });
  }

  toArray(): T[] {
    return this.items.slice();
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}
