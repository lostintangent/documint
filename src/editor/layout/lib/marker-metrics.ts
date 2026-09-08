// Owns list/task marker metrics shared by exact layout, virtualization, and
// visual queries.

import { findAncestorIndexedBlockByPath, type DocumentIndex } from "../../state";
import {
  resolveCenteredTextBaseline,
  resolveFontMetrics,
  resolveFontSize,
} from "../../text/measure";

export const LIST_MARKER_TEXT_INSET = 18;
export const ORDERED_LIST_MARKER_GAP = 8;
export const CHECKBOX_SIZE = 14;
export const CHECKBOX_HIT_PADDING = 4;
const CHECKBOX_BASE_FONT_SIZE = 16;
// Gap between the task checkbox and the start of its text.
export const TASK_CHECKBOX_TEXT_GAP = 8;
export const TASK_MARKER_TEXT_INSET = CHECKBOX_SIZE + TASK_CHECKBOX_TEXT_GAP;
export const UNORDERED_LIST_MARKER_GUTTER_INSET = 2;
export const UNORDERED_LIST_MARKER_SIZE = 6;

export type LayoutBlockExtent = {
  bottom: number;
  top: number;
};

export function mergeLayoutBlockExtent(
  blockExtents: Map<string, LayoutBlockExtent>,
  blockPath: string,
  top: number,
  bottom: number,
) {
  const current = blockExtents.get(blockPath);

  blockExtents.set(blockPath, {
    bottom: current ? Math.max(current.bottom, bottom) : bottom,
    top: current ? Math.min(current.top, top) : top,
  });
}

export function updateBlockExtent(
  blockExtents: Map<string, LayoutBlockExtent>,
  line: { blockPath: string; height: number; top: number },
) {
  mergeLayoutBlockExtent(blockExtents, line.blockPath, line.top, line.top + line.height);
}

// List item content is rendered shifted right by the marker inset (bullet
// or task checkbox) so the marker can sit in the gutter to its left.
// Subtract this from `availableWidth` so wrap measurement matches the
// visible text area; otherwise wrapped lines overflow the right padding by
// the inset amount. Shared between measure (exact wrap) and large-document
// estimation so both agree on what a list-item line can hold.
export function resolveListMarkerInset(
  documentIndex: DocumentIndex,
  blockPath: string,
  fontSize: number,
): number {
  const listItem = findAncestorIndexedBlockByPath(documentIndex, blockPath, "listItem");

  if (!listItem) {
    return 0;
  }

  const marker = documentIndex.listItems.get(listItem.path);

  return marker?.kind === "task"
    ? resolveTaskMarkerTextInsetFromFontSize(fontSize)
    : LIST_MARKER_TEXT_INSET;
}

export function resolveCheckboxRect(anchor: {
  font: string;
  height: number;
  left: number;
  top: number;
}) {
  const size = resolveCheckboxSizeFromFontSize(resolveFontSize(anchor.font));
  const centerY = resolveTextOpticalCenter(anchor);

  return {
    height: size,
    left: anchor.left,
    top: centerY - size / 2,
    width: size,
  };
}

export function resolveTextOpticalCenter(anchor: { font: string; height: number; top: number }) {
  const baseline = anchor.top + resolveCenteredTextBaseline(anchor.height, anchor.font);
  const { ascent, descent } = resolveFontMetrics(anchor.font);
  return baseline - (ascent - descent) / 2 - 1;
}

function resolveCheckboxSizeFromFontSize(fontSize: number) {
  return Math.max(1, Math.round(fontSize * (CHECKBOX_SIZE / CHECKBOX_BASE_FONT_SIZE)));
}

function resolveTaskMarkerTextInsetFromFontSize(fontSize: number) {
  return resolveCheckboxSizeFromFontSize(fontSize) + TASK_CHECKBOX_TEXT_GAP;
}
