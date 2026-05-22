/**
 * Editor navigation helpers for caret motion and range extension. This
 * boundary keeps call sites semantic while splitting core line-based movement
 * from table-specific vertical overrides.
 *
 * Layout-aware motion (vertical, page, line boundary) takes the prepared
 * `EditorLayoutState` so it has access to both layout geometry and viewport
 * metrics. Region-only motion (horizontal, document boundary) takes just the
 * state.
 */
import { measureCaretTarget, type EditorLayoutState, type EditorPoint } from "../layout";
import {
  setSelection,
  setSelectionPoint,
  resolveDocumentBoundaryRegion,
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
export {
  resolveDragFocus,
  resolveDragFocusPoint,
  resolveEditorHitAtPoint,
  resolveHoverTarget,
  resolveHoverTargetAtPoint,
  resolveLinkHitAtPoint,
  resolveSelectionHit,
  resolveTargetAtOffset,
  resolveTaskCheckboxHitAtPoint,
  resolveWordSelection,
  resolveWordSelectionAtPoint,
  type EditorHoverTarget,
  type EditorHit,
  type SelectionHit,
} from "./hit";
import { resolveDragFocus, resolveSelectionHit } from "./hit";

export function moveCaretHorizontally(state: EditorState, delta: -1 | 1, extendSelection = false) {
  return moveCaretHorizontallyInFlow(state, delta, extendSelection);
}

export function moveCaretVertically(
  state: EditorState,
  viewport: EditorLayoutState,
  direction: -1 | 1,
  extendSelection = false,
) {
  const caret = measureSelectionCaret(state, viewport);

  if (!caret) {
    return state;
  }

  return (
    moveCaretVerticallyInTable(state, viewport.layout, caret, direction, extendSelection) ??
    moveCaretVerticallyInFlow(state, viewport.layout, caret, direction, extendSelection)
  );
}

export function moveCaretByViewport(
  state: EditorState,
  viewport: EditorLayoutState,
  direction: -1 | 1,
  extendSelection = false,
) {
  const caret = measureSelectionCaret(state, viewport);

  if (!caret) {
    return state;
  }

  return moveCaretByViewportInFlow(
    state,
    viewport.layout,
    viewport.viewport.height,
    caret,
    direction,
    extendSelection,
  );
}

export function moveCaretToLineBoundary(
  state: EditorState,
  viewport: EditorLayoutState,
  boundary: "Home" | "End",
  extendSelection = false,
) {
  return moveCaretToCurrentLineBoundary(state, viewport.layout, boundary, extendSelection);
}

export function moveCaretToDocumentBoundary(
  state: EditorState,
  boundary: "start" | "end",
  extendSelection = false,
) {
  const targetRegion = resolveDocumentBoundaryRegion(state.documentIndex, boundary);

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

export function setSelectionAtPoint(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  const hit = resolveSelectionHit(state, viewport, point);

  return hit ? setSelection(state, { offset: hit.offset, regionId: hit.regionId }) : null;
}

export function extendSelectionToPoint(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  const hit = resolveSelectionHit(state, viewport, point);

  return hit ? setSelectionPoint(state, hit.regionId, hit.offset, true) : null;
}

export function updateSelectionFromDrag(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
  anchor: EditorSelectionPoint,
) {
  const focus = resolveDragFocus(state, viewport, point, anchor);

  return focus
    ? setSelection(state, {
        anchor,
        focus,
      })
    : null;
}

function measureSelectionCaret(state: EditorState, viewport: EditorLayoutState) {
  return measureCaretTarget(viewport.layout, state.documentIndex, {
    regionId: state.selection.focus.regionId,
    offset: state.selection.focus.offset,
  });
}
