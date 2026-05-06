// Owns visual geometry helpers shared by paint, navigation, and hit-testing.
// Given a prepared `DocumentLayout` plus editor state, these resolve content
// insets (e.g. list-marker indent), ancestry lookups, and small per-line
// metric helpers (visual-left, task checkbox bounds).

import type { EditorListItemMarker, EditorState } from "../../state";
import {
  LIST_MARKER_TEXT_INSET,
  TASK_CHECKBOX_SIZE,
  TASK_MARKER_TEXT_INSET,
} from "../lib/geometry";
import type { DocumentLayout, DocumentLayoutLine } from "../measure";
import { measureCanvasLineOffsetLeft } from "./lookup";

export function resolveLineVisualLeft(
  state: EditorState,
  line: DocumentLayout["lines"][number],
  offset: number,
) {
  return measureCanvasLineOffsetLeft(line, offset) + resolveLineContentInset(state, line);
}

export function resolveLineContentInset(state: EditorState, line: DocumentLayout["lines"][number]) {
  const listItemEntry = findBlockAncestor(state, line.blockId, "listItem");

  if (!listItemEntry) {
    return 0;
  }

  const marker = resolveListItemMarker(state, listItemEntry.id);

  return marker?.kind === "task" ? TASK_MARKER_TEXT_INSET : LIST_MARKER_TEXT_INSET;
}

export function resolveTaskCheckboxBounds(line: DocumentLayoutLine) {
  return {
    left: line.left,
    size: TASK_CHECKBOX_SIZE,
    top: line.top + 3,
  };
}

export function findBlockAncestor(
  state: EditorState,
  blockId: string,
  type: EditorState["documentIndex"]["blocks"][number]["type"],
) {
  let current = state.documentIndex.blockIndex.get(blockId) ?? null;

  while (current) {
    if (current.type === type) {
      return current;
    }

    const parentBlockId = current.parentBlockId;

    current = parentBlockId ? (state.documentIndex.blockIndex.get(parentBlockId) ?? null) : null;
  }

  return null;
}

export function resolveListItemMarker(
  state: EditorState,
  listItemId: string,
): EditorListItemMarker | null {
  return state.documentIndex.listItemMarkers.get(listItemId) ?? null;
}
