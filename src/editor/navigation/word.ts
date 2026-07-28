import {
  resolveAdjacentEditorPathWithTextInFlow,
  resolveEditorTextAtPath,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import { moveWordOffset, type WordMovement } from "../text/words";

export function resolveWordNavigationTarget(
  state: EditorState,
  movement: WordMovement,
): EditorSelectionPoint | null {
  const direction = movement === "previousWord" ? -1 : 1;
  const focus = state.selection.focus;
  const text = resolveEditorTextAtPath(state.documentIndex, focus.path);

  if (text === null) {
    return null;
  }

  const offset = moveWordOffset(text, focus.offset, movement);
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
        movement === "previousWord"
          ? moveWordOffset(adjacentText, adjacentText.length, movement)
          : movement === "nextWord"
            ? 0
            : moveWordOffset(adjacentText, 0, movement);

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

  if (movement === "nextWord" && focus.offset < text.length) {
    return { path: focus.path, offset: text.length };
  }

  return null;
}
