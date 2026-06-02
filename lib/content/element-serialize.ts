/** Element fingerprinting for marks and interaction targets (ADR Decision 4).
 *
 * Captures rich, browser-side hints — opening tag (all attributes), leaf text,
 * selector, data- and aria- attributes, and a best-effort HTML line — so Claude
 * Code can grep the repository for the source. Source resolution is deliberately
 * NOT done here.
 *
 * DOM-only (no extension APIs); unit-testable under jsdom.
 */
import type { ElementHint, MarkedElement } from '../types';
import { collapseWhitespace } from '../text';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const LEAF_TEXT_MAX = 80;
const HTML_LINE_MAX = 400;

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/([^\w-])/g, '\\$1');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** Opening tag with all attributes, human-readable. */
export function startTag(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}="${escapeAttr(a.value)}"`)
    .join(' ');
  return attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
}

/** Direct (leaf) text only — never descendant text. Collapsed and clipped. */
export function leafText(el: Element): string | undefined {
  let text = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) text += node.textContent ?? '';
  }
  const t = collapseWhitespace(text);
  if (!t) return undefined;
  return t.length > LEAF_TEXT_MAX ? `${t.slice(0, LEAF_TEXT_MAX)}…` : t;
}

/** start tag + `...` (children elided) + leaf text kept (ADR Decision 4). */
export function elidedOuterHtml(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const open = startTag(el);
  if (VOID_ELEMENTS.has(tag)) return open;
  const text = leafText(el);
  const hasChildren = el.children.length > 0;
  let inner: string;
  if (hasChildren) inner = text ? `${text}...` : '...';
  else inner = text ?? '';
  return `${open}${inner}</${tag}>`;
}

export function dataAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith('data-')) out[a.name] = a.value;
  }
  return out;
}

export function ariaAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith('aria-') || a.name === 'role') out[a.name] = a.value;
  }
  return out;
}

/** Best-effort, reasonably-unique CSS selector (id short-circuits the path). */
export function cssSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < 5) {
    if (cur.id) {
      parts.unshift(`#${cssEscape(cur.id)}`);
      break;
    }
    let sel = cur.tagName.toLowerCase();
    sel += Array.from(cur.classList)
      .slice(0, 2)
      .map((c) => `.${cssEscape(c)}`)
      .join('');
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const tag = cur.tagName;
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === tag);
      if (sameTag.length > 1) sel += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
    }
    parts.unshift(sel);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

/** 1-based line of the element's opening tag within the serialized document. */
export function htmlLineOf(el: Element): { line?: number; content?: string } {
  try {
    const doc = el.ownerDocument;
    const root = doc?.documentElement;
    if (!root) return {};
    const html = root.outerHTML;
    const outer = el.outerHTML;
    const gt = outer.indexOf('>');
    const open = gt >= 0 ? outer.slice(0, gt + 1) : outer;
    const idx = html.indexOf(open);
    if (idx < 0) return {};
    const line = html.slice(0, idx).split('\n').length;
    const lineStart = html.lastIndexOf('\n', idx) + 1;
    const lineEndRaw = html.indexOf('\n', idx);
    const lineEnd = lineEndRaw < 0 ? html.length : lineEndRaw;
    const lineText = html.slice(lineStart, lineEnd).trimStart();
    const content = lineText.length <= HTML_LINE_MAX ? lineText : open;
    return { line, content };
  } catch {
    return {};
  }
}

/** Rich descriptor produced by the picker. */
export function markedElement(el: Element): MarkedElement {
  const { line, content } = htmlLineOf(el);
  return {
    startTag: startTag(el),
    elidedOuterHtml: elidedOuterHtml(el),
    selector: cssSelector(el),
    id: el.id || undefined,
    classes: Array.from(el.classList),
    dataAttrs: dataAttrs(el),
    ariaAttrs: ariaAttrs(el),
    leafText: leafText(el),
    htmlLine: line,
    htmlLineContent: content,
  };
}

/** Brief descriptor attached to interaction events. */
export function elementHint(el: Element): ElementHint {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (
      a.name.startsWith('data-') ||
      a.name.startsWith('aria-') ||
      a.name === 'role' ||
      a.name === 'name' ||
      a.name === 'type'
    ) {
      attrs[a.name] = a.value;
    }
  }
  const classes = Array.from(el.classList);
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classes: classes.length ? classes.slice(0, 4) : undefined,
    selector: cssSelector(el),
    text: leafText(el),
    attrs: Object.keys(attrs).length ? attrs : undefined,
  };
}
