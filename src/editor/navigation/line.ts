/**
 * Core line-based navigation semantics. This module owns the default caret and
 * range movement behavior for ordinary document flow outside block-type
 * overrides such as tables.
 */
import {
  findLineEntryForRegionOffset,
  findLineForRegionOffset,
  resolveCaretVisualLeft,
  resolveEditorHitAtPoint,
  type CaretTarget,
  type DocumentLayout,
} from "../layout";
import {
  nextRegionInFlow,
  previousRegionInFlow,
  setSelectionPoint,
  type EditorState,
} from "../state";

// Small rightward nudge when hit-testing at a caret's visual X to avoid
// landing exactly on a region boundary and resolving to the wrong side.
const HIT_TEST_X_NUDGE = 1;

export function moveCaretHorizontallyInFlow(
  state: EditorState,
  delta: -1 | 1,
  extendSelection: boolean,
) {
  const regionIndex = state.documentIndex.regionOrderIndex.get(state.selection.focus.regionId);

  if (regionIndex === undefined) {
    return state;
  }

  const container = state.documentIndex.regions[regionIndex]!;
  const nextOffset = state.selection.focus.offset + delta;

  if (nextOffset >= 0 && nextOffset <= container.text.length) {
    return setSelectionPoint(state, container.id, nextOffset, extendSelection);
  }

  if (delta < 0) {
    const previousContainer = previousRegionInFlow(state.documentIndex, container.id);

    if (!previousContainer) {
      return state;
    }

    return setSelectionPoint(
      state,
      previousContainer.id,
      previousContainer.text.length,
      extendSelection,
    );
  }

  const nextContainer = nextRegionInFlow(state.documentIndex, container.id);

  if (!nextContainer) {
    return state;
  }

  return setSelectionPoint(state, nextContainer.id, 0, extendSelection);
}

export function moveCaretVerticallyInFlow(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentLine = findLineEntryForRegionOffset(layout, caret.regionId, caret.offset);

  if (!currentLine) {
    return state;
  }

  const targetLine = layout.lines[currentLine.index + direction];

  if (!targetLine) {
    return state;
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: resolveCaretVisualLeft(state, layout, caret) + HIT_TEST_X_NUDGE,
    y: targetLine.top + targetLine.height / 2,
  });

  if (!hit) {
    return state;
  }

  return setSelectionPoint(state, hit.regionId, hit.offset, extendSelection);
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
    currentLine.regionId,
    boundary === "Home" ? currentLine.start : currentLine.end,
    extendSelection,
  );
}

export function moveCaretByViewportInFlow(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
) {
  const currentLine = findCurrentLine(state, layout);

  if (!currentLine) {
    return state;
  }

  // Approximate viewport height for page-up/page-down line count estimation.
  const VIEWPORT_HEIGHT_ESTIMATE = 480;
  const linesPerViewport = Math.max(
    1,
    Math.floor(VIEWPORT_HEIGHT_ESTIMATE / layout.options.lineHeight),
  );
  const currentLineEntry = findLineEntryForRegionOffset(
    layout,
    currentLine.regionId,
    state.selection.focus.offset,
  );
  const targetLine = currentLineEntry
    ? layout.lines[currentLineEntry.index + direction * linesPerViewport]
    : null;

  if (!targetLine) {
    return state;
  }

  const hit = resolveEditorHitAtPoint(layout, state, {
    x: resolveCaretVisualLeft(state, layout, caret) + HIT_TEST_X_NUDGE,
    y: targetLine.top + targetLine.height / 2,
  });

  if (!hit) {
    return state;
  }

  return setSelectionPoint(state, hit.regionId, hit.offset, extendSelection);
}

function findCurrentLine(state: EditorState, layout: DocumentLayout) {
  return findLineForRegionOffset(
    layout,
    state.selection.focus.regionId,
    state.selection.focus.offset,
  );
}
