/** Background screenshot capturer.
 *
 * `browser.tabs.captureVisibleTab` is hard-capped by the browser at 2 calls
 * per second; exceeding it throws. This serializes every capture through a
 * single promise chain and enforces at least `minIntervalMs` between the
 * actual API calls, so callers can fire-and-forget without tripping the cap.
 */
import { browser } from '#imports';
import { now } from '../time';

export interface CapturerOptions {
  format: 'png' | 'jpeg';
  minIntervalMs: number;
}

export interface Capturer {
  /** Returns the captured visible tab as a `data:` URL. */
  capture(windowId?: number): Promise<string>;
}

export function createCapturer(opts: CapturerOptions): Capturer {
  // Tail of the serialization chain. Each capture() appends to this so calls
  // execute one at a time, in order. We swallow errors when chaining so a
  // failed capture never poisons subsequent ones, but the per-call result
  // (the promise returned to that caller) still rejects with the real error.
  let chain: Promise<unknown> = Promise.resolve();
  let lastAt = 0;

  const runCapture = async (windowId?: number): Promise<string> => {
    const elapsed = now() - lastAt;
    const wait = opts.minIntervalMs - elapsed;
    if (wait > 0) {
      await delay(wait);
    }
    lastAt = now();
    // captureVisibleTab's typed overloads require a number windowId; when it is
    // omitted, call the (options-only) form so it defaults to the current window.
    return windowId === undefined
      ? browser.tabs.captureVisibleTab({ format: opts.format })
      : browser.tabs.captureVisibleTab(windowId, { format: opts.format });
  };

  const capture = (windowId?: number): Promise<string> => {
    const result = chain.then(() => runCapture(windowId));
    // Keep the chain alive regardless of this call's outcome.
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return { capture };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
