// Owns caret target measurement and the visual-left adjustment that paint
// and keyboard navigation use to render the caret. Given a prepared
// `DocumentLayout` plus a (path, offset), resolves where the caret
// should land — including any visual offset from list-marker indent or
// trailing whitespace that the line wrapping collapsed.

import { resolveEditorTextAtPath, type DocumentIndex, type EditorState } from "../../state";
import { measureTextWidth } from "../../text/measure";
import type { DocumentLayout, LayoutLine } from "../measure";
import { findDocumentLayoutLineForPathOffset, measureCanvasLineOffsetLeft } from "./line-lookup";

export type DocumentCaretTarget = {
  blockPath: string;
  path: string;
  height: number;
  left: number;
  offset: number;
  top: number;
};

export function measureDocumentCaretTarget(
  layout: DocumentLayout,
  _documentIndex: DocumentIndex,
  target: { path: string; offset: number },
): DocumentCaretTarget | null {
  // No separate presence check — `findDocumentLayoutLineForPathOffset`
  // returns null for any path that isn't in this layout's path/line
  // index.
  const line = findDocumentLayoutLineForPathOffset(layout, target.path, target.offset);

  if (!line) {
    return null;
  }

  return {
    blockPath: line.blockPath,
    path: line.path,
    height: line.height,
    left: measureCanvasLineOffsetLeft(line, target.offset - line.start),
    offset: target.offset,
    top: line.top,
  };
}

export function resolveCaretVisualLeft(
  state: EditorState,
  layout: DocumentLayout,
  caret: NonNullable<ReturnType<typeof measureDocumentCaretTarget>>,
) {
  const resolvedLine = findDocumentLayoutLineForPathOffset(layout, caret.path, caret.offset);

  if (!resolvedLine) {
    return caret.left;
  }

  return (
    caret.left +
    resolvedLine.contentInset +
    resolveCollapsedTrailingSpaceWidth(state, resolvedLine, caret.offset)
  );
}

// The caret's visual X, nudged one pixel right so hit-testing at this X
// doesn't land exactly on a text/cell boundary and resolve to the wrong
// side. Used by navigation when hit-testing the caret onto a target line
// (vertical motion, page motion, table column tracking).
export function resolveCaretHitTestX(
  state: EditorState,
  layout: DocumentLayout,
  caret: NonNullable<ReturnType<typeof measureDocumentCaretTarget>>,
) {
  return resolveCaretVisualLeft(state, layout, caret) + 1;
}

function resolveCollapsedTrailingSpaceWidth(state: EditorState, line: LayoutLine, offset: number) {
  if (offset <= line.end) {
    return 0;
  }

  const text = resolveEditorTextAtPath(state.documentIndex, line.path);

  if (text === null) {
    return 0;
  }

  const hiddenTrailingText = text.slice(line.end, offset);

  if (!/^[ \t]+$/u.test(hiddenTrailingText)) {
    return 0;
  }

  return measureTextWidth(hiddenTrailingText, line.font);
}
