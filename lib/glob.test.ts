import { describe, it, expect } from 'vitest';
import { globToRegExp, matchGlob, matchPattern, parsePattern } from './glob';

describe('matchGlob (domains)', () => {
  it('matches exact host', () => {
    expect(matchGlob('api.myapp.com', 'api.myapp.com')).toBe(true);
    expect(matchGlob('api.myapp.com', 'web.myapp.com')).toBe(false);
  });

  it('matches wildcard host patterns', () => {
    expect(matchGlob('*.thirdparty.*', 'cdn.thirdparty.net')).toBe(true);
    expect(matchGlob('*.thirdparty.*', 'thirdparty.net')).toBe(false);
    expect(matchGlob('*.myapp.com', 'api.myapp.com')).toBe(true);
  });

  it('is anchored (no partial matches)', () => {
    expect(matchGlob('myapp.com', 'evil-myapp.com')).toBe(false);
    expect(matchGlob('myapp.com', 'myapp.com.evil.io')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(matchGlob('a.b.com', 'aXbXcom')).toBe(false);
  });
});

describe('parsePattern / matchPattern (paths)', () => {
  it('matches glob path prefixes', () => {
    expect(matchPattern('/analytics/*', '/analytics/collect')).toBe(true);
    expect(matchPattern('/analytics/*', '/api/cart')).toBe(false);
  });

  it('treats /regex/flags as a regex (not anchored)', () => {
    expect(matchPattern('/\\/api\\/v\\d+\\//i', '/api/v2/cart')).toBe(true);
    expect(matchPattern('/cart/', '/api/cart/add')).toBe(true);
  });

  it('falls back to glob when the regex is malformed', () => {
    const re = parsePattern('/(/');
    expect(re).toBeInstanceOf(RegExp);
    expect(matchPattern('/(/', '/(/')).toBe(true);
  });
});

describe('globToRegExp', () => {
  it('supports ? single-char wildcard', () => {
    expect(globToRegExp('a?c').test('abc')).toBe(true);
    expect(globToRegExp('a?c').test('ac')).toBe(false);
  });
});
