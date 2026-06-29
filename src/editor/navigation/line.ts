/**
 * Core line-based navigation semantics. This module owns the default caret and
 * range movement behavior for ordinary document flow outside block-type
 * overrides such as tables.
 */
import {
  findLineEntryForRegionOffset,
  findLineForRegionOffset,
  resolveCaretHitTestX,
  type CaretTarget,
  type DocumentLayout,
} from "../layout";
import { setSelectionPoint, type EditorState } from "../state";
import { nextRegionInFlow, previousRegionInFlow, resolveRegion } from "../state/index/query";
import { moveGraphemeOffset } from "../text/graphemes";
import { resolveEditorHitAtPoint } from "./hit";

export function moveCaretHorizontallyInFlow(
  state: EditorState,
  delta: -1 | 1,
  extendSelection: boolean,
) {
  const container = resolveRegion(state.documentIndex, state.selection.focus.regionPath);

  if (!container) {
    return state;
  }
  const nextOffset = moveGraphemeOffset(container.text, state.selection.focus.offset, delta);

  if (nextOffset !== state.selection.focus.offset) {
    return setSelectionPoint(state, container.path, nextOffset, extendSelection);
  }

  if (delta < 0) {
    const previousContainer = previousRegionInFlow(state.documentIndex, container.path);

    if (!previousContainer) {
      return state;
    }

    return setSelectionPoint(
      state,
      previousContainer.path,
      previousContainer.text.length,
      extendSelection,
    );
  }

  const nextContainer = nextRegionInFlow(state.documentIndex, container.path);

  if (!nextContainer) {
    return state;
  }

  return setSelectionPoint(state, nextContainer.path, 0, extendSelection);
}

export function moveCaretVerticallyInFlow(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentLine = findLineEntryForRegionOffset(layout, caret.regionPath, caret.offset);

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
    currentLine.regionPath,
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
  const currentLineEntry = findLineEntryForRegionOffset(layout, caret.regionPath, caret.offset);

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

  return setSelectionPoint(state, hit.regionPath, hit.offset, extendSelection);
}

function findCurrentLine(state: EditorState, layout: DocumentLayout) {
  return findLineForRegionOffset(
    layout,
    state.selection.focus.regionPath,
    state.selection.focus.offset,
  );
}
