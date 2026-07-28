import {
  resolveAdjacentEditorPathWithTextInFlow,
  resolveEditorTextAtPath,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import { moveWordOffset, type WordBoundaryStyle } from "../text/words";

export function resolveWordNavigationTarget(
  state: EditorState,
  direction: -1 | 1,
  wordBoundaryStyle: WordBoundaryStyle = "wordEdges",
): EditorSelectionPoint | null {
  const focus = state.selection.focus;
  const text = resolveEditorTextAtPath(state.documentIndex, focus.path);

  if (text === null) {
    return null;
  }

  const offset = moveWordOffset(text, focus.offset, direction, wordBoundaryStyle);
  if (offset !== null) {
    return { path: focus.path, offset };
  }

  let path = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, focus.path, direction);

  while (path) {
    const adjacentText = resolveEditorTextAtPath(state.documentIndex, path);

    if (adjacentText === null) {
      return null;
    }

    if (adjacentText.length > 0) {
      const offset =
        direction < 0
          ? moveWordOffset(adjacentText, adjacentText.length, direction, wordBoundaryStyle)
          : wordBoundaryStyle === "tokenStarts"
            ? 0
            : moveWordOffset(adjacentText, 0, direction, wordBoundaryStyle);

      if (offset === null) {
        return null;
      }

      return {
        path,
        offset,
      };
    }

    path = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, path, direction);
  }

  if (direction > 0 && wordBoundaryStyle === "tokenStarts" && focus.offset < text.length) {
    return { path: focus.path, offset: text.length };
  }

  return null;
}
