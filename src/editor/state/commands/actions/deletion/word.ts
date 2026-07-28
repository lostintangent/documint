import { rootBlockPath } from "@/document";
import { moveWordOffset, type WordMovement } from "../../../../text/words";
import { resolveEditorTextAtPath, resolveRootBlock } from "../../../index/query";
import { isSelectionCollapsed, type EditorSelectionPoint } from "../../../selection";
import type { EditorState, EditorStateAction } from "../../../types";
import { resolveRootTextBlockContextFromSelection } from "../../context";
import { resolveSelectionTextReplacement } from "../insertion/replace";

export function resolveWordDeletion(
  state: EditorState,
  movement: WordMovement,
): EditorStateAction | null {
  if (!isSelectionCollapsed(state.selection)) {
    return resolveSelectionTextReplacement(state.documentIndex, state.selection, "");
  }

  const target = resolveWordDeletionTarget(state, movement);
  if (!target) {
    return null;
  }

  return resolveSelectionTextReplacement(
    state.documentIndex,
    {
      anchor: state.selection.focus,
      focus: target,
    },
    "",
  );
}

function resolveWordDeletionTarget(
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

  const localFallback =
    movement === "nextWord" && focus.offset < text.length
      ? { path: focus.path, offset: text.length }
      : null;
  const context = resolveRootTextBlockContextFromSelection(state.documentIndex, state.selection);
  if (!context) {
    return localFallback;
  }

  for (
    let rootIndex = context.rootIndex + direction;
    rootIndex >= 0 && rootIndex < state.documentIndex.roots.length;
    rootIndex += direction
  ) {
    const block = resolveRootBlock(state.documentIndex, rootIndex);
    if (!block || (block.type !== "paragraph" && block.type !== "heading")) {
      return localFallback;
    }

    const path = rootBlockPath(rootIndex);
    const adjacentText = resolveEditorTextAtPath(state.documentIndex, path);
    if (adjacentText === null) {
      return localFallback;
    }

    const targetOffset =
      movement === "nextWord"
        ? adjacentText.length > 0
          ? 0
          : null
        : moveWordOffset(
            adjacentText,
            movement === "previousWord" ? adjacentText.length : 0,
            movement,
          );

    if (targetOffset !== null) {
      return { path, offset: targetOffset };
    }
  }

  return localFallback;
}
