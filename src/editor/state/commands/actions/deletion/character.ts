import { isSelectionCollapsed, resolveRegion, type EditorSelection } from "../../../selection";
import { moveGraphemeOffset } from "../../../../text/graphemes";
import { effect } from "../../../effects";
import { regionInlines } from "../../../index/inlines";
import type { EditableRegion } from "../../../index/types";
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
  const region = resolveRegion(state.documentIndex, point.regionPath);

  if (!region) {
    return null;
  }

  if (
    (direction === "backward" && point.offset <= 0) ||
    (direction === "forward" && point.offset >= region.text.length)
  ) {
    return null;
  }

  const startOffset =
    direction === "backward" ? moveGraphemeOffset(region.text, point.offset, -1) : point.offset;
  const endOffset =
    direction === "backward" ? point.offset : moveGraphemeOffset(region.text, point.offset, 1);

  if (startOffset === endOffset) {
    return null;
  }

  const placement =
    endOffset === region.text.length
      ? "line-end"
      : hasSoftLineBreakAtOffset(region, endOffset)
        ? "soft-line-break"
        : "line-middle";

  return {
    kind: "splice-text",
    range: {
      anchor: { regionPath: region.path, offset: startOffset },
      focus: { regionPath: region.path, offset: endOffset },
    },
    text: "",
    effect: effect.textDeleted(region, startOffset, endOffset, direction, placement),
  };
}

function hasSoftLineBreakAtOffset(region: EditableRegion, offset: number) {
  return regionInlines(region).some(
    (inline) => inline.node.type === "lineBreak" && inline.start === offset,
  );
}
