import { isSelectionCollapsed, type EditorSelection } from "../../../selection";
import { moveGraphemeOffset } from "../../../../text/graphemes";
import { effect } from "../../../effects";
import { resolveEditorTextAtPath, resolveInlinesAtPath } from "../../../index/query";
import type { EditorState, EditorStateAction } from "../../../types";

// Resolves the splice-text action for a single-grapheme delete at the
// caret. Returns null when the selection is non-collapsed, the cursor
// is at the boundary in the requested direction, or there is no
// grapheme to delete (degenerate offsets).
//
// The action's `range` carries the computed grapheme span. Without it,
// `splice-text` would use the current collapsed selection and delete nothing.
type CharacterDeleteAction = Extract<EditorStateAction, { kind: "splice-text" }> & {
  range: EditorSelection;
};

export function resolveCharacterDelete(
  state: EditorState,
  direction: "backward" | "forward",
): CharacterDeleteAction | null {
  const selection = state.selection;

  if (!isSelectionCollapsed(selection)) {
    return null;
  }

  const point = selection.focus;
  const text = resolveEditorTextAtPath(state.documentIndex, point.path);

  if (text === null) {
    return null;
  }

  if (
    (direction === "backward" && point.offset <= 0) ||
    (direction === "forward" && point.offset >= text.length)
  ) {
    return null;
  }

  const startOffset =
    direction === "backward" ? moveGraphemeOffset(text, point.offset, -1) : point.offset;
  const endOffset =
    direction === "backward" ? point.offset : moveGraphemeOffset(text, point.offset, 1);

  if (startOffset === endOffset) {
    return null;
  }

  const placement =
    endOffset === text.length
      ? "line-end"
      : hasSoftLineBreakAtOffset(state, point.path, endOffset)
        ? "soft-line-break"
        : "line-middle";

  return {
    kind: "splice-text",
    range: {
      anchor: { path: point.path, offset: startOffset },
      focus: { path: point.path, offset: endOffset },
    },
    text: "",
    effect: effect.textDeletedAtPath(
      state.documentIndex,
      point.path,
      startOffset,
      endOffset,
      direction,
      placement,
    ),
  };
}

function hasSoftLineBreakAtOffset(state: EditorState, path: string, offset: number) {
  return (resolveInlinesAtPath(state.documentIndex, path) ?? []).some(
    (inline) => inline.node.type === "lineBreak" && inline.start === offset,
  );
}
