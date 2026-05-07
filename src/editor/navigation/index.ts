/**
 * Editor navigation helpers for caret motion and range extension. This
 * boundary keeps call sites semantic while splitting core line-based movement
 * from table-specific vertical overrides.
 */
import type { CaretTarget, DocumentLayout, EditorLayoutState, EditorPoint } from "../layout";
import { measureCaretTarget, resolveLayoutDragFocus, resolveLayoutSelectionHit } from "../layout";
import {
  setSelection,
  setSelectionPoint,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import {
  moveCaretByViewportInFlow,
  moveCaretHorizontallyInFlow,
  moveCaretToCurrentLineBoundary,
  moveCaretVerticallyInFlow,
} from "./line";
import { moveCaretVerticallyInTable } from "./table";

export function moveCaretHorizontally(state: EditorState, delta: -1 | 1, extendSelection = false) {
  return moveCaretHorizontallyInFlow(state, delta, extendSelection);
}

export function moveCaretVertically(
  state: EditorState,
  layout: DocumentLayout,
  direction: -1 | 1,
  extendSelection = false,
) {
  return applyVerticalMotion(state, layout, direction, extendSelection);
}

export function moveCaretByViewport(
  state: EditorState,
  layout: DocumentLayout,
  direction: -1 | 1,
  extendSelection = false,
) {
  return applyViewportMotion(state, layout, direction, extendSelection);
}

export function moveCaretToLineBoundary(
  state: EditorState,
  layout: DocumentLayout,
  boundary: "Home" | "End",
  extendSelection = false,
) {
  return moveCaretToCurrentLineBoundary(state, layout, boundary, extendSelection);
}

export function moveCaretToDocumentBoundary(
  state: EditorState,
  boundary: "start" | "end",
  extendSelection = false,
) {
  return applyDocumentBoundaryMotion(state, boundary, extendSelection);
}

export function setSelectionAtPoint(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  const hit = resolveLayoutSelectionHit(state, viewport, point);

  return hit ? setSelection(state, { offset: hit.offset, regionId: hit.regionId }) : null;
}

export function extendSelectionToPoint(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  const hit = resolveLayoutSelectionHit(state, viewport, point);

  return hit ? setSelectionPoint(state, hit.regionId, hit.offset, true) : null;
}

export function updateSelectionFromDrag(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
  anchor: EditorSelectionPoint,
) {
  const focus = resolveLayoutDragFocus(state, viewport, point, anchor);

  return focus
    ? setSelection(state, {
        anchor,
        focus,
      })
    : null;
}

function applyVerticalMotion(
  state: EditorState,
  layout: DocumentLayout,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const caret = measureSelectionCaret(state, layout);

  if (!caret) {
    return state;
  }

  return (
    moveCaretVerticallyInTable(state, layout, caret, direction, extendSelection) ??
    moveCaretVerticallyInFlow(state, layout, caret, direction, extendSelection)
  );
}

function applyViewportMotion(
  state: EditorState,
  layout: DocumentLayout,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const caret = measureSelectionCaret(state, layout);

  if (!caret) {
    return state;
  }

  return moveCaretByViewportInFlow(state, layout, caret, direction, extendSelection);
}

function applyDocumentBoundaryMotion(
  state: EditorState,
  boundary: "start" | "end",
  extendSelection: boolean,
) {
  const regions = state.documentIndex.regions;
  const targetRegion = boundary === "start" ? regions[0] : regions.at(-1);

  if (!targetRegion) {
    return state;
  }

  return setSelectionPoint(
    state,
    targetRegion.id,
    boundary === "start" ? 0 : targetRegion.text.length,
    extendSelection,
  );
}

function measureSelectionCaret(state: EditorState, layout: DocumentLayout) {
  return measureCaretTarget(layout, state.documentIndex, {
    regionId: state.selection.focus.regionId,
    offset: state.selection.focus.offset,
  });
}

export type { CaretTarget };
