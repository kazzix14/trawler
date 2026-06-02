/** MAIN-world history hooks: transparently patch pushState/replaceState and
 * listen for popstate/hashchange, relaying SPA navigations. Lives in the
 * page's JS realm — NO extension APIs available here. The patched History
 * methods always call the original first, so navigation is unaffected. */
import { type RelayFn, type NavPayload } from '../protocol';

export function installHistoryHooks(relay: RelayFn): void {
  // Captured in closure so each relay can report where we came from.
  let previousHref = currentHref();

  const emit = (method: NavPayload['method']): void => {
    try {
      const fromUrl = previousHref;
      const url = currentHref();
      previousHref = url;
      relay('nav', { method, url, fromUrl });
    } catch {
      // Never let capture failures perturb navigation.
    }
  };

  patchHistory('pushState', () => emit('pushState'));
  patchHistory('replaceState', () => emit('replaceState'));
  addNavListener('popstate', () => emit('popstate'));
  addNavListener('hashchange', () => emit('hashchange'));
}

type HistoryStateMethod = 'pushState' | 'replaceState';

/** Wrap a History state method so it forwards to the original, then relays. */
function patchHistory(method: HistoryStateMethod, afterCall: () => void): void {
  try {
    const original = history[method];
    if (typeof original !== 'function') return;

    const patched = function (this: History, ...args: unknown[]): void {
      // Forward to the original first so the real navigation happens.
      (original as (...a: unknown[]) => void).apply(this, args);
      afterCall();
    };

    history[method] = patched as History[HistoryStateMethod];
  } catch {
    // History frozen/unavailable; leave the original in place.
  }
}

function addNavListener(type: 'popstate' | 'hashchange', handler: () => void): void {
  try {
    window.addEventListener(type, handler);
  } catch {
    // addEventListener unavailable; nothing to capture.
  }
}

function currentHref(): string {
  try {
    return location.href;
  } catch {
    return '';
  }
}
