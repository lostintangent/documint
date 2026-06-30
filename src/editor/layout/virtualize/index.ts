// Owns large-document layout virtualization: whole-document height estimates,
// viewport slice selection, exact slice measurement, and refinement of cached
// estimates from measured geometry.

import type { DocumentResources } from "@/types";
import { type DocumentIndex, type EditorState } from "../../state";
import { type LayoutCache } from "../state/cache";
import type { DocumentLayoutOptions } from "../lib/options";
import { measureLayoutSlice, type DocumentLayout } from "../measure";
import { refineVirtualLayoutWithMeasuredSlice } from "./refinement";
import {
  expandViewportSliceToBlockBoundaries,
  findVirtualLayoutEntryIndexAtOrAfter,
  updateMeasuredContainerHeights,
} from "./viewport-slice";
import { getOrCreateVirtualLayout } from "./virtual-layout";

type VirtualizedViewport = {
  height: number;
  overscan: number;
  top: number;
};

export type VirtualizedLayoutSlice = {
  estimatePathBounds: (path: string) => { bottom: number; top: number } | null;
  layout: DocumentLayout;
  totalHeight: number;
};

export function createVirtualizedLayoutSlice({
  cache,
  documentIndex,
  options,
  resources,
  state,
  viewport,
}: {
  cache: LayoutCache;
  documentIndex: DocumentIndex;
  options: DocumentLayoutOptions;
  resources: DocumentResources;
  state: EditorState;
  viewport: VirtualizedViewport;
}): VirtualizedLayoutSlice {
  const expandedTop = Math.max(0, viewport.top - viewport.overscan);
  const expandedBottom = viewport.top + viewport.height + viewport.overscan;
  const virtualLayout = getOrCreateVirtualLayout(cache, documentIndex, options, resources);
  let sliceStartIndex = findVirtualLayoutEntryIndexAtOrAfter(virtualLayout, expandedTop);
  let sliceEndIndex = findVirtualLayoutEntryIndexAtOrAfter(virtualLayout, expandedBottom);

  if (sliceStartIndex > 0) {
    const previous = virtualLayout.entries[sliceStartIndex - 1];

    if (previous && previous.bottom > expandedTop) {
      sliceStartIndex -= 1;
    }
  }

  if (sliceEndIndex < virtualLayout.entries.length) {
    const next = virtualLayout.entries[sliceEndIndex];

    if (next && next.top < expandedBottom) {
      sliceEndIndex += 1;
    }
  }

  const pinTop = Math.max(0, expandedTop - viewport.overscan);
  const pinBottom = expandedBottom + viewport.overscan;
  const pinned = new Set([state.selection.anchor.path, state.selection.focus.path]);

  for (const path of pinned) {
    const index = virtualLayout.pathIndices.get(path);
    const bounds = virtualLayout.estimatePathBounds(path);

    if (index === undefined || !bounds) {
      continue;
    }

    if (bounds.bottom < pinTop || bounds.top > pinBottom) {
      continue;
    }

    sliceStartIndex = Math.min(sliceStartIndex, index);
    sliceEndIndex = Math.max(sliceEndIndex, index + 1);
  }

  let layout: DocumentLayout;

  if (!Number.isFinite(sliceStartIndex) || !Number.isFinite(sliceEndIndex)) {
    layout = measureLayoutSlice(documentIndex, options, cache, resources, undefined, 0, 0);
  } else {
    const expandedSlice = expandViewportSliceToBlockBoundaries(
      documentIndex,
      virtualLayout,
      sliceStartIndex,
      sliceEndIndex,
    );
    const sliceTop = expandedSlice.top ?? options.paddingY;
    // Seed measurement at the slice's document-space top so geometry is
    // produced directly in document coordinates — no post-shift needed.
    // Override `height` with the full-document estimate so consumers that
    // read `layout.height` (scrollbars, paint extents) see the doc height,
    // not the slice height.
    const sliceLayout = measureLayoutSlice(
      documentIndex,
      options,
      cache,
      resources,
      sliceTop,
      expandedSlice.blockStartIndex,
      expandedSlice.blockEndIndex,
    );

    layout = { ...sliceLayout, height: virtualLayout.totalHeight };

    updateMeasuredContainerHeights(cache, documentIndex, layout, options, resources);

    if (refineVirtualLayoutWithMeasuredSlice(virtualLayout, layout)) {
      layout = {
        ...layout,
        height: virtualLayout.totalHeight,
      };
    }
  }

  return {
    estimatePathBounds: virtualLayout.estimatePathBounds,
    layout,
    totalHeight: virtualLayout.totalHeight,
  };
}
