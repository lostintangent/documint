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
  isMetadataPath,
  setSelection,
  setSelectionPoint,
  resolveEditorTextAtPath,
  normalizeSelection,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import {
  moveCaretHorizontallyInFlow,
  moveCaretToCurrentLineBoundary,
  moveCaretVerticallyInFlow,
} from "./line";
import type { WordMovement } from "../text/words";
import { moveCaretVerticallyInTable, resolveVerticalTablePathTarget } from "./table";
import { resolveWordNavigationTarget } from "./word";
export {
  isCanvasDirectActivationTarget,
  resolveEditorHitAtPoint,
  resolveHoverTarget,
  resolveSelectionPointAt,
  resolveTargetAtOffset,
  resolveWordSelection,
  type EditorHoverTarget,
} from "./hit";
import { canExtendSelectionBetweenPaths, resolveDragFocus, resolveSelectionPointAt } from "./hit";

export { resolveEditorSearchMatches } from "./search";

export type EditorNavigationMode = "block" | "text";

type EditorNavigationOptions = {
  extendSelection?: boolean;
  mode?: EditorNavigationMode;
};

export function moveCaretHorizontally(
  state: EditorState,
  delta: -1 | 1,
  options: EditorNavigationOptions = {},
) {
  const extendSelection = options.extendSelection ?? false;

  if (!extendSelection && !isSelectionCollapsed(state.selection)) {
    return collapseSelection(state, delta);
  }

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

  if (!extendSelection && !isSelectionCollapsed(state.selection)) {
    return collapseSelection(state, direction);
  }

  if (options.mode === "block") {
    return moveCaretToAdjacentPathWithText(state, direction, extendSelection);
  }

  const target = resolveWordNavigationTarget(state, movement);

  return target ? setSelectionPoint(state, target.path, target.offset, extendSelection) : state;
}

export function moveCaretVertically(
  state: EditorState,
  viewport: EditorLayoutState,
  direction: -1 | 1,
  options: EditorNavigationOptions = {},
): EditorState {
  const extendSelection = options.extendSelection ?? false;

  if (!extendSelection && !isSelectionCollapsed(state.selection)) {
    return moveFromSelectionEdge(state, direction, (from) =>
      moveCaretVertically(from, viewport, direction, options),
    );
  }

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
): EditorState {
  if (!extendSelection && !isSelectionCollapsed(state.selection)) {
    return moveFromSelectionEdge(state, direction, (from) =>
      moveCaretByViewport(from, viewport, direction),
    );
  }

  const caret = measureSelectionCaret(state, viewport);

  if (!caret) {
    return state;
  }

  // Land on the farthest line that fits in the viewport together with the line
  // the caret left, so revealing it keeps that line in view whatever either
  // line's height. Pixels rather than lines keep block gaps from skipping
  // unseen lines, and keep a page from a visible caret inside the virtualized
  // slice, whose overscan is at least a viewport. Mirrors VS Code / browser
  // contenteditable PageUp/PageDown behavior.
  return moveCaretVerticallyInFlow(
    state,
    viewport.layout,
    caret,
    direction,
    extendSelection,
    viewport.viewport.height,
  );
}

export function moveCaretToLineBoundary(
  state: EditorState,
  viewport: EditorLayoutState,
  boundary: "Home" | "End",
  options: EditorNavigationOptions = {},
): EditorState {
  const extendSelection = options.extendSelection ?? false;

  if (!extendSelection && !isSelectionCollapsed(state.selection)) {
    return moveFromSelectionEdge(state, boundary === "Home" ? -1 : 1, (from) =>
      moveCaretToLineBoundary(from, viewport, boundary, options),
    );
  }

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
  if (extendSelection && isMetadataPath(state.selection.focus.path)) {
    return state;
  }

  const targetPath =
    resolveDocumentTextPathBoundary(state.documentIndex, boundary) ??
    (boundary === "start"
      ? state.documentIndex.blocks[0]?.path
      : state.documentIndex.blocks.at(-1)?.path);

  if (!targetPath) {
    return state;
  }

  const targetText = resolveEditorTextAtPath(state.documentIndex, targetPath);
  return setSelectionPoint(
    state,
    targetPath,
    boundary === "end" ? (targetText?.length ?? 0) : 0,
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

  if (!hit) {
    return null;
  }

  const canExtend = canExtendSelectionBetweenPaths(state.selection.anchor.path, hit.path);

  if (!canExtend) {
    return null;
  }

  return setSelectionPoint(state, hit.path, hit.offset, true);
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

// An unextended move from a selection starts at the selection's edge in the
// direction of travel, as in macOS text fields: a horizontal move collapses
// to that edge, and vertical and line-boundary moves go on from it. Chrome on
// Windows and Linux moves those from the focus instead.
function collapseSelection(state: EditorState, direction: -1 | 1) {
  const { end, start } = normalizeSelection(state);

  return setSelection(state, direction < 0 ? start : end);
}

// Applies the move's selection to the original state, so the active-block
// flash compares against the block the focus left rather than the edge.
function moveFromSelectionEdge(
  state: EditorState,
  direction: -1 | 1,
  move: (from: EditorState) => EditorState,
) {
  return setSelection(state, move(collapseSelection(state, direction)).selection);
}

function measureSelectionCaret(state: EditorState, viewport: EditorLayoutState) {
  return measureCaretTarget(viewport.layout, state.selection.focus);
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
    ? setPathNavigationSelection(state, target.targetPath, direction, extendSelection)
    : state;
}

function moveCaretToAdjacentPathWithText(
  state: EditorState,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  // A focus without text has no flow neighbors, so it needs no separate guard.
  const targetPath = resolveAdjacentEditorPathWithTextInFlow(
    state.documentIndex,
    state.selection.focus.path,
    direction,
  );

  return targetPath
    ? setPathNavigationSelection(state, targetPath, direction, extendSelection)
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
  targetPath: string,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentPath = state.selection.focus.path;
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
