// Owns line and inline visual helpers shared by paint, navigation, and hit-testing.
// Given a prepared `DocumentLayout` plus editor state where needed, these
// resolve small per-line metric helpers (visual-left, task checkbox bounds,
// inline image bounds).

import type { DocumentResources } from "@/types";
import {
  resolveRegion,
  type IndexedInline,
  type IndexedListItem,
  type EditorState,
} from "../../state";
import {
  ORDERED_LIST_MARKER_GAP,
  TASK_CHECKBOX_SIZE,
  UNORDERED_LIST_MARKER_GUTTER_INSET,
  UNORDERED_LIST_MARKER_SIZE,
} from "../lib/marker-metrics";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "../../text/measure";
import type { EditorLayoutState } from "../state";
import { resolveInlineImageDimensions } from "../measure/inline-image";
import type { DocumentLayout, LayoutLine } from "../measure";
import { findDocumentLayoutLineForRegionOffset, measureCanvasLineOffsetLeft } from "./line-lookup";

export type InlineBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function resolveLineVisualLeft(
  line: DocumentLayout["lines"][number],
  offset: number,
) {
  return measureCanvasLineOffsetLeft(line, offset) + line.contentInset;
}

export function resolveOrderedListMarkerAnchor(textLeft: number) {
  return textLeft - ORDERED_LIST_MARKER_GAP;
}

export function resolveTaskCheckboxBounds(line: LayoutLine) {
  return {
    left: line.left,
    size: TASK_CHECKBOX_SIZE,
    top: line.top + 3,
  };
}

export function resolveUnorderedListMarkerBounds(line: LayoutLine) {
  const size = UNORDERED_LIST_MARKER_SIZE;
  const centerY = resolveTextOpticalCenter(line);

  return {
    height: size,
    left: line.left - UNORDERED_LIST_MARKER_GUTTER_INSET,
    top: centerY - size / 2,
    width: size,
  };
}

export function resolveIndexedListItem(
  state: EditorState,
  listItemId: string,
): IndexedListItem | null {
  return state.documentIndex.listItems.get(listItemId) ?? null;
}

function resolveTextOpticalCenter(line: LayoutLine) {
  const baseline = line.top + resolveCenteredTextBaseline(line.height, line.font);
  const { ascent, descent } = resolveFontMetrics(line.font);

  // Small canvas-drawn markers look optically low when centered on font metrics.
  return baseline - (ascent - descent) / 2 - 1;
}

export function measureInlineImageBounds(
  state: EditorState,
  viewport: EditorLayoutState,
  resources: DocumentResources,
  run: IndexedInline,
): InlineBounds | null {
  const region = resolveRegion(state.documentIndex, state.selection.anchor.regionId);

  if (run.node.type !== "image" || !region) {
    return null;
  }

  const line = findDocumentLayoutLineForRegionOffset(viewport.layout, region.id, run.start);

  if (!line) {
    return null;
  }

  const textLeft = line.left + line.contentInset;
  const left = textLeft + measureCanvasLineOffsetLeft(line, run.start - line.start) - line.left;
  const right = textLeft + measureCanvasLineOffsetLeft(line, run.end - line.start) - line.left;
  const { height } = resolveInlineImageDimensions(run, resources, line.width);
  const top = line.top + Math.max(0, Math.floor((line.height - height) / 2));

  return { left, top, width: right - left, height };
}
