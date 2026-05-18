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
import {
  measureCaretTarget,
  resolveLayoutDragFocus,
  resolveLayoutSelectionHit,
  type EditorLayoutState,
  type EditorPoint,
} from "../layout";
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

export {
  firstInFlowRegionOfRoot,
  isContainerBlock,
  isInertBlock,
  nextBlockInFlow,
  nextRegionInFlow,
  previousBlockInFlow,
  previousRegionInFlow,
} from "./flow";

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

function measureSelectionCaret(state: EditorState, viewport: EditorLayoutState) {
  return measureCaretTarget(viewport.layout, state.documentIndex, {
    regionId: state.selection.focus.regionId,
    offset: state.selection.focus.offset,
  });
}
