// Owns large-document slice picking and post-exact processing: find the visible
// window in estimate space, expand it so tables stay whole, and feed measured
// heights back into the cache so subsequent estimates use real numbers for
// visible regions. The slice is measured directly in document space (via
// `measureLayoutSlice`'s `startY`), so no coordinate shift is needed here.

import type { DocumentResources } from "@/types";
import type { DocumentIndex } from "../../state";
import { cacheMeasuredContainerHeight, type LayoutCache, type VirtualLayout } from "../state/cache";
import { resolveListMarkerInset } from "../lib/geometry";
import type { DocumentLayoutOptions } from "../lib/options";
import type { DocumentLayout } from "../measure";
import { createContainerHeightCacheKey } from "./estimate";

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
  runtimeBlocks: Map<string, DocumentIndex["blocks"][number]>,
  containerIndices: Map<string, number>,
  startIndex: number,
  endIndex: number,
) {
  let nextStartIndex = startIndex;
  let nextEndIndex = endIndex;

  for (let index = startIndex; index < endIndex; index += 1) {
    const container = documentIndex.regions[index]!;
    const block = runtimeBlocks.get(container.blockId);

    if (!block) {
      continue;
    }

    if (block.type === "table") {
      const firstIndex = containerIndices.get(block.regionIds[0] ?? "");
      const lastIndex = containerIndices.get(block.regionIds[block.regionIds.length - 1] ?? "");

      if (firstIndex !== undefined) {
        nextStartIndex = Math.min(nextStartIndex, firstIndex);
      }

      if (lastIndex !== undefined) {
        nextEndIndex = Math.max(nextEndIndex, lastIndex + 1);
      }
    }
  }

  return {
    endIndex: nextEndIndex,
    startIndex: nextStartIndex,
  };
}

export function updateMeasuredContainerHeights(
  cache: LayoutCache,
  documentIndex: DocumentIndex,
  layout: DocumentLayout,
  options: DocumentLayoutOptions,
  resources: DocumentResources,
) {
  for (const [regionId, extent] of layout.regionBounds) {
    const height = extent.bottom - extent.top;
    const container = documentIndex.regionIndex.get(regionId);
    // Mirror the inset applied when estimating this region —
    // otherwise the cache key for the measured height won't match the
    // cache key the next estimate pass looks up, defeating the cache.
    const listInset = container ? resolveListMarkerInset(documentIndex, container.blockId) : 0;

    cacheMeasuredContainerHeight(
      cache,
      createContainerHeightCacheKey(
        container ?? { path: regionId, inlines: [], text: "" },
        listInset,
        options,
        resources,
      ),
      height,
    );
  }
}
