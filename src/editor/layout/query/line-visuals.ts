// Owns line and inline visual helpers shared by paint, navigation, and hit-testing.
// Given a prepared `DocumentLayout` plus editor state where needed, these
// resolve small per-line metric helpers (visual-left, task checkbox bounds,
// inline image bounds).

import type { DocumentResources } from "@/types";
import {
  findAncestorIndexedBlockByPath,
  resolveBlockTextPathBoundary,
  type DocumentIndex,
  type IndexedBlock,
  type IndexedInline,
  type IndexedListItem,
  type EditorState,
} from "../../state";
import {
  ORDERED_LIST_MARKER_GAP,
  resolveTaskCheckboxSizeFromFont,
  UNORDERED_LIST_MARKER_GUTTER_INSET,
  UNORDERED_LIST_MARKER_SIZE,
} from "../lib/marker-metrics";
import { resolveCenteredTextBaseline, resolveFontMetrics } from "../../text/measure";
import type { EditorLayoutState } from "../state";
import { resolveInlineImageDimensions } from "../measure/inline-image";
import type { DocumentLayout, LayoutLine } from "../measure";
import { findDocumentLayoutLineForPathOffset, measureCanvasLineOffsetLeft } from "./line-lookup";

export type InlineBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type ListMarkerTarget = {
  blockPath: string;
  listItemPath: string;
  marker: IndexedListItem;
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
  const size = resolveTaskCheckboxSizeFromFont(line.font);
  const centerY = resolveTextOpticalCenter(line);

  return {
    left: line.left,
    size,
    top: centerY - size / 2,
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
  listItemPath: string,
): IndexedListItem | null {
  return state.documentIndex.listItems.get(listItemPath) ?? null;
}

export function resolveListMarkerTarget(
  state: EditorState,
  line: DocumentLayout["lines"][number],
): ListMarkerTarget | null {
  if (line.start !== 0) {
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

  if (resolveFirstPathInBlock(state.documentIndex, listItemEntry) !== line.path) {
    return null;
  }

  const marker = resolveIndexedListItem(state, listItemEntry.path);

  return marker
    ? {
        blockPath: listItemEntry.path,
        listItemPath: listItemEntry.path,
        marker,
      }
    : null;
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
  if (run.node.type !== "image") {
    return null;
  }

  const line = findDocumentLayoutLineForPathOffset(
    viewport.layout,
    state.selection.anchor.path,
    run.start,
  );

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

function resolveFirstPathInBlock(documentIndex: DocumentIndex, indexedBlock: IndexedBlock) {
  return resolveBlockTextPathBoundary(documentIndex, indexedBlock.path, "start");
}
