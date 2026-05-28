// Owns line and inline visual helpers shared by paint, navigation, and hit-testing.
// Given a prepared `DocumentLayout` plus editor state, these resolve content
// insets (e.g. list-marker indent) and small per-line metric helpers
// (visual-left, task checkbox bounds, inline image bounds). Ancestry walks
// live in `editor/state` (`findAncestorIndexedBlock`) — layout consumes them
// as a primitive.

import type { DocumentResources } from "@/types";
import {
  findAncestorIndexedBlock,
  resolveRegion,
  type IndexedInline,
  type IndexedListItem,
  type EditorState,
} from "../../state";
import {
  LIST_MARKER_TEXT_INSET,
  ORDERED_LIST_MARKER_GAP,
  TASK_CHECKBOX_SIZE,
  TASK_MARKER_TEXT_INSET,
  UNORDERED_LIST_MARKER_GUTTER_INSET,
  UNORDERED_LIST_MARKER_SIZE,
} from "../lib/marker-metrics";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "../../text/measure";
import type { EditorLayoutState } from "../state";
import { resolveInlineImageDimensions } from "../measure/inline-image";
import type { DocumentLayout, LayoutLine } from "../measure";
import { CODE_BLOCK_BACKGROUND_PADDING_Y, CODE_BLOCK_CONTENT_PADDING_X } from "../lib/code-block";
import { findDocumentLayoutLineForRegionOffset, measureCanvasLineOffsetLeft } from "./line-lookup";

export type InlineBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function resolveLineVisualLeft(
  state: EditorState,
  line: DocumentLayout["lines"][number],
  offset: number,
) {
  return measureCanvasLineOffsetLeft(line, offset) + resolveLineContentInset(state, line);
}

export function resolveLineContentInset(state: EditorState, line: DocumentLayout["lines"][number]) {
  const listItemEntry = findAncestorIndexedBlock(state.documentIndex, line.blockId, "listItem");

  if (!listItemEntry) {
    return 0;
  }

  const marker = resolveIndexedListItem(state, listItemEntry.block.id);

  return marker?.kind === "task" ? TASK_MARKER_TEXT_INSET : LIST_MARKER_TEXT_INSET;
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

export function resolveCodeBlockBackgroundBounds(
  layout: DocumentLayout,
  line: LayoutLine,
  regionBounds: { bottom: number; left: number; right: number; top: number },
): InlineBounds {
  const left = Math.max(0, line.left - CODE_BLOCK_CONTENT_PADDING_X);
  const right = Math.max(left, layout.width - layout.options.paddingX);

  return {
    height: regionBounds.bottom - regionBounds.top + CODE_BLOCK_BACKGROUND_PADDING_Y * 2,
    left,
    top: regionBounds.top - CODE_BLOCK_BACKGROUND_PADDING_Y,
    width: right - left,
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

  const textLeft = line.left + resolveLineContentInset(state, line);
  const left = textLeft + measureCanvasLineOffsetLeft(line, run.start - line.start) - line.left;
  const right = textLeft + measureCanvasLineOffsetLeft(line, run.end - line.start) - line.left;
  const { height } = resolveInlineImageDimensions(run, resources, line.width);
  const top = line.top + Math.max(0, Math.floor((line.height - height) / 2));

  return { left, top, width: right - left, height };
}
