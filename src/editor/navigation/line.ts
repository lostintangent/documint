/**
 * Core line-based navigation semantics. This module owns the default caret and
 * range movement behavior for ordinary document flow outside block-type
 * overrides such as tables.
 */
import {
  findLineEntryForPathOffset,
  findLineForPathOffset,
  resolveCaretHitTestX,
  type CaretTarget,
  type DocumentLayout,
} from "../layout";
import { setSelectionPoint, type EditorState } from "../state";
import {
  resolveAdjacentEditorPathWithTextInFlow,
  resolveEditorTextAtPath,
} from "../state/index/query";
import { moveGraphemeOffset } from "../text/graphemes";
import { resolveEditorHitAtPoint } from "./hit";

export function moveCaretHorizontallyInFlow(
  state: EditorState,
  delta: -1 | 1,
  extendSelection: boolean,
) {
  const path = state.selection.focus.path;
  const text = resolveEditorTextAtPath(state.documentIndex, path);

  if (text === null) {
    return state;
  }
  const nextOffset = moveGraphemeOffset(text, state.selection.focus.offset, delta);

  if (nextOffset !== state.selection.focus.offset) {
    return setSelectionPoint(state, path, nextOffset, extendSelection);
  }

  const adjacentPath = resolveAdjacentEditorPathWithTextInFlow(state.documentIndex, path, delta);

  if (!adjacentPath) {
    return state;
  }

  // Flow paths always carry text (text blocks or table cells).
  const adjacentOffset =
    delta < 0 ? (resolveEditorTextAtPath(state.documentIndex, adjacentPath)?.length ?? 0) : 0;

  return setSelectionPoint(state, adjacentPath, adjacentOffset, extendSelection);
}

export function moveCaretVerticallyInFlow(
  state: EditorState,
  layout: DocumentLayout,
  caret: CaretTarget,
  direction: -1 | 1,
  extendSelection: boolean,
  pageHeight = 0,
) {
  const currentLine = findLineEntryForPathOffset(layout, caret.path, caret.offset);

  if (!currentLine) {
    return state;
  }

  const targetLine = resolveVerticalTargetLine(layout, currentLine.index, direction, pageHeight);

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
  const currentLine = findLineForPathOffset(
    layout,
    state.selection.focus.path,
    state.selection.focus.offset,
  );

  if (!currentLine) {
    return state;
  }

  return setSelectionPoint(
    state,
    currentLine.path,
    boundary === "Home" ? currentLine.start : currentLine.end,
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
    x: resolveCaretHitTestX(layout, caret),
    y,
  });

  if (!hit) {
    return state;
  }

  return setSelectionPoint(state, hit.path, hit.offset, extendSelection);
}

function resolveVerticalTargetLine(
  layout: DocumentLayout,
  currentLineIndex: number,
  direction: -1 | 1,
  pageHeight: number,
) {
  const currentLine = layout.lines[currentLineIndex];

  if (!currentLine) {
    return null;
  }

  // Step to the next line in flow, then keep stepping while that line and the
  // current one fit within `pageHeight` together, so a page move near either
  // edge lands on the first or last line.
  let target = null;

  for (
    let index = currentLineIndex + direction;
    index >= 0 && index < layout.lines.length;
    index += direction
  ) {
    const candidate = layout.lines[index]!;
    const sharesNavigationFlow =
      currentLine.blockPath === null
        ? candidate.blockPath === null && candidate.path === currentLine.path
        : candidate.blockPath !== null;

    if (!sharesNavigationFlow) {
      continue;
    }

    const span =
      direction > 0
        ? candidate.top + candidate.height - currentLine.top
        : currentLine.top + currentLine.height - candidate.top;

    if (target && span > pageHeight) {
      break;
    }

    target = candidate;
  }

  return target;
}
