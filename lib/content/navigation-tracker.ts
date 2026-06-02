/** Page load-lifecycle navigation tracker (ISOLATED world).
 *
 * Emits NavigationEvents for THIS document's own load lifecycle only:
 * `domcontentloaded` and `load`. SPA-style navigations (pushState /
 * replaceState / popstate / hashchange) are observed in the MAIN world and
 * arrive via the relay — we deliberately do NOT duplicate them here.
 *
 * DOM-only — no extension APIs, no top-level side effects.
 */
import type { NavigationEvent, NavigationType, TimelineEvent } from '../types';
import { uid } from '../id';
import { now } from '../time';

export interface NavigationTrackerOptions {
  onEvent: (e: TimelineEvent) => void;
}

function navEvent(type: NavigationType): NavigationEvent {
  return {
    id: uid('evt'),
    kind: 'navigation',
    ts: now(),
    type,
    url: location.href,
  };
}

export function createNavigationTracker(opts: NavigationTrackerOptions): {
  start(): void;
  stop(): void;
} {
  let onDomContentLoaded: (() => void) | null = null;
  let onLoad: (() => void) | null = null;

  const removeListeners = (): void => {
    if (onDomContentLoaded) {
      document.removeEventListener('DOMContentLoaded', onDomContentLoaded);
      onDomContentLoaded = null;
    }
    if (onLoad) {
      window.removeEventListener('load', onLoad);
      onLoad = null;
    }
  };

  return {
    start(): void {
      // Already started, or document already finished loading.
      if (onDomContentLoaded || onLoad) return;

      if (document.readyState === 'loading') {
        onDomContentLoaded = () => {
          opts.onEvent(navEvent('domcontentloaded'));
          if (onDomContentLoaded) {
            document.removeEventListener('DOMContentLoaded', onDomContentLoaded);
            onDomContentLoaded = null;
          }
        };
        onLoad = () => {
          opts.onEvent(navEvent('load'));
          if (onLoad) {
            window.removeEventListener('load', onLoad);
            onLoad = null;
          }
        };
        document.addEventListener('DOMContentLoaded', onDomContentLoaded);
        window.addEventListener('load', onLoad);
        return;
      }

      // Started after the load lifecycle already ran: emit a single 'load'.
      opts.onEvent(navEvent('load'));
    },
    stop(): void {
      removeListeners();
    },
  };
}
