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
  type ViewportLayout,
} from "../layout";
import { setCanvasSelection, type EditorState } from "../model/state";

export function moveCaretHorizontallyInFlow(
  state: EditorState,
  delta: -1 | 1,
  extendSelection: boolean,
) {
  const regionIndex = state.documentEditor.regions.findIndex(
    (entry) => entry.id === state.selection.focus.regionId,
  );

  if (regionIndex === -1) {
    return state;
  }

  const container = state.documentEditor.regions[regionIndex]!;
  const nextOffset = state.selection.focus.offset + delta;

  if (nextOffset >= 0 && nextOffset <= container.text.length) {
    return setSelectionPoint(state, container.id, nextOffset, extendSelection);
  }

  if (delta < 0) {
    const previousContainer = state.documentEditor.regions[regionIndex - 1];

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

  const nextContainer = state.documentEditor.regions[regionIndex + 1];

  if (!nextContainer) {
    return state;
  }

  return setSelectionPoint(state, nextContainer.id, 0, extendSelection);
}

export function extendSelectionHorizontallyInFlow(
  state: EditorState,
  delta: -1 | 1,
) {
  return moveCaretHorizontallyInFlow(state, delta, true);
}

export function moveCaretVerticallyInFlow(
  state: EditorState,
  layout: ViewportLayout,
  caret: CaretTarget,
  direction: -1 | 1,
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
    x: resolveCaretVisualLeft(state, layout, caret) + 1,
    y: targetLine.top + targetLine.height / 2,
  });

  if (!hit) {
    return state;
  }

  return setCanvasSelection(state, {
    regionId: hit.regionId,
    offset: hit.offset,
  });
}

export function moveCaretToCurrentLineBoundary(
  state: EditorState,
  layout: ViewportLayout,
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

export function extendSelectionToCurrentLineBoundary(
  state: EditorState,
  layout: ViewportLayout,
  boundary: "Home" | "End",
) {
  return moveCaretToCurrentLineBoundary(state, layout, boundary, true);
}

export function moveCaretByViewportInFlow(
  state: EditorState,
  layout: ViewportLayout,
  caret: CaretTarget,
  direction: -1 | 1,
) {
  const currentLine = findCurrentLine(state, layout);

  if (!currentLine) {
    return state;
  }

  const linesPerViewport = Math.max(1, Math.floor(480 / layout.options.lineHeight));
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
    x: resolveCaretVisualLeft(state, layout, caret) + 1,
    y: targetLine.top + targetLine.height / 2,
  });

  if (!hit) {
    return state;
  }

  return setCanvasSelection(state, {
    regionId: hit.regionId,
    offset: hit.offset,
  });
}

function findCurrentLine(state: EditorState, layout: ViewportLayout) {
  return findLineForRegionOffset(
    layout,
    state.selection.focus.regionId,
    state.selection.focus.offset,
  );
}

function setSelectionPoint(
  state: EditorState,
  regionId: string,
  offset: number,
  extendSelection: boolean,
) {
  if (extendSelection) {
    return setCanvasSelection(state, {
      anchor: state.selection.anchor,
      focus: {
        regionId,
        offset,
      },
    });
  }

  return setCanvasSelection(state, {
    regionId,
    offset,
  });
}
