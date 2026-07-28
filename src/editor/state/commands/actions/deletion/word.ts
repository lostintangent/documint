import { rootBlockPath } from "@/document";
import { moveWordOffset, type WordBoundaryStyle } from "../../../../text/words";
import { resolveEditorTextAtPath, resolveRootBlock } from "../../../index/query";
import { isSelectionCollapsed, type EditorSelectionPoint } from "../../../selection";
import type { EditorState, EditorStateAction } from "../../../types";
import { resolveBlockContext } from "../../context";
import { resolveSelectionTextReplacement } from "../insertion/replace";

export function resolveWordDeletion(
  state: EditorState,
  direction: -1 | 1,
  wordBoundaryStyle: WordBoundaryStyle = "wordEdges",
): EditorStateAction | null {
  if (!isSelectionCollapsed(state.selection)) {
    return resolveSelectionTextReplacement(state.documentIndex, state.selection, "");
  }

  const target = resolveWordDeletionTarget(state, direction, wordBoundaryStyle);
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
  direction: -1 | 1,
  wordBoundaryStyle: WordBoundaryStyle,
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

  const localFallback =
    direction > 0 && wordBoundaryStyle === "tokenStarts" && focus.offset < text.length
      ? { path: focus.path, offset: text.length }
      : null;
  const context = resolveBlockContext(state);
  if (context?.kind !== "rootTextBlock") {
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
      direction > 0 && wordBoundaryStyle === "tokenStarts"
        ? adjacentText.length > 0
          ? 0
          : null
        : moveWordOffset(
            adjacentText,
            direction < 0 ? adjacentText.length : 0,
            direction,
            wordBoundaryStyle,
          );

    if (targetOffset !== null) {
      return { path, offset: targetOffset };
    }
  }

  return localFallback;
}
