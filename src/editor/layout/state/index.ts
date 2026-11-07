// Owns viewport-aware layout orchestration. Small/common documents use exact
// full-document layout; larger documents use cheap whole-document estimates to
// choose the visible path slice, then run exact layout only for that slice.
import { emptyDocumentResources, type DocumentResources } from "@/editor/resources";
import type { EditorState } from "../../state";
import { createLayoutCache, trimLineBoundaries, type LayoutCache } from "./cache";
import {
  haveSameDocumentLayoutOptions,
  resolveDocumentLayoutOptions,
  type PartialDocumentLayoutOptions,
} from "../lib/options";
import { composeMetadataPrefix, measureLayoutSlice, type DocumentLayout } from "../measure";
import { measureMetadataPrefix } from "../measure/metadata";
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
  viewport: EditorViewport;
};

export function createEditorLayoutState(
  state: EditorState,
  options: PartialDocumentLayoutOptions & EditorViewport,
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
  let estimatePathBounds: (path: string) => { bottom: number; top: number } | null;
  const cached = cache.fullLayout;

  if (documentIndex.pathsWithTextCount <= FULL_LAYOUT_PATH_THRESHOLD) {
    // A full layout doesn't depend on the viewport, so a scroll reuses it.
    layout =
      cached?.documentIndex === documentIndex &&
      cached.resources === resolvedResources &&
      haveSameDocumentLayoutOptions(cached.layout.options, resolvedOptions)
        ? cached.layout
        : measureLayoutSlice(documentIndex, resolvedOptions, cache, resolvedResources);
    cache.fullLayout = { documentIndex, layout, resources: resolvedResources };
    estimatePathBounds = (path) => {
      const bounds = layout.pathBounds.get(path);

      return bounds ? { bottom: bounds.bottom, top: bounds.top } : null;
    };
  } else {
    const metadata = measureMetadataPrefix(
      documentIndex.document.metadata,
      resolvedOptions,
      cache,
      resolvedResources,
    );
    const bodyOffset = metadata?.bodyOffset ?? 0;
    const virtualized = createVirtualizedLayoutSlice({
      cache,
      options: resolvedOptions,
      resources: resolvedResources,
      state,
      viewport: {
        ...viewport,
        top: Math.max(0, viewport.top - bodyOffset),
      },
    });

    estimatePathBounds = (path) => {
      const metadataBounds = metadata?.pathBounds.get(path);
      if (metadataBounds) {
        return { bottom: metadataBounds.bottom, top: metadataBounds.top };
      }

      const bodyBounds = virtualized.estimatePathBounds(path);
      return bodyBounds
        ? {
            bottom: bodyBounds.bottom + bodyOffset,
            top: bodyBounds.top + bodyOffset,
          }
        : null;
    };
    layout = composeMetadataPrefix(virtualized.layout, metadata);
  }

  if (layout !== cached?.layout) {
    trimLineBoundaries(cache, layout);
  }

  return {
    estimatePathBounds,
    layout,
    paintHeight: Math.max(240, viewport.height + viewport.overscan * 2),
    paintTop: Math.max(0, viewport.top - viewport.overscan),
    viewport: {
      height: viewport.height,
      top: viewport.top,
      width: resolvedOptions.width,
    },
  };
}
