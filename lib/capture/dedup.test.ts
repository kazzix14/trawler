import { describe, it, expect } from 'vitest';
import { Deduper, consoleDedupKey, networkDedupKey } from './dedup';

describe('Deduper (fixed 3s window)', () => {
  it('allows first, suppresses repeats inside the window', () => {
    const d = new Deduper(3000);
    expect(d.allow('k', 0)).toBe(true);
    expect(d.allow('k', 500)).toBe(false);
    expect(d.allow('k', 2999)).toBe(false);
  });

  it('re-allows once the fixed window has elapsed', () => {
    const d = new Deduper(3000);
    expect(d.allow('k', 0)).toBe(true);
    expect(d.allow('k', 3000)).toBe(true); // window is from the shot time, fixed
    expect(d.allow('k', 3001)).toBe(false);
  });

  it('tracks distinct keys independently', () => {
    const d = new Deduper(3000);
    expect(d.allow('a', 0)).toBe(true);
    expect(d.allow('b', 0)).toBe(true);
    expect(d.allow('a', 100)).toBe(false);
  });

  it('prune forgets elapsed keys', () => {
    const d = new Deduper(3000);
    d.allow('a', 0);
    d.prune(3000);
    expect(d.allow('a', 3000)).toBe(true);
  });
});

describe('dedup keys', () => {
  it('console key combines message and stack top', () => {
    expect(consoleDedupKey('boom', 'a.js:1:2')).toBe('console|boom|a.js:1:2');
    expect(consoleDedupKey('boom', undefined)).toBe('console|boom|');
  });

  it('network key combines domain, path, status', () => {
    expect(networkDedupKey('api.x.com', '/cart', 500)).toBe('net|api.x.com|/cart|500');
  });
});
