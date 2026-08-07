/**
 * Core line-based navigation semantics. This module owns the default caret and
 * range movement behavior for ordinary document flow outside block-type
 * overrides such as tables.
 */
import {
  findLineEntryForPathOffset,
  findLineForPathOffset,
  resolveCaretHitTestX,
  type CaretTarget,
  type DocumentLayout,
} from "../layout";
import { setSelectionPoint, type EditorState } from "../state";
import {
  resolveAdjacentEditorPathWithTextInFlow,
  resolveEditorTextAtPath,
} from "../state/index/query";
import { moveGraphemeOffset } from "../text/graphemes";
import { resolveEditorHitAtPoint } from "./hit";

export function moveCaretHorizontallyInFlow(
  state: EditorState,
  delta: -1 | 1,
  extendSelection: boolean,
) {
  const path = state.selection.focus.path;
  const text = resolveEditorTextAtPath(state.documentIndex, path);

  if (text === null) {
    return state;
  }
  const nextOffset = moveGraphemeOffset(text, state.selection.focus.offset, delta);

  if (nextOffset !== state.selection.focus.offset) {
    return setSelectionPoint(state, path, nextOffset, extendSelection);
  }

  if (delta < 0) {
    const previousPath = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, path, delta);
    const previousText = previousPath
      ? resolveEditorTextAtPath(state.documentIndex, previousPath)
      : null;

    if (!previousPath || previousText === null) {
      return state;
    }

    return setSelectionPoint(state, previousPath, previousText.length, extendSelection);
  }

  const nextPath = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, path, delta);

  if (!nextPath) {
    return state;
  }

  return setSelectionPoint(state, nextPath, 0, extendSelection);
}

export function moveCaretVerticallyInFlow(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentLine = findLineEntryForPathOffset(layout, caret.path, caret.offset);

  if (!currentLine) {
    return state;
  }

  const targetLine = layout.lines[currentLine.index + direction];

  if (!targetLine) {
    return state;
  }

  return placeCaretAtLineY(
    state,
    layout,
    caret,
    targetLine.top + targetLine.height / 2,
    extendSelection,
  );
}

export function moveCaretToCurrentLineBoundary(
  state: EditorState,
  layout: DocumentLayout,
  boundary: "Home" | "End",
  extendSelection: boolean,
) {
  const currentLine = findCurrentLine(state, layout);

  if (!currentLine) {
    return state;
  }

  return setSelectionPoint(
    state,
    currentLine.path,
    boundary === "Home" ? currentLine.start : currentLine.end,
    extendSelection,
  );
}

export function moveCaretByViewportInFlow(
  state: EditorState,
  layout: DocumentLayout,
  viewportHeight: number,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentLineEntry = findLineEntryForPathOffset(layout, caret.path, caret.offset);

  if (!currentLineEntry) {
    return state;
  }

  // Advance by a viewport's worth of lines, minus one for context overlap so
  // the user can still see the line they were on before the jump. Mirrors
  // VS Code / browser contenteditable PageUp/PageDown behavior.
  const linesPerViewport = Math.max(1, Math.floor(viewportHeight / layout.options.lineHeight) - 1);
  const targetLine = layout.lines[currentLineEntry.index + direction * linesPerViewport];

  if (!targetLine) {
    return state;
  }

  return placeCaretAtLineY(
    state,
    layout,
    caret,
    targetLine.top + targetLine.height / 2,
    extendSelection,
  );
}

// Project the caret onto a target Y at the caret's tracked visual X. Shared
// by vertical, page, and table-column motion so the hit-test recipe lives
// in one place: nudged X + target Y → editor hit → selection update.
export function placeCaretAtLineY(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  y: number,
  extendSelection: boolean,
): EditorState {
  const hit = resolveEditorHitAtPoint(layout, state, {
    x: resolveCaretHitTestX(state, layout, caret),
    y,
  });

  if (!hit) {
    return state;
  }

  return setSelectionPoint(state, hit.path, hit.offset, extendSelection);
}

function findCurrentLine(state: EditorState, layout: DocumentLayout) {
  return findLineForPathOffset(layout, state.selection.focus.path, state.selection.focus.offset);
}
