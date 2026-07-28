/**
 * Editor navigation helpers for caret motion and range extension. This
 * boundary keeps call sites semantic while splitting core line-based movement
 * from table-specific vertical overrides.
 *
 * Layout-aware motion (vertical, page, line boundary) takes the prepared
 * `EditorLayoutState` so it has access to both layout geometry and viewport
 * metrics. Path-only motion (horizontal, document boundary) takes just the
 * state.
 */
import { measureCaretTarget, type EditorLayoutState, type EditorPoint } from "../layout";
import {
  resolveDocumentTextPathBoundary,
  resolveAdjacentEditorPathWithTextInFlow,
  isSelectionCollapsed,
  setSelection,
  setSelectionPoint,
  resolveEditorTextAtPath,
  normalizeSelection,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import {
  moveCaretByViewportInFlow,
  moveCaretHorizontallyInFlow,
  moveCaretToCurrentLineBoundary,
  moveCaretVerticallyInFlow,
} from "./line";
import type { WordMovement } from "../text/words";
import { moveCaretVerticallyInTable, resolveVerticalTablePathTarget } from "./table";
import { resolveWordNavigationTarget } from "./word";
export {
  resolveDragFocus,
  resolveDragFocusPoint,
  resolveEditorHitAtPoint,
  resolveHoverTarget,
  resolveHoverTargetAtPoint,
  resolveLinkHitAtPoint,
  resolveSelectionPointAt,
  resolveTargetAtOffset,
  resolveTaskCheckboxHitAtPoint,
  resolveWordSelection,
  resolveWordSelectionAtPoint,
  type EditorHoverTarget,
  type EditorHit,
} from "./hit";
import { resolveDragFocus, resolveSelectionPointAt } from "./hit";

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
    ? moveCaretToAdjacentPathWithText(state, delta, extendSelection)
    : moveCaretHorizontallyInFlow(state, delta, extendSelection);
}

export function moveCaretByWord(
  state: EditorState,
  movement: WordMovement,
  options: EditorNavigationOptions = {},
) {
  const extendSelection = options.extendSelection ?? false;
  const direction = movement === "previousWord" ? -1 : 1;

  if (options.mode === "block") {
    return moveCaretHorizontally(state, direction, {
      extendSelection,
      mode: "block",
    });
  }

  if (!extendSelection && !isSelectionCollapsed(state.selection)) {
    const selection = normalizeSelection(state);
    return setSelection(state, direction < 0 ? selection.start : selection.end);
  }

  const target = resolveWordNavigationTarget(state, movement);

  return target ? setSelectionPoint(state, target.path, target.offset, extendSelection) : state;
}

export function moveCaretVertically(
  state: EditorState,
  viewport: EditorLayoutState,
  direction: -1 | 1,
  options: EditorNavigationOptions = {},
) {
  const extendSelection = options.extendSelection ?? false;

  if (options.mode === "block") {
    return moveCaretVerticallyByBlockMode(state, direction, extendSelection);
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
    return moveCaretToCurrentPathBoundary(state, boundary, extendSelection);
  }

  return moveCaretToCurrentLineBoundary(state, viewport.layout, boundary, extendSelection);
}

export function moveCaretToDocumentBoundary(
  state: EditorState,
  boundary: "start" | "end",
  extendSelection = false,
) {
  const targetPath = resolveDocumentTextPathBoundary(state.documentIndex, boundary);
  const targetText = targetPath ? resolveEditorTextAtPath(state.documentIndex, targetPath) : null;

  if (!targetPath || targetText === null) {
    return state;
  }

  return setSelectionPoint(
    state,
    targetPath,
    boundary === "start" ? 0 : targetText.length,
    extendSelection,
  );
}

export function setSelectionAtPoint(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  const hit = resolveSelectionPointAt(state, viewport, point);

  return hit ? setSelection(state, hit) : null;
}

export function extendSelectionToPoint(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorPoint,
) {
  const hit = resolveSelectionPointAt(state, viewport, point);

  return hit ? setSelectionPoint(state, hit.path, hit.offset, true) : null;
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
    path: state.selection.focus.path,
    offset: state.selection.focus.offset,
  });
}

function moveCaretVerticallyByBlockMode(
  state: EditorState,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  return (
    moveCaretVerticallyByTablePath(state, direction, extendSelection) ??
    moveCaretToAdjacentPathWithText(state, direction, extendSelection)
  );
}

function moveCaretVerticallyByTablePath(
  state: EditorState,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const target = resolveVerticalTablePathTarget(state, direction);

  if (!target) {
    return null;
  }

  return target.targetPath
    ? setPathNavigationSelection(
        state,
        target.currentPath,
        target.targetPath,
        direction,
        extendSelection,
      )
    : state;
}

function moveCaretToAdjacentPathWithText(
  state: EditorState,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentPath = state.selection.focus.path;
  const currentText = resolveEditorTextAtPath(state.documentIndex, currentPath);

  if (currentText === null) {
    return state;
  }

  const targetPath = resolveAdjacentEditorPathWithTextInFlow(
    state.documentIndex,
    currentPath,
    direction,
  );

  return targetPath
    ? setPathNavigationSelection(state, currentPath, targetPath, direction, extendSelection)
    : state;
}

function moveCaretToCurrentPathBoundary(
  state: EditorState,
  boundary: "Home" | "End",
  extendSelection: boolean,
) {
  const currentPath = state.selection.focus.path;
  const currentText = resolveEditorTextAtPath(state.documentIndex, currentPath);

  return currentText !== null
    ? setSelectionPoint(
        state,
        currentPath,
        boundary === "Home" ? 0 : currentText.length,
        extendSelection,
      )
    : state;
}

function setPathNavigationSelection(
  state: EditorState,
  currentPath: string,
  targetPath: string,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentText = resolveEditorTextAtPath(state.documentIndex, currentPath);
  const targetText = resolveEditorTextAtPath(state.documentIndex, targetPath);

  if (currentText === null || targetText === null) {
    return state;
  }

  const focus = {
    path: targetPath,
    offset: extendSelection && direction > 0 ? targetText.length : 0,
  };

  if (!extendSelection) {
    return setSelection(state, focus);
  }

  return setSelection(state, {
    anchor: isSelectionCollapsed(state.selection)
      ? {
          path: currentPath,
          offset: direction > 0 ? 0 : currentText.length,
        }
      : state.selection.anchor,
    focus,
  });
}
