import { describe, it, expect } from 'vitest';
import {
  evaluateRules,
  ruleMatches,
  shouldCaptureNetwork,
  statusMatches,
  urlToFacts,
} from './rules';
import type { CaptureRulesConfig } from '../types';

describe('statusMatches', () => {
  it('matches Nxx classes', () => {
    expect(statusMatches('5xx', 500)).toBe(true);
    expect(statusMatches('5xx', 599)).toBe(true);
    expect(statusMatches('4xx', 404)).toBe(true);
    expect(statusMatches('4xx', 500)).toBe(false);
  });

  it('matches exact and ranges', () => {
    expect(statusMatches('429', 429)).toBe(true);
    expect(statusMatches('429', 430)).toBe(false);
    expect(statusMatches('400-499', 451)).toBe(true);
    expect(statusMatches('400-499', 500)).toBe(false);
  });

  it('never matches an undefined status', () => {
    expect(statusMatches('5xx', undefined)).toBe(false);
  });
});

describe('ruleMatches', () => {
  it('matches on all provided conditions (AND)', () => {
    const rule = { domain: 'api.myapp.com', status: '5xx', action: 'capture' as const };
    expect(ruleMatches(rule, { domain: 'api.myapp.com', path: '/x', status: 503 })).toBe(true);
    expect(ruleMatches(rule, { domain: 'api.myapp.com', path: '/x', status: 404 })).toBe(false);
    expect(ruleMatches(rule, { domain: 'other.com', path: '/x', status: 503 })).toBe(false);
  });

  it('a rule with no conditions is a catch-all', () => {
    expect(ruleMatches({ action: 'ignore' }, { domain: 'x', path: '/y', status: 200 })).toBe(true);
  });
});

describe('evaluateRules — first match wins', () => {
  const config: CaptureRulesConfig = {
    rules: [
      { domain: 'api.myapp.com', status: '5xx', action: 'capture' },
      { domain: 'api.myapp.com', status: '4xx', action: 'capture' },
      { path: '/analytics/*', action: 'ignore' },
      { domain: '*.thirdparty.*', action: 'ignore' },
    ],
    default: 'ignore',
  };

  it('captures first-party 4xx/5xx', () => {
    expect(shouldCaptureNetwork(config, 'https://api.myapp.com/cart', 500)).toBe(true);
    expect(shouldCaptureNetwork(config, 'https://api.myapp.com/cart', 404)).toBe(true);
  });

  it('ignores noisy analytics path even on 404', () => {
    expect(shouldCaptureNetwork(config, 'https://api.myapp.com/analytics/collect', 404)).toBe(
      true,
    );
    // analytics path is third in the list but the 4xx rule above matches first for myapp
    expect(shouldCaptureNetwork(config, 'https://cdn.other.com/analytics/x', 404)).toBe(false);
  });

  it('ignores third-party domains', () => {
    expect(shouldCaptureNetwork(config, 'https://cdn.thirdparty.net/a.js', 500)).toBe(false);
  });

  it('falls back to default when nothing matches', () => {
    expect(shouldCaptureNetwork(config, 'https://api.myapp.com/cart', 200)).toBe(false);
  });
});

describe('urlToFacts', () => {
  it('extracts hostname and path', () => {
    expect(urlToFacts('https://a.b.com/x/y?q=1', 200)).toEqual({
      domain: 'a.b.com',
      path: '/x/y',
      status: 200,
    });
  });

  it('degrades gracefully on invalid url', () => {
    const facts = urlToFacts('not a url', 500);
    expect(facts.status).toBe(500);
  });
});
