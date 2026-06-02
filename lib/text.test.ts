import { describe, it, expect } from 'vitest';
import { collapseWhitespace, safeStringify, truncate } from './text';

describe('truncate', () => {
  it('keeps short strings', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });
  it('truncates with a dropped-count marker', () => {
    expect(truncate('abcdef', 3)).toBe('abc… [+3 chars]');
  });
  it('handles non-positive max', () => {
    expect(truncate('abc', 0)).toBe('');
  });
});

describe('safeStringify', () => {
  it('passes strings through', () => {
    expect(safeStringify('hi')).toBe('hi');
  });
  it('stringifies objects', () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });
  it('survives circular references', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(safeStringify(o)).toContain('[Circular]');
  });
  it('formats errors', () => {
    expect(safeStringify(new Error('boom'))).toBe('Error: boom');
  });
});

describe('collapseWhitespace', () => {
  it('collapses runs and trims', () => {
    expect(collapseWhitespace('  a\n  b\t c ')).toBe('a b c');
  });
});
