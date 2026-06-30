// Owns per-editor caches for layout measurement artifacts. The component host
// keeps one cache per editor instance and threads it through layout calls,
// without leaking that lifetime into the immutable editor model.

import type { PreparedTextWithSegments } from "@chenglou/pretext";
import type { DocumentIndex } from "../../state";
import type { LineBoundary } from "../measure";
import type { MeasuredTextLine } from "../measure/text";

export type VirtualLayout = {
  pathIndices: Map<string, number>;
  entries: Array<{
    blockArrayIndex: number;
    bottom: number;
    path: string;
    top: number;
  }>;
  estimatePathBounds: (path: string) => { bottom: number; top: number } | null;
  totalHeight: number;
};

export type LayoutCache = {
  graphemeWidths: Map<string, Map<string, number>>;
  lineBoundaries: Map<string, LineBoundary[]>;
  measuredContainerHeights: Map<string, number>;
  measuredLines: Map<string, MeasuredTextLine[]>;
  preparedText: Map<string, PreparedTextWithSegments>;
  virtualLayouts: WeakMap<DocumentIndex, Map<string, VirtualLayout>>;
};

const MAX_PREPARED_TEXT_ENTRIES = 256;
const MAX_MEASURED_LINE_ENTRIES = 512;
const MAX_LINE_BOUNDARY_ENTRIES = 1024;
const MAX_MEASURED_CONTAINER_HEIGHT_ENTRIES = 1024;
const MAX_GRAPHEME_FONT_ENTRIES = 64;

export function createLayoutCache(): LayoutCache {
  return {
    graphemeWidths: new Map(),
    lineBoundaries: new Map(),
    measuredContainerHeights: new Map(),
    measuredLines: new Map(),
    preparedText: new Map(),
    virtualLayouts: new WeakMap(),
  };
}

export function cachePreparedText(
  cache: LayoutCache,
  key: string,
  value: PreparedTextWithSegments,
) {
  return cacheBoundedValue(cache.preparedText, key, value, MAX_PREPARED_TEXT_ENTRIES);
}

export function cacheMeasuredLines(cache: LayoutCache, key: string, value: MeasuredTextLine[]) {
  return cacheBoundedValue(cache.measuredLines, key, value, MAX_MEASURED_LINE_ENTRIES);
}

export function cacheLineBoundaries(cache: LayoutCache, key: string, value: LineBoundary[]) {
  return cacheBoundedValue(cache.lineBoundaries, key, value, MAX_LINE_BOUNDARY_ENTRIES);
}

export function cacheMeasuredContainerHeight(cache: LayoutCache, key: string, value: number) {
  return cacheBoundedValue(
    cache.measuredContainerHeights,
    key,
    value,
    MAX_MEASURED_CONTAINER_HEIGHT_ENTRIES,
  );
}

export function getOrCreateGraphemeWidthCache(cache: LayoutCache, font: string) {
  const existing = cache.graphemeWidths.get(font);

  if (existing) {
    return existing;
  }

  const next = new Map<string, number>();
  cacheBoundedValue(cache.graphemeWidths, font, next, MAX_GRAPHEME_FONT_ENTRIES);

  return next;
}

export function getVirtualLayout(cache: LayoutCache, documentIndex: DocumentIndex, key: string) {
  return cache.virtualLayouts.get(documentIndex)?.get(key) ?? null;
}

export function setVirtualLayout(
  cache: LayoutCache,
  documentIndex: DocumentIndex,
  key: string,
  value: VirtualLayout,
) {
  const current = cache.virtualLayouts.get(documentIndex) ?? new Map<string, VirtualLayout>();

  current.set(key, value);
  cache.virtualLayouts.set(documentIndex, current);

  return value;
}

function cacheBoundedValue<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
  maxEntries: number,
) {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, value);

  if (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as Key | undefined;

    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }

  return value;
}
