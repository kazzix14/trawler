/** Background downloads helper.
 *
 * Saves a `data:` URL to disk via the downloads API and resolves the final
 * absolute on-disk path once the download completes. Because
 * `downloads.download` only yields a numeric id, the actual filename is
 * recovered by watching `downloads.onChanged` for completion, then querying
 * `downloads.search`. A safety timeout guards against a missed event.
 */
import { browser } from '#imports';

/** How long to wait for a completion event before falling back to a search. */
const SETTLE_TIMEOUT_MS = 10_000;

/**
 * Downloads `dataUrl` as `filename` (uniquified, no Save-As dialog) and
 * resolves the resolved absolute path on disk.
 */
export function saveDataUrl(dataUrl: string, filename: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      browser.downloads.onChanged.removeListener(onChanged);
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };

    const settleOk = (path: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(path);
    };

    const settleErr = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const onChanged = (delta: { id: number; state?: { current?: string } }): void => {
      if (delta.id !== downloadId) return;
      const state = delta.state?.current;
      if (state === 'complete') {
        void resolvePath(downloadId).then(
          (path) => settleOk(path),
          (error) => settleErr(toError(error)),
        );
      } else if (state === 'interrupted') {
        settleErr(new Error(`Download interrupted: ${filename}`));
      }
    };

    let downloadId = -1;

    browser.downloads
      .download({
        url: dataUrl,
        filename,
        conflictAction: 'uniquify',
        saveAs: false,
      })
      .then((id) => {
        if (typeof id !== 'number') {
          settleErr(new Error(`Download did not return an id: ${filename}`));
          return;
        }
        downloadId = id;
        browser.downloads.onChanged.addListener(onChanged);
        // Fallback: if no completion event arrives, attempt a direct search.
        timeoutId = setTimeout(() => {
          void resolvePath(downloadId).then(
            (path) => settleOk(path),
            () => settleErr(new Error(`Download timed out: ${filename}`)),
          );
        }, SETTLE_TIMEOUT_MS);
      })
      .catch((error) => settleErr(toError(error)));
  });
}

/** Look up the saved item and return its absolute on-disk filename. */
async function resolvePath(id: number): Promise<string> {
  const items = await browser.downloads.search({ id });
  const item = items[0];
  if (!item || !item.filename) {
    throw new Error(`Download item not found: ${id}`);
  }
  return item.filename;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
