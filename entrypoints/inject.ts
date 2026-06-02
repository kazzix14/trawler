import { defineUnlistedScript } from '#imports';
import { createRelay } from '../lib/page/relay';
import { installNetworkHooks } from '../lib/page/network-hooks';
import { installSocketHooks } from '../lib/page/socket-hooks';
import { installConsoleHooks } from '../lib/page/console-hooks';
import { installErrorHooks } from '../lib/page/error-hooks';
import { installHistoryHooks } from '../lib/page/history-hooks';

/**
 * MAIN-world hooks (page JS realm — NO extension APIs). Injected by the
 * ISOLATED content script via injectScript('/inject.js') at document_start so
 * the page's console / network / errors / history are teed transparently before
 * the app's own code runs (ADR Decisions 2 & 3).
 */
export default defineUnlistedScript(() => {
  const w = window as unknown as { __trawlerInjected?: boolean };
  if (w.__trawlerInjected) return; // never double-patch
  w.__trawlerInjected = true;

  const relay = createRelay();
  installNetworkHooks(relay);
  installSocketHooks(relay);
  installConsoleHooks(relay);
  installErrorHooks(relay);
  installHistoryHooks(relay);
});
