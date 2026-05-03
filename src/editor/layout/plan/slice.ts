// Owns the slice-picking and post-exact processing the planner does once the
// plan exists: find the visible window in plan space, expand it so tables
// stay whole, shift the slice's local coordinates back into document space,
// and feed the measured heights back into the estimation cache so the next
// plan pass uses real numbers for previously-visible regions.

import type { DocumentResources } from "@/types";
import type { DocumentIndex } from "../../state";
import {
  cacheMeasuredContainerHeight,
  type CanvasRenderCache,
  type CanvasViewportPlan,
} from "../../canvas/lib/cache";
import type { DocumentLayoutOptions } from "../lib/options";
import type { DocumentLayout } from "../measure";
import { createContainerHeightCacheKey } from "./estimate";

export function findViewportPlanEntryIndexAtOrAfter(plan: CanvasViewportPlan, y: number) {
  let low = 0;
  let high = plan.entries.length;

  while (low < high) {
    const middle = (low + high) >> 1;
    const entry = plan.entries[middle]!;

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

export function shiftDocumentLayout(
  layout: DocumentLayout,
  topOffset: number,
  totalHeight: number,
): DocumentLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((block) => ({
      ...block,
      bottom: block.bottom + topOffset,
      top: block.top + topOffset,
    })),
    regionBounds: new Map(
      [...layout.regionBounds.entries()].map(([regionId, extent]) => [
        regionId,
        {
          bottom: extent.bottom + topOffset,
          left: extent.left,
          right: extent.right,
          top: extent.top + topOffset,
        },
      ]),
    ),
    height: totalHeight,
    lines: layout.lines.map((line) => ({
      ...line,
      top: line.top + topOffset,
    })),
  };
}

export function updateMeasuredContainerHeights(
  cache: CanvasRenderCache,
  documentIndex: DocumentIndex,
  layout: DocumentLayout,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width">,
  resources: DocumentResources,
) {
  for (const [regionId, extent] of layout.regionBounds) {
    const height = extent.bottom - extent.top;
    const container = documentIndex.regionIndex.get(regionId);

    cacheMeasuredContainerHeight(
      cache,
      createContainerHeightCacheKey(
        container ?? { path: regionId, inlines: [], text: "" },
        options,
        resources,
      ),
      height,
    );
  }
}
