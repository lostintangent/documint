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
  nextRegionInFlow,
  previousRegionInFlow,
  isSelectionCollapsed,
  setSelection,
  setSelectionPoint,
  resolveDocumentBoundaryRegion,
  resolveRegion,
  type EditableRegion,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import {
  moveCaretByViewportInFlow,
  moveCaretHorizontallyInFlow,
  moveCaretToCurrentLineBoundary,
  moveCaretVerticallyInFlow,
} from "./line";
import { moveCaretVerticallyInTable, resolveVerticalTableRegionTarget } from "./table";
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

export { resolveEditorSearchMatches, type EditorSearchMatch } from "./search";

export type EditorNavigationMode = "block" | "text";

export type EditorNavigationOptions = {
  extendSelection?: boolean;
  mode?: EditorNavigationMode;
};

export function moveCaretHorizontally(
  state: EditorState,
  delta: -1 | 1,
  options: EditorNavigationOptions = {},
) {
  const extendSelection = options.extendSelection ?? false;

  return options.mode === "block"
    ? moveCaretToAdjacentRegion(state, delta, extendSelection)
    : moveCaretHorizontallyInFlow(state, delta, extendSelection);
}

export function moveCaretVertically(
  state: EditorState,
  viewport: EditorLayoutState,
  direction: -1 | 1,
  options: EditorNavigationOptions = {},
) {
  const extendSelection = options.extendSelection ?? false;

  if (options.mode === "block") {
    return moveCaretVerticallyByRegion(state, direction, extendSelection);
  }

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
  options: EditorNavigationOptions = {},
) {
  const extendSelection = options.extendSelection ?? false;

  if (options.mode === "block") {
    return moveCaretToCurrentRegionBoundary(state, boundary, extendSelection);
  }

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

function moveCaretVerticallyByRegion(
  state: EditorState,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  return (
    moveCaretVerticallyByTableRegion(state, direction, extendSelection) ??
    moveCaretToAdjacentRegion(state, direction, extendSelection)
  );
}

function moveCaretVerticallyByTableRegion(
  state: EditorState,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const target = resolveVerticalTableRegionTarget(state, direction);

  if (!target) {
    return null;
  }

  return target.targetRegion
    ? setRegionNavigationSelection(
        state,
        target.currentRegion,
        target.targetRegion,
        direction,
        extendSelection,
      )
    : state;
}

function moveCaretToAdjacentRegion(
  state: EditorState,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentRegion = resolveRegion(state.documentIndex, state.selection.focus.regionId);

  if (!currentRegion) {
    return state;
  }

  const targetRegion =
    direction < 0
      ? previousRegionInFlow(state.documentIndex, currentRegion.id)
      : nextRegionInFlow(state.documentIndex, currentRegion.id);

  return targetRegion
    ? setRegionNavigationSelection(state, currentRegion, targetRegion, direction, extendSelection)
    : state;
}

function moveCaretToCurrentRegionBoundary(
  state: EditorState,
  boundary: "Home" | "End",
  extendSelection: boolean,
) {
  const currentRegion = resolveRegion(state.documentIndex, state.selection.focus.regionId);

  return currentRegion
    ? setSelectionPoint(
        state,
        currentRegion.id,
        boundary === "Home" ? 0 : currentRegion.text.length,
        extendSelection,
      )
    : state;
}

function setRegionNavigationSelection(
  state: EditorState,
  currentRegion: EditableRegion,
  targetRegion: EditableRegion,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const focus = {
    regionId: targetRegion.id,
    offset: extendSelection && direction > 0 ? targetRegion.text.length : 0,
  };

  if (!extendSelection) {
    return setSelection(state, focus);
  }

  return setSelection(state, {
    anchor: isSelectionCollapsed(state.selection)
      ? {
          regionId: currentRegion.id,
          offset: direction > 0 ? 0 : currentRegion.text.length,
        }
      : state.selection.anchor,
    focus,
  });
}
