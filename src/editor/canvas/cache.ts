// Owns per-editor render caches for measured layout artifacts. The render
// pipeline can reuse these across viewport/layout passes without leaking that
// lifetime into the editor model or relying on process-global state.

import type { PreparedTextWithSegments } from "@chenglou/pretext";
import type { DocumentIndex } from "../state";
import type { LineBoundary } from "../layout";

export type CanvasViewportPlan = {
  containerIndices: Map<string, number>;
  entries: Array<{
    bottom: number;
    top: number;
  }>;
  estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;
  totalHeight: number;
};

export type CanvasRenderCache = {
  graphemeWidths: Map<string, Map<string, number>>;
  lineBoundaries: Map<string, LineBoundary[]>;
  measuredContainerHeights: Map<string, number>;
  measuredLines: Map<
    string,
    Array<{
      end: number;
      height: number;
      start: number;
      text: string;
      width: number;
    }>
  >;
  preparedText: Map<string, PreparedTextWithSegments>;
  viewportPlans: WeakMap<DocumentIndex, Map<string, CanvasViewportPlan>>;
};

const MAX_PREPARED_TEXT_ENTRIES = 256;
const MAX_MEASURED_LINE_ENTRIES = 512;
const MAX_LINE_BOUNDARY_ENTRIES = 1024;
const MAX_MEASURED_CONTAINER_HEIGHT_ENTRIES = 1024;
const MAX_GRAPHEME_FONT_ENTRIES = 64;

export function createCanvasRenderCache(): CanvasRenderCache {
  return {
    graphemeWidths: new Map(),
    lineBoundaries: new Map(),
    measuredContainerHeights: new Map(),
    measuredLines: new Map(),
    preparedText: new Map(),
    viewportPlans: new WeakMap(),
  };
}

export function cachePreparedText(
  cache: CanvasRenderCache,
  key: string,
  value: PreparedTextWithSegments,
) {
  return cacheBoundedValue(cache.preparedText, key, value, MAX_PREPARED_TEXT_ENTRIES);
}

export function cacheMeasuredLines(
  cache: CanvasRenderCache,
  key: string,
  value: Array<{
    end: number;
    height: number;
    start: number;
    text: string;
    width: number;
  }>,
) {
  return cacheBoundedValue(cache.measuredLines, key, value, MAX_MEASURED_LINE_ENTRIES);
}

export function cacheLineBoundaries(cache: CanvasRenderCache, key: string, value: LineBoundary[]) {
  return cacheBoundedValue(cache.lineBoundaries, key, value, MAX_LINE_BOUNDARY_ENTRIES);
}

export function cacheMeasuredContainerHeight(cache: CanvasRenderCache, key: string, value: number) {
  return cacheBoundedValue(
    cache.measuredContainerHeights,
    key,
    value,
    MAX_MEASURED_CONTAINER_HEIGHT_ENTRIES,
  );
}

export function getOrCreateGraphemeWidthCache(cache: CanvasRenderCache, font: string) {
  const existing = cache.graphemeWidths.get(font);

  if (existing) {
    return existing;
  }

  const next = new Map<string, number>();
  cacheBoundedValue(cache.graphemeWidths, font, next, MAX_GRAPHEME_FONT_ENTRIES);

  return next;
}

export function getViewportPlan(
  cache: CanvasRenderCache,
  documentIndex: DocumentIndex,
  key: string,
) {
  return cache.viewportPlans.get(documentIndex)?.get(key) ?? null;
}

export function setViewportPlan(
  cache: CanvasRenderCache,
  documentIndex: DocumentIndex,
  key: string,
  value: CanvasViewportPlan,
) {
  const current = cache.viewportPlans.get(documentIndex) ?? new Map<string, CanvasViewportPlan>();

  current.set(key, value);
  cache.viewportPlans.set(documentIndex, current);

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
