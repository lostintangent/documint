// Owns caret target measurement and the visual-left adjustment that paint
// and keyboard navigation use to render the caret. Given a prepared
// `DocumentLayout` plus a (regionId, offset), resolves where the caret
// should land — including any visual offset from list-marker indent or
// trailing whitespace that the line wrapping collapsed.

import type { DocumentIndex, EditorState } from "../../state";
import { measureCanvasTextWidth } from "../../canvas/lib/fonts";
import type { DocumentLayout, DocumentLayoutLine } from "../measure";
import { findDocumentLayoutLineForRegionOffset, measureCanvasLineOffsetLeft } from "./lookup";
import { resolveLineContentInset } from "./geometry";

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
  const container = layout.regionMetrics.get(target.regionId);

  if (!container) {
    return null;
  }

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
    resolveLineContentInset(state, resolvedLine) +
    resolveCollapsedTrailingSpaceWidth(state, resolvedLine, caret.offset)
  );
}

function resolveCollapsedTrailingSpaceWidth(
  state: EditorState,
  line: DocumentLayoutLine,
  offset: number,
) {
  if (offset <= line.end) {
    return 0;
  }

  const container = state.documentIndex.regionIndex.get(line.regionId);

  if (!container) {
    return 0;
  }

  const hiddenTrailingText = container.text.slice(line.end, offset);

  if (!/^[ \t]+$/u.test(hiddenTrailingText)) {
    return 0;
  }

  return measureCanvasTextWidth(hiddenTrailingText, line.font);
}
