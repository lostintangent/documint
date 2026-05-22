// Owns line and inline visual helpers shared by paint, navigation, and hit-testing.
// Given a prepared `DocumentLayout` plus editor state, these resolve content
// insets (e.g. list-marker indent) and small per-line metric helpers
// (visual-left, task checkbox bounds, inline image bounds). Ancestry walks
// live in `editor/state` (`findAncestorBlockEntry`) — layout consumes them
// as a primitive.

import type { DocumentResources } from "@/types";
import {
  findAncestorBlockEntry,
  resolveRegion,
  type InlineEntry,
  type ListItemMarker,
  type EditorState,
} from "../../state";
import {
  LIST_MARKER_TEXT_INSET,
  TASK_CHECKBOX_SIZE,
  TASK_MARKER_TEXT_INSET,
} from "../lib/marker-metrics";
import type { EditorLayoutState } from "../state";
import { resolveInlineImageDimensions } from "../measure/inline-image";
import type { DocumentLayout, DocumentLayoutLine } from "../measure";
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
  const listItemEntry = findAncestorBlockEntry(state.documentIndex, line.blockId, "listItem");

  if (!listItemEntry) {
    return 0;
  }

  const marker = resolveListItemMarker(state, listItemEntry.block.id);

  return marker?.kind === "task" ? TASK_MARKER_TEXT_INSET : LIST_MARKER_TEXT_INSET;
}

export function resolveTaskCheckboxBounds(line: DocumentLayoutLine) {
  return {
    left: line.left,
    size: TASK_CHECKBOX_SIZE,
    top: line.top + 3,
  };
}

export function resolveListItemMarker(
  state: EditorState,
  listItemId: string,
): ListItemMarker | null {
  return state.documentIndex.listItemMarkers.get(listItemId) ?? null;
}

export function measureInlineImageBounds(
  state: EditorState,
  viewport: EditorLayoutState,
  resources: DocumentResources,
  run: InlineEntry,
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
