// Owns per-editor caches for layout measurement artifacts. The component host
// keeps one cache per editor instance and threads it through layout calls,
// without leaking that lifetime into the immutable editor model.

import type { PreparedTextWithSegments } from "@chenglou/pretext";
import type { DocumentResources } from "@/editor/resources";
import type { DocumentIndex } from "../../state";
import type { DocumentLayout, LineBoundary } from "../measure";
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

type MeasuredContainerHeight = {
  height: number;
  // `measuredContainerHeightWrites` when this height last moved to the newest
  // end of the cache.
  write: number;
};

export type LayoutCache = {
  fullLayout: {
    documentIndex: DocumentIndex;
    layout: DocumentLayout;
    resources: DocumentResources;
  } | null;
  graphemeWidths: Map<string, Map<string, number>>;
  lineBoundaries: Map<readonly MeasuredTextLine[], LineBoundary[][]>;
  measuredContainerHeights: Map<string, MeasuredContainerHeight>;
  measuredContainerHeightWrites: number;
  measuredLines: Map<string, MeasuredTextLine[]>;
  preparedText: Map<string, PreparedTextWithSegments>;
  virtualLayouts: WeakMap<DocumentIndex["blocks"], Map<string, VirtualLayout>>;
};

const MAX_PREPARED_TEXT_ENTRIES = 256;
const MAX_MEASURED_LINE_ENTRIES = 512;
const MAX_RETAINED_BOUNDARY_LINES = 1024;
const MAX_MEASURED_CONTAINER_HEIGHT_ENTRIES = 1024;
const MAX_GRAPHEME_FONT_ENTRIES = 64;

export function createLayoutCache(): LayoutCache {
  return {
    fullLayout: null,
    graphemeWidths: new Map(),
    lineBoundaries: new Map(),
    measuredContainerHeights: new Map(),
    measuredContainerHeightWrites: 0,
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

// Caret boundaries are cached per measured container, least recently used
// first. They're trimmed after a layout pass rather than on insert, and never
// for a container the new layout uses, so a layout with more lines than the
// budget keeps its own boundaries instead of evicting them on every pass.
export function getOrCreateLineBoundaries(
  cache: LayoutCache,
  lines: readonly MeasuredTextLine[],
  create: (line: MeasuredTextLine) => LineBoundary[],
) {
  const boundaries = cache.lineBoundaries.get(lines) ?? lines.map(create);

  cache.lineBoundaries.delete(lines);
  cache.lineBoundaries.set(lines, boundaries);

  return boundaries;
}

export function trimLineBoundaries(
  cache: LayoutCache,
  layout: { lines: readonly { boundaries: LineBoundary[] }[] },
) {
  let retainedLines = 0;

  for (const boundaries of cache.lineBoundaries.values()) {
    retainedLines += boundaries.length;
  }

  if (retainedLines <= MAX_RETAINED_BOUNDARY_LINES) {
    return;
  }

  const inUse = new Set(layout.lines.map((line) => line.boundaries));

  for (const [lines, boundaries] of cache.lineBoundaries) {
    if (retainedLines <= MAX_RETAINED_BOUNDARY_LINES) {
      return;
    }

    if (!boundaries.some((line) => inUse.has(line))) {
      cache.lineBoundaries.delete(lines);
      retainedLines -= boundaries.length;
    }
  }
}

export function getMeasuredContainerHeight(cache: LayoutCache, key: string) {
  return cache.measuredContainerHeights.get(key)?.height;
}

// Measured heights are evicted least recently measured first, but every layout
// pass re-measures the whole viewport slice, so refreshing each height on every
// pass would churn the map. An unchanged height only moves to the newest end
// once it has aged into the older half. A height re-measured at least once per
// half of the budget is therefore never evicted, while steady re-measurement
// stays a lookup.
export function cacheMeasuredContainerHeight(cache: LayoutCache, key: string, height: number) {
  const current = cache.measuredContainerHeights.get(key);
  const write = cache.measuredContainerHeightWrites;

  if (
    current?.height === height &&
    write - current.write < MAX_MEASURED_CONTAINER_HEIGHT_ENTRIES / 2
  ) {
    return;
  }

  cache.measuredContainerHeightWrites = write + 1;
  cacheBoundedValue(
    cache.measuredContainerHeights,
    key,
    { height, write },
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
  return cache.virtualLayouts.get(documentIndex.blocks)?.get(key) ?? null;
}

export function setVirtualLayout(
  cache: LayoutCache,
  documentIndex: DocumentIndex,
  key: string,
  value: VirtualLayout,
) {
  const current =
    cache.virtualLayouts.get(documentIndex.blocks) ?? new Map<string, VirtualLayout>();

  current.set(key, value);
  cache.virtualLayouts.set(documentIndex.blocks, current);

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
