// Owns line and inline visual helpers shared by paint, navigation, and hit-testing.
// Given a prepared `DocumentLayout` plus editor state where needed, these
// resolve small per-line metric helpers (list marker targets, task checkbox
// bounds, inline image bounds).

import {
  findAncestorIndexedBlockByPath,
  resolveBlockTextPathBoundary,
  type IndexedInline,
  type IndexedListItem,
  type EditorState,
} from "../../state";
import { resolveBlockLeft } from "../lib/content-metrics";
import {
  LIST_MARKER_TEXT_INSET,
  ORDERED_LIST_MARKER_GAP,
  resolveCheckboxRect,
  resolveTextOpticalCenter,
  UNORDERED_LIST_MARKER_GUTTER_INSET,
  UNORDERED_LIST_MARKER_SIZE,
} from "../lib/marker-metrics";
import type { DocumentLayoutOptions } from "../lib/options";
import type { EditorLayoutState } from "../state";
import type { DocumentLayout, LayoutInlineReference, LayoutLine } from "../measure";
import { findDocumentLayoutLineForPathOffset, measureCanvasLineOffsetLeft } from "./line-lookup";

export type InlineBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

// Markers anchor on the item's own left edge, not its first line, so an item
// that starts with code, a quote, or a table keeps its marker in the gutter.
export type ListMarkerTarget = {
  left: number;
  listItemPath: string;
  marker: IndexedListItem;
};

export function resolveOrderedListMarkerAnchor(left: number) {
  return left + LIST_MARKER_TEXT_INSET - ORDERED_LIST_MARKER_GAP;
}

export function resolveTaskCheckboxBounds(line: LayoutLine, left: number) {
  return resolveCheckboxRect({ font: line.font, height: line.height, left, top: line.top });
}

export function resolveUnorderedListMarkerBounds(line: LayoutLine, left: number) {
  const size = UNORDERED_LIST_MARKER_SIZE;
  const centerY = resolveTextOpticalCenter(line);

  return {
    height: size,
    left: left - UNORDERED_LIST_MARKER_GUTTER_INSET,
    top: centerY - size / 2,
    width: size,
  };
}

export function resolveListMarkerTarget(
  state: EditorState,
  line: DocumentLayout["lines"][number],
  options: DocumentLayoutOptions,
): ListMarkerTarget | null {
  if (line.blockPath === null || line.start !== 0) {
    return null;
  }

  const listItemEntry = findAncestorIndexedBlockByPath(
    state.documentIndex,
    line.blockPath,
    "listItem",
  );

  if (!listItemEntry) {
    return null;
  }

  if (
    resolveBlockTextPathBoundary(state.documentIndex, listItemEntry.path, "start") !== line.path
  ) {
    return null;
  }

  const marker = state.documentIndex.listItems.get(listItemEntry.path);

  return marker
    ? {
        left: resolveBlockLeft(options, listItemEntry.depth + 1),
        listItemPath: listItemEntry.path,
        marker,
      }
    : null;
}

export function measureInlineImageBounds(
  state: EditorState,
  viewport: EditorLayoutState,
  run: IndexedInline,
): InlineBounds | null {
  const line = findDocumentLayoutLineForPathOffset(
    viewport.layout,
    state.selection.anchor.path,
    run.start,
  );
  const reference = line?.inlineReferences?.find(
    (candidate) => candidate.kind === "image" && candidate.start === run.start,
  );

  return line && reference?.kind === "image" ? resolveInlineImageBounds(line, reference) : null;
}

export function resolveInlineImageBounds(
  line: LayoutLine,
  reference: Extract<LayoutInlineReference, { kind: "image" }>,
): InlineBounds {
  return {
    height: reference.height,
    left: measureCanvasLineOffsetLeft(line, reference.start - line.start) + line.contentInset,
    top: line.top + Math.max(0, Math.floor((line.height - reference.height) / 2)),
    width: reference.width,
  };
}
