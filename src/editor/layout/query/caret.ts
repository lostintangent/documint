// Owns caret target measurement and the visual-left adjustment that paint
// and keyboard navigation use to render the caret. Given a prepared
// `DocumentLayout` plus a (path, offset), resolves where the caret
// should land — including the visual offset from list-marker indent.

import type { DocumentLayout, LayoutLine } from "../measure";
import { findDocumentLayoutLineForPathOffset, measureCanvasLineOffsetLeft } from "./line-lookup";

export type CaretTarget = {
  blockPath: string | null;
  path: string;
  height: number;
  left: number;
  offset: number;
  top: number;
};

export function measureDocumentCaretTarget(
  layout: DocumentLayout,
  target: { path: string; offset: number },
): CaretTarget | null {
  // No separate presence check — `findDocumentLayoutLineForPathOffset`
  // returns null for any path that isn't in this layout's path/line
  // index.
  const line = findDocumentLayoutLineForPathOffset(layout, target.path, target.offset);

  return line ? measureLineCaretTarget(line, target.offset) : null;
}

// Resolves the caret's line once for callers that need both the visual caret
// and the line it sits on, such as caret paint.
export function measureDocumentVisualCaret(
  layout: DocumentLayout,
  target: { path: string; offset: number },
): { caret: CaretTarget; line: LayoutLine } | null {
  const line = findDocumentLayoutLineForPathOffset(layout, target.path, target.offset);

  if (!line) {
    return null;
  }

  const caret = measureLineCaretTarget(line, target.offset);

  return { caret: { ...caret, left: caret.left + line.contentInset }, line };
}

// The caret's visual X, nudged one pixel right so hit-testing at this X
// doesn't land exactly on a text/cell boundary and resolve to the wrong
// side. Used by navigation when hit-testing the caret onto a target line
// (vertical motion, page motion, table column tracking).
export function resolveCaretHitTestX(layout: DocumentLayout, caret: CaretTarget) {
  const line = findDocumentLayoutLineForPathOffset(layout, caret.path, caret.offset);

  return caret.left + (line?.contentInset ?? 0) + 1;
}

function measureLineCaretTarget(line: LayoutLine, offset: number): CaretTarget {
  return {
    blockPath: line.blockPath,
    path: line.path,
    height: line.height,
    left: measureCanvasLineOffsetLeft(line, offset - line.start),
    offset,
    top: line.top,
  };
}
