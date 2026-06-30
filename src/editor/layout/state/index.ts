// Owns viewport-aware layout orchestration. Small/common documents use exact
// full-document layout; larger documents use cheap whole-document estimates to
// choose the visible path slice, then run exact layout only for that slice.
import type { DocumentResources } from "@/types";
import { emptyDocumentResources } from "@/editor/resources";
import { countEditorPathsWithText, type EditorState } from "../../state";
import { createLayoutCache, type LayoutCache } from "./cache";
import { resolveDocumentLayoutOptions, type DocumentLayoutOptions } from "../lib/options";
import { measureLayoutSlice, type DocumentLayout } from "../measure";
import { createVirtualizedLayoutSlice } from "../virtualize";

const FULL_LAYOUT_PATH_THRESHOLD = 96;

type CanvasViewport = {
  height: number;
  overscan: number;
  top: number;
};

export type EditorViewport = {
  height: number;
  top: number;
  width: number;
};

export type EditorLayoutState = {
  estimatePathBounds: (path: string) => { bottom: number; top: number } | null;
  layout: DocumentLayout;
  paintHeight: number;
  paintTop: number;
  totalHeight: number;
  viewport: EditorViewport;
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
  const resolvedResources: DocumentResources = resources ?? emptyDocumentResources;
  let layout: DocumentLayout;
  let totalHeight: number;
  let estimatePathBounds: (path: string) => { bottom: number; top: number } | null;

  if (countEditorPathsWithText(documentIndex) <= FULL_LAYOUT_PATH_THRESHOLD) {
    layout = measureLayoutSlice(documentIndex, resolvedOptions, cache, resolvedResources);
    totalHeight = layout.height;
    estimatePathBounds = (path) => {
      const bounds = layout.pathBounds.get(path);

      return bounds ? { bottom: bounds.bottom, top: bounds.top } : null;
    };
  } else {
    const virtualized = createVirtualizedLayoutSlice({
      cache,
      documentIndex,
      options: resolvedOptions,
      resources: resolvedResources,
      state,
      viewport,
    });

    estimatePathBounds = virtualized.estimatePathBounds;
    layout = virtualized.layout;
    totalHeight = virtualized.totalHeight;
  }

  return {
    estimatePathBounds,
    layout,
    paintHeight: Math.max(240, viewport.height + viewport.overscan * 2),
    paintTop: Math.max(0, viewport.top - viewport.overscan),
    totalHeight,
    viewport: {
      height: viewport.height,
      top: viewport.top,
      width: resolvedOptions.width,
    },
  };
}
