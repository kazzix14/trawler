/** Interaction tracker (ISOLATED world).
 *
 * Registers capturing DOM listeners and emits one InteractionEvent per
 * meaningful user action: clicks, input/change with redacted values, focus,
 * meaningful keydowns (modifiers / navigation keys only), form submits, and a
 * throttled window scroll. Ordinary character typing is intentionally ignored
 * for keydown because it is already covered by the 'input' stream.
 *
 * DOM-only — no extension APIs.
 */
import type {
  ElementHint,
  InteractionAction,
  InteractionEvent,
  TimelineEvent,
} from '../types';
import { elementHint } from './element-serialize';
import { redactFieldValue, type FieldInfo } from '../redact';
import { uid } from '../id';
import { now } from '../time';
import { truncate } from '../text';

export interface InteractionTrackerOptions {
  onEvent: (e: TimelineEvent) => void;
  maskInputs: boolean;
}

const SCROLL_THROTTLE_MS = 250;
const VALUE_MAX_CHARS = 200;

/** Navigation / control keys worth recording even without a modifier held. */
const MEANINGFUL_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export function createInteractionTracker(opts: InteractionTrackerOptions): {
  start(): void;
  stop(): void;
} {
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  function emit(action: InteractionAction, target: ElementHint, extra: Partial<InteractionEvent> = {}): void {
    opts.onEvent({
      id: uid('evt'),
      kind: 'interaction',
      ts: now(),
      action,
      target,
      ...extra,
    });
  }

  /** Resolve the event target to an Element, or null when it is not one. */
  function targetElement(e: Event): Element | null {
    const t = e.target;
    return t instanceof Element ? t : null;
  }

  const onClick = (e: Event): void => {
    const el = targetElement(e);
    if (el) emit('click', elementHint(el));
  };

  const onInput = (e: Event): void => handleValueChange(e, 'input');
  const onChange = (e: Event): void => handleValueChange(e, 'change');

  function handleValueChange(e: Event, action: 'input' | 'change'): void {
    const el = targetElement(e);
    if (!el) return;
    const value = readRedactedValue(el, opts.maskInputs);
    emit(action, elementHint(el), value !== undefined ? { value } : {});
  }

  const onFocusIn = (e: Event): void => {
    const el = targetElement(e);
    if (el) emit('focus', elementHint(el));
  };

  const onKeyDown = (e: Event): void => {
    if (!(e instanceof KeyboardEvent)) return;
    const el = targetElement(e);
    if (!el) return;
    const combo = meaningfulKeyCombo(e);
    if (!combo) return;
    emit('keydown', elementHint(el), { key: combo });
  };

  const onSubmit = (e: Event): void => {
    const el = targetElement(e);
    if (el) emit('submit', elementHint(el));
  };

  const onScroll = (): void => {
    if (scrollTimer !== null) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      emit('scroll', scrollHint(), {
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
      });
    }, SCROLL_THROTTLE_MS);
  };

  return {
    start(): void {
      if (started) return;
      started = true;
      document.addEventListener('click', onClick, true);
      document.addEventListener('input', onInput, true);
      document.addEventListener('change', onChange, true);
      document.addEventListener('focusin', onFocusIn, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('submit', onSubmit, true);
      window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    },
    stop(): void {
      if (!started) return;
      started = false;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
    },
  };
}

/** Read and redact a form-field value; undefined when the element has none. */
function readRedactedValue(el: Element, maskInputs: boolean): string | undefined {
  if (!('value' in el)) return undefined;
  const raw = (el as { value?: unknown }).value;
  if (typeof raw !== 'string') return undefined;
  const field: FieldInfo = {
    type: el.getAttribute('type') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
  };
  return truncate(redactFieldValue(raw, field, maskInputs), VALUE_MAX_CHARS);
}

/**
 * Build a normalized key combo like "Ctrl+Enter" or "Meta+K", or null when the
 * keystroke is ordinary character typing (no modifier, not a control key).
 */
function meaningfulKeyCombo(e: KeyboardEvent): string | null {
  const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
  if (!hasModifier && !MEANINGFUL_KEYS.has(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(normalizeKey(e.key));
  return parts.join('+');
}

/** Present single printable characters in uppercase; pass named keys through. */
function normalizeKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Scroll events have no meaningful per-element target; describe the scrolling root. */
function scrollHint(): ElementHint {
  const el = document.scrollingElement ?? document.documentElement;
  if (el) return elementHint(el);
  return { tag: 'window' };
}
