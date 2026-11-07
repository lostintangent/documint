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
    const adjacentText = resolveEditorTextAtPath(state.documentIndex, path) ?? "";

    if (adjacentText.length > 0) {
      // From a non-empty path's edge, word movement always finds a stop:
      // previousWord falls back to 0 and wordEnd to the text length.
      const offset =
        movement === "nextWord"
          ? 0
          : (moveWordOffset(
              adjacentText,
              movement === "previousWord" ? adjacentText.length : 0,
              movement,
            ) ?? 0);

      return { path, offset };
    }

    path = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, path, direction);
  }

  if (movement === "nextWord" && focus.offset < text.length) {
    return { path: focus.path, offset: text.length };
  }

  return null;
}
