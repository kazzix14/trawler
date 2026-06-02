/** MAIN-world performance hooks (ADR Decision 3 — perf stream).
 *
 * Observes the Performance Timeline with `buffered: true`, so entries that
 * happened BEFORE this script installed (e.g. the navigation and early
 * resources on a reload) are still delivered — closing the fetch-hook injection
 * race. Crucially, resource/navigation timing exposes TTFB
 * (`responseStart − requestStart`), which distinguishes a slow SERVER (large
 * TTFB, e.g. an N+1 query) from slow CLIENT-side work. Page realm only — no
 * extension APIs. */
import type { RelayFn } from '../protocol';

/** Only relay resources at least this slow, to keep signal high. */
const RESOURCE_MIN_MS = 200;
/** Safety cap on relayed resource entries per page. */
const MAX_RESOURCE_EVENTS = 100;

function round(n: number): number {
  return Math.round(n);
}

export function installPerfHooks(relay: RelayFn): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const supported: string[] = (
    (PerformanceObserver as unknown as { supportedEntryTypes?: string[] }).supportedEntryTypes ?? []
  );
  let resourceCount = 0;

  const observe = (type: string, handle: (entries: PerformanceEntryList) => void): void => {
    if (supported.length > 0 && !supported.includes(type)) return;
    try {
      const po = new PerformanceObserver((list) => {
        try {
          handle(list.getEntries());
        } catch {
          // Never let observation perturb the page.
        }
      });
      po.observe({ type, buffered: true } as PerformanceObserverInit);
    } catch {
      // Entry type unsupported in this engine; skip.
    }
  };

  observe('navigation', (entries) => {
    for (const entry of entries) {
      const n = entry as PerformanceNavigationTiming;
      const ttfb = round(n.responseStart - n.requestStart);
      relay('perf', {
        metric: 'navigation',
        url: n.name,
        ttfbMs: ttfb,
        durationMs: round(n.loadEventEnd - n.startTime),
        transferSize: n.transferSize || undefined,
        detail: `ttfb=${ttfb}ms domInteractive=${round(n.domInteractive)}ms domComplete=${round(
          n.domComplete,
        )}ms load=${round(n.loadEventEnd)}ms type=${n.type}`,
      });
    }
  });

  observe('resource', (entries) => {
    for (const entry of entries) {
      const r = entry as PerformanceResourceTiming;
      if (r.duration < RESOURCE_MIN_MS) continue;
      if (resourceCount >= MAX_RESOURCE_EVENTS) break;
      resourceCount += 1;
      // requestStart/responseStart are 0 for cross-origin without Timing-Allow-Origin.
      const ttfb =
        r.responseStart > 0 && r.requestStart > 0 ? round(r.responseStart - r.requestStart) : undefined;
      relay('perf', {
        metric: 'resource',
        url: r.name,
        initiatorType: r.initiatorType,
        ttfbMs: ttfb,
        durationMs: round(r.duration),
        transferSize: r.transferSize || undefined,
      });
    }
  });

  observe('longtask', (entries) => {
    for (const entry of entries) {
      relay('perf', { metric: 'longtask', durationMs: round(entry.duration) });
    }
  });

  observe('largest-contentful-paint', (entries) => {
    const last = entries[entries.length - 1] as (PerformanceEntry & { renderTime?: number; loadTime?: number }) | undefined;
    if (last) relay('perf', { metric: 'lcp', value: round(last.renderTime || last.loadTime || last.startTime) });
  });

  observe('layout-shift', (entries) => {
    let delta = 0;
    for (const entry of entries as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
      if (!entry.hadRecentInput && typeof entry.value === 'number') delta += entry.value;
    }
    if (delta > 0) relay('perf', { metric: 'cls', value: Math.round(delta * 1000) / 1000 });
  });

  observe('paint', (entries) => {
    for (const entry of entries) {
      relay('perf', { metric: 'paint', detail: entry.name, value: round(entry.startTime) });
    }
  });
}
