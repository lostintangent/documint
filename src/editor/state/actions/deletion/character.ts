import { resolveRegion } from "../../selection";
import type { EditorState, EditorStateAction } from "../../types";

// Resolves the splice-text action for a single-grapheme delete at the
// caret. Returns null when the selection is non-collapsed, the cursor
// is at the boundary in the requested direction, or there is no
// grapheme to delete (degenerate offsets).
//
// The action's `selection` carries the deletion range — callers that
// need the start/end offsets (e.g. for animation metadata in the
// commands layer) should read them off the action itself rather than
// recomputing.
type CharacterDeleteAction = Extract<EditorStateAction, { kind: "splice-text" }>;

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
      ? previousGraphemeOffset(region.text, state.selection.focus.offset)
      : state.selection.focus.offset;
  const endOffset =
    direction === "backward"
      ? state.selection.focus.offset
      : nextGraphemeOffset(region.text, state.selection.focus.offset);

  if (startOffset === endOffset) {
    return null;
  }

  return {
    kind: "splice-text",
    selection: {
      anchor: { regionId: region.id, offset: startOffset },
      focus: { regionId: region.id, offset: endOffset },
    },
    text: "",
  };
}

function previousGraphemeOffset(text: string, offset: number) {
  const slice = Array.from(text.slice(0, offset));

  if (slice.length === 0) {
    return 0;
  }

  return offset - slice.at(-1)!.length;
}

function nextGraphemeOffset(text: string, offset: number) {
  const next = Array.from(text.slice(offset))[0];

  return next ? offset + next.length : text.length;
}
