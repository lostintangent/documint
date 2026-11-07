// Owns large-document layout virtualization: whole-document height estimates,
// viewport slice selection, exact slice measurement, and refinement of cached
// estimates from measured geometry.

import type { DocumentResources } from "@/editor/resources";
import type { EditorState } from "../../state";
import { type LayoutCache, type VirtualLayout } from "../state/cache";
import type { DocumentLayoutOptions } from "../lib/options";
import { findVerticalRange } from "../lib/vertical-range";
import { measureBodyLayoutSlice, type DocumentLayout } from "../measure";
import { refineVirtualLayoutWithMeasuredSlice } from "./refinement";
import {
  expandViewportSliceToBlockBoundaries,
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
};

export function createVirtualizedLayoutSlice({
  cache,
  options,
  resources,
  state,
  viewport,
}: {
  cache: LayoutCache;
  options: DocumentLayoutOptions;
  resources: DocumentResources;
  state: EditorState;
  viewport: VirtualizedViewport;
}): VirtualizedLayoutSlice {
  const { documentIndex } = state;
  const expandedTop = Math.max(0, viewport.top - viewport.overscan);
  const expandedBottom = viewport.top + viewport.height + viewport.overscan;
  const virtualLayout = getOrCreateVirtualLayout(cache, documentIndex, options, resources);
  let { endIndex: sliceEndIndex, startIndex: sliceStartIndex } = findVerticalRange(
    virtualLayout.entries,
    expandedTop,
    expandedBottom,
    entryTop,
    entryBottom,
  );

  const pinTop = Math.max(0, expandedTop - viewport.overscan);
  const pinBottom = expandedBottom + viewport.overscan;
  const pinned = new Set([state.selection.anchor.path, state.selection.focus.path]);

  for (const path of pinned) {
    const index = virtualLayout.pathIndices.get(path);
    const entry = index === undefined ? undefined : virtualLayout.entries[index];

    if (index === undefined || !entry || entry.bottom < pinTop || entry.top > pinBottom) {
      continue;
    }

    sliceStartIndex = Math.min(sliceStartIndex, index);
    sliceEndIndex = Math.max(sliceEndIndex, index + 1);
  }

  const expandedSlice = expandViewportSliceToBlockBoundaries(
    documentIndex,
    virtualLayout,
    sliceStartIndex,
    sliceEndIndex,
  );
  // Seed measurement at the slice's document-space top so geometry is
  // produced directly in document coordinates — no post-shift needed.
  const sliceLayout = measureBodyLayoutSlice(
    documentIndex,
    options,
    cache,
    resources,
    expandedSlice.top ?? options.paddingY,
    expandedSlice.blockStartIndex,
    expandedSlice.blockEndIndex,
  );

  updateMeasuredContainerHeights(cache, documentIndex, sliceLayout, options, resources);
  refineVirtualLayoutWithMeasuredSlice(
    virtualLayout,
    sliceLayout,
    expandedSlice.entryStartIndex,
    expandedSlice.entryEndIndex,
  );

  // Override `height` with the refined full-document estimate so consumers
  // that read `layout.height` (scrollbars, paint extents) see the doc height,
  // not the slice height.
  return {
    estimatePathBounds: virtualLayout.estimatePathBounds,
    layout: { ...sliceLayout, height: virtualLayout.totalHeight },
  };
}

const entryTop = (entry: VirtualLayout["entries"][number]) => entry.top;
const entryBottom = (entry: VirtualLayout["entries"][number]) => entry.bottom;
