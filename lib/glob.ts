/** Glob and pattern matching for the capture-rule engine (ADR Decision 6). */

/** Converts a glob (`*` = any run, `?` = single char) to an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Anchored glob match — used for domains. */
export function matchGlob(glob: string, value: string): boolean {
  return globToRegExp(glob).test(value);
}

/**
 * Parses a pattern that is EITHER a `/regex/flags` literal OR a glob.
 * Regex patterns are NOT auto-anchored (the author controls anchoring); globs
 * are anchored by {@link globToRegExp}.
 */
export function parsePattern(pattern: string): RegExp {
  if (pattern.length >= 2 && pattern.startsWith('/')) {
    const last = pattern.lastIndexOf('/');
    if (last > 0) {
      const body = pattern.slice(1, last);
      const flags = pattern.slice(last + 1);
      try {
        return new RegExp(body, flags);
      } catch {
        // Malformed regex → fall through and treat the whole thing as a glob.
      }
    }
  }
  return globToRegExp(pattern);
}

/** Pattern match — used for paths (regex or glob). */
export function matchPattern(pattern: string, value: string): boolean {
  return parsePattern(pattern).test(value);
}
