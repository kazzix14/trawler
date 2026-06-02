/** DOM mutation observer (ISOLATED world).
 *
 * Watches the whole document for structural and attribute/text changes, then
 * coalesces the firehose of MutationRecords into ONE compact MutationEvent per
 * debounced flush. We accumulate counts plus a small sample of added element
 * tags and target selectors so the timeline stays cheap while still carrying
 * enough signal to correlate a render with surrounding events.
 *
 * DOM-only — no extension APIs, no top-level side effects.
 */
import type { MutationEvent, MutationSummary, TimelineEvent } from '../types';
import { uid } from '../id';
import { now } from '../time';
import { cssSelector } from './element-serialize';

export interface DomObserverOptions {
  onEvent: (e: TimelineEvent) => void;
  /** Debounce window before emitting a coalesced summary. Defaults to 1000ms. */
  flushMs?: number;
}

const DEFAULT_FLUSH_MS = 1000;
const SAMPLE_LIMIT = 5;

/** Mutable accumulator for one coalescing window. */
interface Accumulator {
  added: number;
  removed: number;
  attributes: number;
  characterData: number;
  sampleAddedTags: string[];
  sampleTargets: string[];
}

function emptyAccumulator(): Accumulator {
  return {
    added: 0,
    removed: 0,
    attributes: 0,
    characterData: 0,
    sampleAddedTags: [],
    sampleTargets: [],
  };
}

function sampleAdd(list: string[], value: string): void {
  if (list.length >= SAMPLE_LIMIT) return;
  if (list.includes(value)) return;
  list.push(value);
}

function recordTarget(acc: Accumulator, target: Node): void {
  if (target.nodeType !== 1 /* ELEMENT_NODE */) return;
  try {
    sampleAdd(acc.sampleTargets, cssSelector(target as Element));
  } catch {
    /* selector best-effort only */
  }
}

function recordAddedNodes(acc: Accumulator, nodes: NodeList): void {
  acc.added += nodes.length;
  for (const node of Array.from(nodes)) {
    if (node.nodeType === 1 /* ELEMENT_NODE */) {
      sampleAdd(acc.sampleAddedTags, (node as Element).tagName.toLowerCase());
    }
  }
}

function ingest(acc: Accumulator, record: MutationRecord): void {
  switch (record.type) {
    case 'childList':
      recordAddedNodes(acc, record.addedNodes);
      acc.removed += record.removedNodes.length;
      recordTarget(acc, record.target);
      break;
    case 'attributes':
      acc.attributes += 1;
      recordTarget(acc, record.target);
      break;
    case 'characterData':
      acc.characterData += 1;
      recordTarget(acc, record.target);
      break;
    default:
      break;
  }
}

function hasChanges(acc: Accumulator): boolean {
  return acc.added > 0 || acc.removed > 0 || acc.attributes > 0 || acc.characterData > 0;
}

function toSummary(acc: Accumulator): MutationSummary {
  const summary: MutationSummary = {
    added: acc.added,
    removed: acc.removed,
    attributes: acc.attributes,
    characterData: acc.characterData,
  };
  if (acc.sampleAddedTags.length > 0) summary.sampleAddedTags = acc.sampleAddedTags;
  if (acc.sampleTargets.length > 0) summary.sampleTargets = acc.sampleTargets;
  return summary;
}

export function createDomObserver(opts: DomObserverOptions): {
  start(): void;
  stop(): void;
} {
  const flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS;
  let observer: MutationObserver | null = null;
  let acc = emptyAccumulator();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    if (!hasChanges(acc)) {
      acc = emptyAccumulator();
      return;
    }
    const event: MutationEvent = {
      id: uid('evt'),
      kind: 'mutation',
      ts: now(),
      summary: toSummary(acc),
    };
    acc = emptyAccumulator();
    opts.onEvent(event);
  };

  const scheduleFlush = (): void => {
    if (timer !== null) return;
    timer = setTimeout(flush, flushMs);
  };

  const handleRecords = (records: MutationRecord[]): void => {
    for (const record of records) ingest(acc, record);
    scheduleFlush();
  };

  return {
    start(): void {
      if (observer) return;
      observer = new MutationObserver(handleRecords);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    },
    stop(): void {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      acc = emptyAccumulator();
    },
  };
}
