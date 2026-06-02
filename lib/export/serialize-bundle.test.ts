import { describe, it, expect } from 'vitest';
import { serializeBundle, serializeMarks } from './serialize-bundle';
import type {
  ExportInput,
  MarkEvent,
  MarkRecord,
  NetworkEvent,
  ConsoleEvent,
  PerfEvent,
} from '../types';

const t0 = 1_000_000;

const net: NetworkEvent = {
  id: 'e1',
  kind: 'network',
  ts: t0 + 1000,
  via: 'fetch',
  method: 'POST',
  url: 'https://api.myapp.com/cart/add',
  status: 500,
  ok: false,
  requestBody: '{"id":42}',
  responseBody: '{"error":"boom"}',
  durationMs: 123.7,
  screenshotId: 'shot1',
};

const cons: ConsoleEvent = {
  id: 'e2',
  kind: 'console',
  ts: t0 + 1500,
  level: 'error',
  args: ['Uncaught', 'TypeError: x is not a function'],
  stackTop: 'app.js:10:5',
};

const mark: MarkEvent = {
  id: 'e3',
  kind: 'mark',
  ts: t0 + 2000,
  note: 'add-to-cart button unresponsive',
  element: {
    startTag: '<button data-action="cart#add">カートに追加</button>',
    elidedOuterHtml: '<button data-action="cart#add">カートに追加</button>',
    selector: '#add-btn',
    classes: ['btn'],
    dataAttrs: { 'data-action': 'cart#add' },
    ariaAttrs: {},
    leafText: 'カートに追加',
    htmlLine: 88,
    htmlLineContent: '<button data-action="cart#add">カートに追加</button>',
  },
  screenshotId: 'shot2',
};

function input(): ExportInput {
  return {
    window: { startTs: t0, endTs: t0 + 3000, label: 'last 3s' },
    memo: 'cart total did not update',
    events: [net, cons, mark],
    marks: [mark],
    screenshotPaths: { shot1: '/Downloads/trawler/a.png', shot2: '/Downloads/trawler/b.png' },
    pageUrl: 'https://shop.myapp.com/cart',
    generatedAtIso: '2026-06-02T08:00:00.000Z',
  };
}

describe('serializeMarks — mark-list format (note + that mark’s info)', () => {
  const rec: MarkRecord = {
    id: 'm1',
    ts: t0 + 5000,
    tabId: 1,
    pageUrl: 'https://shop.myapp.com/booths/x',
    note: 'page loads slowly',
    element: {
      startTag: '<main class="app">',
      elidedOuterHtml: '<main class="app">...</main>',
      selector: 'main.app',
      classes: ['app'],
      dataAttrs: {},
      ariaAttrs: {},
      htmlLine: 12,
    },
    screenshotId: 's1',
    navStartTs: t0,
    events: [
      {
        id: 'n0',
        kind: 'perf',
        ts: t0 + 100,
        metric: 'navigation',
        ttfbMs: 1221,
        durationMs: 1843,
        detail: 'ttfb=1221ms domInteractive=1249ms',
      } as PerfEvent,
      { id: 'c0', kind: 'console', ts: t0 + 200, level: 'log', args: ['[debounced-submit] connected'] } as ConsoleEvent,
      { id: 'm1', kind: 'mark', ts: t0 + 5000, note: 'page loads slowly' } as MarkEvent,
    ],
  };

  const out = serializeMarks({
    records: [rec],
    screenshotPaths: { s1: '/Downloads/trawler/m1.png' },
    pageUrl: 'https://shop.myapp.com/booths/x',
    generatedAtIso: '2026-06-02T08:00:00.000Z',
  });

  it('renders one block per mark: note heading + element + screenshot', () => {
    expect(out).toContain('Marks:     1');
    expect(out).toContain('Mark 1: "page loads slowly"');
    expect(out).toContain('element:   L12: <main class="app">');
    expect(out).toContain('selector:  main.app');
    expect(out).toContain('screenshot: /Downloads/trawler/m1.png');
  });

  it("includes the mark's own performance + timeline, excluding the mark event itself", () => {
    expect(out).toContain('Navigation: ttfb=1221ms');
    expect(out).toContain('CONSOLE.log [debounced-submit] connected');
    expect(out).toContain('timeline (2)');
    expect(out).not.toContain('✎ MARK');
  });

  it('handles an empty mark list', () => {
    const none = serializeMarks({ records: [], screenshotPaths: {}, pageUrl: 'x', generatedAtIso: 'x' });
    expect(none).toContain('Marks:     0');
    expect(none).toContain('(no marks)');
  });
});

describe('serializeBundle — performance summary (server vs client signal)', () => {
  const nav: PerfEvent = {
    id: 'p0',
    kind: 'perf',
    ts: t0 + 100,
    metric: 'navigation',
    url: 'https://shop.myapp.com/booths/x',
    ttfbMs: 22,
    durationMs: 5065,
    detail: 'ttfb=22ms domInteractive=5008ms domComplete=5065ms load=5065ms type=reload',
  };
  const slow: PerfEvent = {
    id: 'p1',
    kind: 'perf',
    ts: t0 + 200,
    metric: 'resource',
    url: 'https://api.myapp.com/booths/x/items',
    initiatorType: 'fetch',
    ttfbMs: 4980,
    durationMs: 5020,
    transferSize: 41000,
  };
  const fast: PerfEvent = {
    id: 'p2',
    kind: 'perf',
    ts: t0 + 300,
    metric: 'resource',
    url: 'https://cdn.myapp.com/app.js',
    initiatorType: 'script',
    ttfbMs: 30,
    durationMs: 120,
  };
  const longtask: PerfEvent = { id: 'p3', kind: 'perf', ts: t0 + 400, metric: 'longtask', durationMs: 220 };

  const out = serializeBundle({
    window: { startTs: t0, endTs: t0 + 6000, label: 'x' },
    events: [nav, slow, fast, longtask],
    marks: [],
    screenshotPaths: {},
    pageUrl: 'https://shop.myapp.com/booths/x',
    generatedAtIso: '2026-06-02T08:00:00.000Z',
  });

  it('emits a Performance section with navigation timing', () => {
    expect(out).toContain('--- Performance ---');
    expect(out).toContain('Navigation: ttfb=22ms domInteractive=5008ms');
  });

  it('ranks the slow N+1-style request first by TTFB and labels it server time', () => {
    expect(out).toContain('Slowest requests by server time (TTFB)');
    expect(out).toContain('https://api.myapp.com/booths/x/items');
    expect(out).toContain('TTFB 4980ms');
    const idxSlow = out.indexOf('/booths/x/items');
    const idxFast = out.indexOf('app.js');
    expect(idxSlow).toBeGreaterThan(-1);
    expect(idxSlow).toBeLessThan(idxFast); // slow request listed before the fast one
  });

  it('reports long-task blocking time', () => {
    expect(out).toContain('Long tasks: 1 (total 220ms');
  });

  it('omits the Performance section when there are no perf events', () => {
    const none = serializeBundle({
      window: { startTs: t0, endTs: t0 + 1000 },
      events: [],
      marks: [],
      screenshotPaths: {},
      pageUrl: 'x',
      generatedAtIso: 'x',
    });
    expect(none).not.toContain('--- Performance ---');
  });
});

describe('serializeBundle', () => {
  const out = serializeBundle(input());

  it('starts directly with the capture header (no priming preamble)', () => {
    expect(out.startsWith('== Trawler verification capture ==')).toBe(true);
    expect(out).not.toContain('原因はまだ推論されていません');
  });

  it('includes header metadata', () => {
    expect(out).toContain('Page:      https://shop.myapp.com/cart');
    expect(out).toContain('Window:    last 3s');
    expect(out).toContain('Events:    3');
  });

  it('includes the memo', () => {
    expect(out).toContain('cart total did not update');
  });

  it('renders the mark note + element with html line + start tag + leaf text', () => {
    expect(out).toContain('add-to-cart button unresponsive');
    expect(out).toContain('L88: <button data-action="cart#add">');
    expect(out).toContain('text:      "カートに追加"');
    expect(out).toContain('selector:  #add-btn');
  });

  it('renders network with method/url/status and bodies', () => {
    expect(out).toContain('NETWORK POST https://api.myapp.com/cart/add → 500 (124ms)');
    expect(out).toContain('response: {"error":"boom"}');
  });

  it('renders console error with stack top', () => {
    expect(out).toContain('CONSOLE.error Uncaught TypeError: x is not a function');
    expect(out).toContain('at app.js:10:5');
  });

  it('references screenshot paths (never inlines images)', () => {
    expect(out).toContain('/Downloads/trawler/a.png');
    expect(out).toContain('/Downloads/trawler/b.png');
    expect(out).not.toContain('data:image');
  });

  it('handles empty windows gracefully', () => {
    const empty = serializeBundle({ ...input(), events: [], marks: [] });
    expect(empty).toContain('(no events in window)');
    expect(empty).toContain('Marks (0)');
  });
});
