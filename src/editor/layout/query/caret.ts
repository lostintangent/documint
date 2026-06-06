// Owns caret target measurement and the visual-left adjustment that paint
// and keyboard navigation use to render the caret. Given a prepared
// `DocumentLayout` plus a (regionId, offset), resolves where the caret
// should land — including any visual offset from list-marker indent or
// trailing whitespace that the line wrapping collapsed.

import { resolveRegion, type DocumentIndex, type EditorState } from "../../state";
import { measureTextWidth } from "../../text/measure";
import type { DocumentLayout, LayoutLine } from "../measure";
import { findDocumentLayoutLineForRegionOffset, measureCanvasLineOffsetLeft } from "./line-lookup";

export type DocumentCaretTarget = {
  blockId: string;
  regionId: string;
  height: number;
  left: number;
  offset: number;
  top: number;
};

export function measureDocumentCaretTarget(
  layout: DocumentLayout,
  _documentIndex: DocumentIndex,
  target: { regionId: string; offset: number },
): DocumentCaretTarget | null {
  // No separate presence check — `findDocumentLayoutLineForRegionOffset`
  // returns null for any regionId that isn't in this layout's region/line
  // index, which is the same condition the old `regionMetrics.get` covered.
  const line = findDocumentLayoutLineForRegionOffset(layout, target.regionId, target.offset);

  if (!line) {
    return null;
  }

  return {
    blockId: line.blockId,
    regionId: line.regionId,
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
  const resolvedLine = findDocumentLayoutLineForRegionOffset(layout, caret.regionId, caret.offset);

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
// doesn't land exactly on a region/cell boundary and resolve to the wrong
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

  const container = resolveRegion(state.documentIndex, line.regionId);

  if (!container) {
    return 0;
  }

  const hiddenTrailingText = container.text.slice(line.end, offset);

  if (!/^[ \t]+$/u.test(hiddenTrailingText)) {
    return 0;
  }

  return measureTextWidth(hiddenTrailingText, line.font);
}
