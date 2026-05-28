import { resolveRegion, type EditorSelection } from "../../../selection";
import { moveGraphemeOffset } from "../../../../text/graphemes";
import { regionInlines } from "../../../index/inlines";
import type { EditableRegion } from "../../../index/types";
import type { EditorState, EditorStateAction } from "../../../types";
import { resolveTextFadeAnimation } from "../../../animations/intents";

// Resolves the splice-text action for a single-grapheme delete at the
// caret. Returns null when the selection is non-collapsed, the cursor
// is at the boundary in the requested direction, or there is no
// grapheme to delete (degenerate offsets).
//
// The action's `range` carries the deletion range so the reducer deletes
// exactly one grapheme even though most text splices default to the current
// editor selection.
type CharacterDeleteAction = Extract<EditorStateAction, { kind: "splice-text" }> & {
  range: EditorSelection;
};

export function resolveCharacterDelete(
  state: EditorState,
  direction: "backward" | "forward",
): CharacterDeleteAction | null {
  if (
    state.selection.anchor.regionId !== state.selection.focus.regionId ||
    state.selection.anchor.offset !== state.selection.focus.offset
  ) {
    return null;
  }

  const region = resolveRegion(state.documentIndex, state.selection.focus.regionId);

  if (!region) {
    return null;
  }

  if (direction === "forward" && state.selection.focus.offset >= region.text.length) {
    return null;
  }

  const startOffset =
    direction === "backward"
      ? moveGraphemeOffset(region.text, state.selection.focus.offset, -1)
      : state.selection.focus.offset;
  const endOffset =
    direction === "backward"
      ? state.selection.focus.offset
      : moveGraphemeOffset(region.text, state.selection.focus.offset, 1);

  if (startOffset === endOffset) {
    return null;
  }

  const shouldAnimateFade =
    direction === "backward" &&
    (endOffset === region.text.length || hasSoftLineBreakAtOffset(region, endOffset));

  return {
    animation: shouldAnimateFade
      ? resolveTextFadeAnimation(region, startOffset, endOffset)
      : undefined,
    kind: "splice-text",
    range: {
      anchor: { regionId: region.id, offset: startOffset },
      focus: { regionId: region.id, offset: endOffset },
    },
    text: "",
  };
}

function hasSoftLineBreakAtOffset(region: EditableRegion, offset: number) {
  return regionInlines(region).some((inline) => inline.node.type === "lineBreak" && inline.start === offset);
}
