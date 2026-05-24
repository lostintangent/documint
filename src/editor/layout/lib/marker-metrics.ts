// Owns list/task marker metrics shared by exact layout, virtualization, and
// visual queries.

import { findAncestorBlockEntry, type DocumentIndex } from "../../state";

export const LIST_MARKER_TEXT_INSET = 18;
export const ORDERED_LIST_MARKER_GAP = 8;
export const TASK_CHECKBOX_SIZE = 14;
// Gap between the task checkbox and the start of its text. Keeping this
// explicit makes the relationship between the box size and the text inset
// obvious — bumping the box automatically bumps the inset.
export const TASK_CHECKBOX_TEXT_GAP = 8;
export const TASK_MARKER_TEXT_INSET = TASK_CHECKBOX_SIZE + TASK_CHECKBOX_TEXT_GAP;
export const UNORDERED_LIST_MARKER_GUTTER_INSET = 2;
export const UNORDERED_LIST_MARKER_SIZE = 6;

export type LayoutBlockExtent = {
  bottom: number;
  top: number;
};

// List item content is rendered shifted right by the marker inset (bullet
// or task checkbox) so the marker can sit in the gutter to its left.
// Subtract this from `availableWidth` so wrap measurement matches the
// visible text area; otherwise wrapped lines overflow the right padding by
// the inset amount. Shared between measure (exact wrap) and large-document
// estimation so both agree on what a list-item line can hold.
export function resolveListMarkerInset(documentIndex: DocumentIndex, blockId: string): number {
  const listItem = findAncestorBlockEntry(documentIndex, blockId, "listItem");

  if (!listItem) {
    return 0;
  }

  const marker = documentIndex.listItemMarkers.get(listItem.block.id);

  return marker?.kind === "task" ? TASK_MARKER_TEXT_INSET : LIST_MARKER_TEXT_INSET;
}
