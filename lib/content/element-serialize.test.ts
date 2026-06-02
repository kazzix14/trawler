import { describe, it, expect, beforeEach } from 'vitest';
import {
  ariaAttrs,
  cssSelector,
  dataAttrs,
  elementHint,
  elidedOuterHtml,
  htmlLineOf,
  leafText,
  markedElement,
  startTag,
} from './element-serialize';

function el(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild as Element;
}

describe('startTag', () => {
  it('includes all attributes', () => {
    const e = el('<div class="cart-total" data-controller="cart" id="total">x</div>');
    expect(startTag(e)).toBe('<div class="cart-total" data-controller="cart" id="total">');
  });
  it('escapes quotes in attribute values', () => {
    const e = el('<a title=\'say "hi"\'>x</a>');
    expect(startTag(e)).toContain('&quot;hi&quot;');
  });
});

describe('leafText', () => {
  it('returns only direct text, not descendant text', () => {
    const e = el('<div>Hello <span>world</span></div>');
    expect(leafText(e)).toBe('Hello');
  });
  it('returns undefined when there is no direct text', () => {
    const e = el('<div><span>x</span></div>');
    expect(leafText(e)).toBeUndefined();
  });
});

describe('elidedOuterHtml (ADR Decision 4)', () => {
  it('elides child subtree with ... and keeps leaf text', () => {
    const e = el('<div class="cart-total" id="total"><span>1</span><span>2</span></div>');
    expect(elidedOuterHtml(e)).toBe('<div class="cart-total" id="total">...</div>');
  });
  it('keeps leaf text for leaf elements', () => {
    const e = el('<button data-action="cart#add">カートに追加</button>');
    expect(elidedOuterHtml(e)).toBe('<button data-action="cart#add">カートに追加</button>');
  });
  it('renders void elements as the start tag only', () => {
    const e = el('<input type="text" name="q">');
    expect(elidedOuterHtml(e)).toBe('<input type="text" name="q">');
  });
});

describe('data/aria attribute extraction', () => {
  it('collects data-* and aria-*/role', () => {
    const e = el('<div data-x="1" data-y="2" aria-label="L" role="button" class="c">x</div>');
    expect(dataAttrs(e)).toEqual({ 'data-x': '1', 'data-y': '2' });
    expect(ariaAttrs(e)).toEqual({ 'aria-label': 'L', role: 'button' });
  });
});

describe('cssSelector', () => {
  it('short-circuits on id', () => {
    const e = el('<div id="total">x</div>');
    expect(cssSelector(e)).toBe('#total');
  });
  it('builds a class/tag path without id', () => {
    const e = el('<section><button class="add">x</button></section>');
    const btn = document.querySelector('button')!;
    expect(cssSelector(btn)).toContain('button.add');
  });
});

describe('htmlLineOf', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });
  it('finds the 1-based line of the opening tag in the serialized DOM', () => {
    document.body.innerHTML = '\n<div id="wrap">\n  <button id="go">Go</button>\n</div>\n';
    const btn = document.getElementById('go')!;
    const { line, content } = htmlLineOf(btn);
    expect(line).toBeGreaterThan(1);
    expect(content).toContain('<button id="go">');
  });
});

describe('markedElement / elementHint', () => {
  it('assembles a full marked element', () => {
    const e = el('<button data-action="cart#add" class="btn primary">Add</button>');
    const m = markedElement(e);
    expect(m.startTag).toContain('data-action="cart#add"');
    expect(m.leafText).toBe('Add');
    expect(m.classes).toEqual(['btn', 'primary']);
    expect(m.dataAttrs).toEqual({ 'data-action': 'cart#add' });
    expect(m.elidedOuterHtml).toBe('<button data-action="cart#add" class="btn primary">Add</button>');
  });
  it('builds a brief hint', () => {
    const e = el('<a id="home" class="nav link" data-x="1">Home</a>');
    const h = elementHint(e);
    expect(h.tag).toBe('a');
    expect(h.id).toBe('home');
    expect(h.text).toBe('Home');
    expect(h.attrs).toMatchObject({ 'data-x': '1' });
  });
});
