/** Network screenshot rule engine (ADR Decision 6).
 *
 * Rules are evaluated top-down; the first match wins. A match decides only
 * whether a SCREENSHOT is taken — the network event itself is always recorded.
 */
import type { CaptureRule, CaptureRulesConfig, RuleAction } from '../types';
import { matchGlob, matchPattern } from '../glob';

export interface NetworkFacts {
  /** Hostname, e.g. "api.myapp.com". */
  domain: string;
  /** Path, e.g. "/cart/add". */
  path: string;
  /** HTTP status, undefined when the request never got a response. */
  status?: number;
}

/** Matches a status spec: "5xx" | "4xx" | "429" | "400-499". */
export function statusMatches(spec: string, status: number | undefined): boolean {
  if (status === undefined) return false;
  const s = spec.trim().toLowerCase();
  if (/^[1-5]xx$/.test(s)) return Math.floor(status / 100) === Number(s[0]);
  const range = s.match(/^(\d{3})-(\d{3})$/);
  if (range) return status >= Number(range[1]) && status <= Number(range[2]);
  if (/^\d{3}$/.test(s)) return status === Number(s);
  return false;
}

/** A rule with no conditions matches everything (catch-all). */
export function ruleMatches(rule: CaptureRule, facts: NetworkFacts): boolean {
  if (rule.domain !== undefined && !matchGlob(rule.domain, facts.domain)) return false;
  if (rule.path !== undefined && !matchPattern(rule.path, facts.path)) return false;
  if (rule.status !== undefined && !statusMatches(rule.status, facts.status)) return false;
  return true;
}

export function evaluateRules(config: CaptureRulesConfig, facts: NetworkFacts): RuleAction {
  for (const rule of config.rules) {
    if (ruleMatches(rule, facts)) return rule.action;
  }
  return config.default;
}

/** Splits a URL into the facts the rule engine needs. */
export function urlToFacts(url: string, status?: number): NetworkFacts {
  try {
    const u = new URL(url, 'http://invalid.local');
    return { domain: u.hostname, path: u.pathname, status };
  } catch {
    return { domain: '', path: url, status };
  }
}

/** Convenience: should this network response trigger a screenshot? */
export function shouldCaptureNetwork(
  config: CaptureRulesConfig,
  url: string,
  status: number | undefined,
): boolean {
  return evaluateRules(config, urlToFacts(url, status)) === 'capture';
}
