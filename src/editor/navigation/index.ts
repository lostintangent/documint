/**
 * Editor navigation helpers for caret motion and range extension. This
 * boundary keeps call sites semantic while splitting core line-based movement
 * from table-specific vertical overrides.
 */
import type { CaretTarget, ViewportLayout } from "../layout";
import { measureCaretTarget } from "../layout";
import type { EditorState } from "../model/state";
import {
  extendSelectionHorizontallyInFlow,
  extendSelectionToCurrentLineBoundary,
  moveCaretByViewportInFlow,
  moveCaretHorizontallyInFlow,
  moveCaretToCurrentLineBoundary,
  moveCaretVerticallyInFlow,
} from "./line";
import { moveCaretVerticallyInTable } from "./table";

export function moveCaretHorizontally(state: EditorState, delta: -1 | 1) {
  return moveCaretHorizontallyInFlow(state, delta, false);
}

export function extendSelectionHorizontally(state: EditorState, delta: -1 | 1) {
  return extendSelectionHorizontallyInFlow(state, delta);
}

export function moveCaretVertically(
  state: EditorState,
  layout: ViewportLayout,
  direction: -1 | 1,
) {
  const caret = measureSelectionCaret(state, layout);

  if (!caret) {
    return state;
  }

  return (
    moveCaretVerticallyInTable(state, layout, caret, direction) ??
    moveCaretVerticallyInFlow(state, layout, caret, direction)
  );
}

export function moveCaretToLineBoundary(
  state: EditorState,
  layout: ViewportLayout,
  boundary: "Home" | "End",
) {
  return moveCaretToCurrentLineBoundary(state, layout, boundary, false);
}

export function extendSelectionToLineBoundary(
  state: EditorState,
  layout: ViewportLayout,
  boundary: "Home" | "End",
) {
  return extendSelectionToCurrentLineBoundary(state, layout, boundary);
}

export function moveCaretByViewport(
  state: EditorState,
  layout: ViewportLayout,
  direction: -1 | 1,
) {
  const caret = measureSelectionCaret(state, layout);

  if (!caret) {
    return state;
  }

  return moveCaretByViewportInFlow(state, layout, caret, direction);
}

function measureSelectionCaret(state: EditorState, layout: ViewportLayout) {
  return measureCaretTarget(layout, state.documentEditor, {
    regionId: state.selection.focus.regionId,
    offset: state.selection.focus.offset,
  });
}

export type { CaretTarget };
