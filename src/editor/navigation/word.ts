import {
  resolveAdjacentEditorPathWithTextInFlow,
  resolveEditorTextAtPath,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import { resolveWordBoundaryOffset } from "../text/words";

export function resolveWordNavigationTarget(
  state: EditorState,
  direction: -1 | 1,
): EditorSelectionPoint | null {
  const focus = state.selection.focus;
  const text = resolveEditorTextAtPath(state.documentIndex, focus.path);

  if (text === null) {
    return null;
  }

  const offset = resolveWordBoundaryOffset(text, focus.offset, direction);
  if (offset !== focus.offset) {
    return { path: focus.path, offset };
  }

  let path = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, focus.path, direction);

  while (path) {
    const adjacentText = resolveEditorTextAtPath(state.documentIndex, path);

    if (adjacentText === null) {
      return null;
    }

    if (adjacentText.length > 0) {
      const boundary = direction < 0 ? adjacentText.length : 0;
      return {
        path,
        offset: resolveWordBoundaryOffset(adjacentText, boundary, direction),
      };
    }

    path = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, path, direction);
  }

  return null;
}
