/** MAIN-world relay: posts captured page facts to the ISOLATED content script.
 * Lives in the page's JS realm — NO extension APIs available here. */
import { TRAWLER_TAG, type RelayFn } from '../protocol';

export function createRelay(): RelayFn {
  return (kind, payload) => {
    try {
      window.postMessage({ source: TRAWLER_TAG, kind, payload }, window.location.origin);
    } catch {
      // Never let relay failures perturb the page.
    }
  };
}
