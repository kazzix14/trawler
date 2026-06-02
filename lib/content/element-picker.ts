/** Hover-to-highlight, click-to-mark element picker (ISOLATED world).
 *
 * activate() draws a single absolutely-positioned, pointer-events:none highlight
 * box over the hovered element and installs capturing listeners so the page's own
 * handlers never fire while picking. Clicking marks the element (via
 * markedElement) and deactivates; Escape cancels.
 *
 * DOM-only — no extension APIs. No top-level side effects: all DOM access lives
 * inside the methods so WXT can import this in Node at build time.
 */
import type { MarkedElement } from '../types';
import { markedElement } from './element-serialize';

const BOX_Z_INDEX = 2147483646;
const PICK_CURSOR = 'crosshair';

export interface ElementPickerOptions {
  onMark: (el: MarkedElement) => void;
}

export interface ElementPicker {
  activate(): void;
  deactivate(): void;
  /** Flip state; returns the new `active` value. */
  toggle(): boolean;
  readonly active: boolean;
}

/** Inline styles for the highlight overlay — never intercepts pointer events. */
function styleBox(box: HTMLDivElement): void {
  Object.assign(box.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: '0px',
    height: '0px',
    zIndex: String(BOX_Z_INDEX),
    pointerEvents: 'none',
    boxSizing: 'border-box',
    background: 'rgba(64, 156, 255, 0.18)',
    outline: '2px solid rgba(64, 156, 255, 0.9)',
    outlineOffset: '0px',
    borderRadius: '2px',
    transition: 'top 60ms ease, left 60ms ease, width 60ms ease, height 60ms ease',
    transform: 'translateZ(0)',
  } as Partial<CSSStyleDeclaration>);
}

/** Position the overlay over an element using viewport (fixed) coordinates. */
function moveBoxTo(box: HTMLDivElement, target: Element): void {
  const rect = target.getBoundingClientRect();
  box.style.top = `${rect.top}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

const HINT_TEXT = 'Trawler · click an element to pick — Esc to cancel';

/** Shared chrome styling for the in-page banner + confirmation toast. */
function styleChrome(el: HTMLElement): void {
  Object.assign(el.style, {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: String(BOX_Z_INDEX + 1),
    pointerEvents: 'none',
    font: '600 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
    color: '#eef9fc',
    background: 'rgba(13, 110, 132, 0.96)',
    padding: '6px 12px',
    borderRadius: '6px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
    maxWidth: '90vw',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>);
}

/** The "click an element" guidance banner shown while picking. */
function makeBanner(): HTMLDivElement {
  const banner = document.createElement('div');
  banner.textContent = HINT_TEXT;
  styleChrome(banner);
  banner.style.top = '12px';
  return banner;
}

function markedSummary(marked: MarkedElement): string {
  const tag = marked.startTag.length > 44 ? `${marked.startTag.slice(0, 44)}…` : marked.startTag;
  return `✓ Picked ${tag} — add a note in Trawler`;
}

/** Brief, self-removing confirmation toast after a mark (popup is closed by then). */
function flashToast(text: string): void {
  try {
    const toast = document.createElement('div');
    toast.textContent = text;
    styleChrome(toast);
    toast.style.bottom = '16px';
    toast.style.background = 'rgba(22, 130, 90, 0.96)';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1800);
  } catch {
    // Feedback is best-effort; never let it perturb the page.
  }
}

export function createElementPicker(opts: ElementPickerOptions): ElementPicker {
  let active = false;
  let box: HTMLDivElement | null = null;
  let banner: HTMLDivElement | null = null;
  let prevCursor = '';

  const onMouseMove = (e: MouseEvent): void => {
    if (!box) return;
    const target = e.target;
    if (target instanceof Element && target !== box) moveBoxTo(box, target);
  };

  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const target = e.target;
    if (target instanceof Element && target !== box) {
      // Compute before tearing down so the overlay element is not serialized.
      const marked = markedElement(target);
      deactivate();
      flashToast(markedSummary(marked));
      opts.onMark(marked);
      return;
    }
    deactivate();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    deactivate();
  };

  function addListeners(): void {
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function removeListeners(): void {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function activate(): void {
    if (active) return;
    active = true;
    box = document.createElement('div');
    styleBox(box);
    document.body.appendChild(box);
    banner = makeBanner();
    document.body.appendChild(banner);
    prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = PICK_CURSOR;
    addListeners();
  }

  function deactivate(): void {
    if (!active) return;
    active = false;
    removeListeners();
    if (box && box.parentNode) box.parentNode.removeChild(box);
    box = null;
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
    banner = null;
    document.documentElement.style.cursor = prevCursor;
    prevCursor = '';
  }

  function toggle(): boolean {
    if (active) deactivate();
    else activate();
    return active;
  }

  return {
    activate,
    deactivate,
    toggle,
    get active(): boolean {
      return active;
    },
  };
}
