// Owns large-document slice picking and post-exact processing: find the visible
// window in estimate space, expand it so tables stay whole, and feed measured
// heights back into the cache so subsequent estimates use real numbers for
// visible paths. The slice is measured directly in document space (via
// `measureLayoutSlice`'s `startY`), so no coordinate shift is needed here.

import type { DocumentResources } from "@/types";
import type { DocumentIndex } from "../../state";
import { cacheMeasuredContainerHeight, type LayoutCache, type VirtualLayout } from "../state/cache";
import { resolveBlockContentMetrics } from "../lib/content-metrics";
import type { DocumentLayoutOptions } from "../lib/options";
import type { DocumentLayout } from "../measure";
import { resolveLayoutTextInputAtPath } from "../measure/text-input";
import { createContainerHeightCacheKey } from "./height-estimate";

export function findVirtualLayoutEntryIndexAtOrAfter(virtualLayout: VirtualLayout, y: number) {
  let low = 0;
  let high = virtualLayout.entries.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const entry = virtualLayout.entries[middle]!;

    if (entry.bottom <= y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

export function expandViewportSliceToBlockBoundaries(
  documentIndex: DocumentIndex,
  virtualLayout: VirtualLayout,
  startIndex: number,
  endIndex: number,
) {
  let blockStartIndex = Number.POSITIVE_INFINITY;
  let blockEndIndex = Number.NEGATIVE_INFINITY;
  let top: number | null = null;

  for (let index = startIndex; index < endIndex; index += 1) {
    const entry = virtualLayout.entries[index];
    const block = entry ? documentIndex.blocks[entry.blockArrayIndex] : null;

    if (!entry || !block) {
      continue;
    }

    top = top === null ? entry.top : Math.min(top, entry.top);
    blockStartIndex = Math.min(blockStartIndex, block.blockArrayIndex);
    blockEndIndex = Math.max(blockEndIndex, block.blockRangeEnd);
  }

  return {
    blockEndIndex: Number.isFinite(blockEndIndex) ? blockEndIndex : 0,
    blockStartIndex: Number.isFinite(blockStartIndex) ? blockStartIndex : 0,
    top: Number.isFinite(blockStartIndex) && Number.isFinite(blockEndIndex)
      ? resolveExpandedSliceTop(virtualLayout, blockStartIndex, blockEndIndex) ?? top
      : top,
  };
}

function resolveExpandedSliceTop(
  virtualLayout: VirtualLayout,
  blockStartIndex: number,
  blockEndIndex: number,
) {
  for (const entry of virtualLayout.entries) {
    if (entry.blockArrayIndex >= blockStartIndex && entry.blockArrayIndex < blockEndIndex) {
      return entry.top;
    }
  }

  return null;
}

export function updateMeasuredContainerHeights(
  cache: LayoutCache,
  documentIndex: DocumentIndex,
  layout: DocumentLayout,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  for (const [path, extent] of layout.pathBounds) {
    const height = extent.bottom - extent.top;
    const resolved = resolveLayoutTextInputAtPath(documentIndex, path);
    if (!resolved) continue;
    // Mirror the metrics applied when estimating this path —
    // otherwise the cache key for the measured height won't match the
    // cache key the next estimate pass looks up, defeating the cache.
    const contentMetrics = resolveBlockContentMetrics(documentIndex, resolved.indexedBlock, options);

    cacheMeasuredContainerHeight(
      cache,
      createContainerHeightCacheKey(resolved.input, contentMetrics, options, resources),
      height,
    );
  }
}
