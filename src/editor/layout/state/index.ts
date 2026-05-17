// Owns viewport-aware layout orchestration. Small/common documents use exact
// full-document layout; larger documents use cheap whole-document estimates to
// choose the visible region slice, then run exact layout only for that slice.
import type { Block } from "@/document";
import type { DocumentResources } from "@/types";
import type { EditorState } from "../../state";
import { createLayoutCache, type LayoutCache } from "./cache";
import { resolveDocumentLayoutOptions, type DocumentLayoutOptions } from "../lib/options";
import { buildDocumentBlockMap, measureLayoutSlice, type DocumentLayout } from "../measure";
import { createVirtualizedLayoutSlice } from "../virtualize";

const FULL_LAYOUT_REGION_THRESHOLD = 96;

type CanvasViewport = {
  height: number;
  overscan: number;
  top: number;
};

export type EditorViewport = {
  height: number;
  top: number;
};

export type EditorLayoutState = {
  estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;
  layout: DocumentLayout;
  paintHeight: number;
  paintTop: number;
  totalHeight: number;
  viewport: EditorViewport;
  blockMap: Map<string, Block>;
};

export function createEditorLayoutState(
  state: EditorState,
  options: Partial<DocumentLayoutOptions> & Pick<DocumentLayoutOptions, "width"> & EditorViewport,
  cache: LayoutCache = createLayoutCache(),
  resources: DocumentResources | null = null,
): EditorLayoutState {
  // Resolve options once at this public boundary; every internal helper
  // takes a full `DocumentLayoutOptions` so virtual layout / measure / cache key
  // can never silently disagree with measure on a default value.
  const viewport: CanvasViewport = {
    height: options.height,
    overscan: Math.max(160, options.height),
    top: options.top,
  };
  const documentIndex = state.documentIndex;
  const resolvedOptions = resolveDocumentLayoutOptions(options);
  const resolvedResources: DocumentResources = resources ?? { images: new Map() };
  const blockMap = buildDocumentBlockMap(documentIndex.document.blocks);
  // documentIndex.blockIndex is already `Map<string, EditorBlock>` keyed by
  // block id — exactly what we need. Reusing it skips a per-call O(N) Map
  // rebuild that contributed measurable cost on long-doc keystrokes.
  const runtimeBlocks = documentIndex.blockIndex;
  let layout: DocumentLayout;
  let totalHeight: number;
  let estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;

  if (documentIndex.regions.length <= FULL_LAYOUT_REGION_THRESHOLD) {
    layout = measureLayoutSlice(documentIndex, resolvedOptions, cache, resolvedResources, blockMap);
    totalHeight = layout.height;
    estimateRegionBounds = (regionId) => {
      const bounds = layout.regionBounds.get(regionId);

      return bounds ? { bottom: bounds.bottom, top: bounds.top } : null;
    };
  } else {
    const virtualized = createVirtualizedLayoutSlice({
      blockMap,
      cache,
      documentIndex,
      options: resolvedOptions,
      resources: resolvedResources,
      runtimeBlocks,
      state,
      viewport,
    });

    estimateRegionBounds = virtualized.estimateRegionBounds;
    layout = virtualized.layout;
    totalHeight = virtualized.totalHeight;
  }

  return {
    blockMap,
    estimateRegionBounds,
    layout,
    paintHeight: Math.max(240, viewport.height + viewport.overscan * 2),
    paintTop: Math.max(0, viewport.top - viewport.overscan),
    totalHeight,
    viewport: {
      height: viewport.height,
      top: viewport.top,
    },
  };
}
