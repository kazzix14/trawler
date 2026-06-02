import { describe, it, expect } from 'vitest';
import { RingBuffer } from './ring-buffer';

interface E {
  ts: number;
  v: number;
}
const opts = (maxItems: number, maxAgeMs: number) => ({
  maxItems,
  maxAgeMs,
  getTs: (e: E) => e.ts,
});

describe('RingBuffer', () => {
  it('caps by item count, keeping newest', () => {
    const rb = new RingBuffer<E>(opts(3, Infinity));
    for (let i = 0; i < 5; i++) rb.push({ ts: i, v: i }, i);
    expect(rb.size).toBe(3);
    expect(rb.toArray().map((e) => e.v)).toEqual([2, 3, 4]);
  });

  it('drops items older than maxAgeMs', () => {
    const rb = new RingBuffer<E>(opts(100, 1000));
    rb.push({ ts: 0, v: 0 }, 0);
    rb.push({ ts: 500, v: 1 }, 500);
    rb.push({ ts: 1500, v: 2 }, 1500); // now=1500, minTs=500 → ts:0 dropped
    expect(rb.toArray().map((e) => e.v)).toEqual([1, 2]);
  });

  it('range filters inclusively', () => {
    const rb = new RingBuffer<E>(opts(100, Infinity));
    [10, 20, 30, 40].forEach((t) => rb.push({ ts: t, v: t }, t));
    expect(rb.range(20, 30).map((e) => e.v)).toEqual([20, 30]);
  });

  it('clear empties the buffer', () => {
    const rb = new RingBuffer<E>(opts(100, Infinity));
    rb.push({ ts: 1, v: 1 }, 1);
    rb.clear();
    expect(rb.size).toBe(0);
  });
});
