// Owns the small rect/extent types every layout file reuses, plus the marker
// inset constants (and the helper that walks a block's ancestry to resolve
// which inset applies). Kept free of option/spacing policy so consumers can
// import without pulling in those concerns.

import type { DocumentIndex } from "../../state";

export const LIST_MARKER_TEXT_INSET = 18;
export const TASK_CHECKBOX_SIZE = 14;
// Gap between the task checkbox and the start of its text. Keeping this
// explicit makes the relationship between the box size and the text inset
// obvious — bumping the box automatically bumps the inset.
export const TASK_CHECKBOX_TEXT_GAP = 8;
export const TASK_MARKER_TEXT_INSET = TASK_CHECKBOX_SIZE + TASK_CHECKBOX_TEXT_GAP;

export type LayoutBlockExtent = {
  bottom: number;
  top: number;
};

export type ContainerLineBounds = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

// List item content is rendered shifted right by the marker inset (bullet
// or task checkbox) so the marker can sit in the gutter to its left.
// Subtract this from `availableWidth` so wrap measurement matches the
// visible text area; otherwise wrapped lines overflow the right padding by
// the inset amount. Shared between measure (exact wrap) and the planner's
// estimator (predicted height) so both agree on what a list-item line can
// hold.
export function resolveListMarkerInset(
  blockIndex: DocumentIndex["blockIndex"],
  listItemMarkers: DocumentIndex["listItemMarkers"],
  blockId: string,
): number {
  let current = blockIndex.get(blockId) ?? null;

  while (current) {
    if (current.type === "listItem") {
      const marker = listItemMarkers.get(current.id);
      return marker?.kind === "task" ? TASK_MARKER_TEXT_INSET : LIST_MARKER_TEXT_INSET;
    }

    current = current.parentBlockId ? (blockIndex.get(current.parentBlockId) ?? null) : null;
  }

  return 0;
}
