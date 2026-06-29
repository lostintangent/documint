// Owns point-to-line resolution against a prepared `DocumentLayout`.

import { type DocumentIndex } from "../../state";
import { resolveRegion } from "../../state/index/query";
import type { DocumentLayout } from "../measure";
import type { DocumentCaretTarget } from "./caret";
import {
  findDocumentLayoutLineAtPoint,
  measureCanvasLineOffsetLeft,
  resolveBoundaryOffset,
} from "./line-lookup";

export type DocumentHitTestResult = DocumentCaretTarget & {
  lineIndex: number;
};

// Layout-only hit test: given a point, return the line + offset it lands on.
// Knows nothing about list markers, inert blocks, or other editor concerns.
export function hitTestDocumentLayout(
  layout: DocumentLayout,
  documentIndex: DocumentIndex,
  point: { x: number; y: number },
): DocumentHitTestResult | null {
  const lineEntry = findDocumentLayoutLineAtPoint(layout, point);

  if (!lineEntry) {
    return null;
  }

  const { index: lineIndex, line } = lineEntry;
  // The line came from this layout, so its region is in scope; the lookup
  // is here to read the region's full text length for the offset clamp
  // (clicking past the end of the last line should land at the region's
  // end, not the line's).
  const region = resolveRegion(documentIndex, line.regionPath);

  if (!region) {
    return null;
  }

  const localX = Math.max(0, point.x - line.left);
  const offset = resolveBoundaryOffset(line.boundaries, localX);

  return {
    blockPath: line.blockPath,
    regionPath: line.regionPath,
    height: line.height,
    left: measureCanvasLineOffsetLeft(line, offset),
    lineIndex,
    offset: Math.min(region.text.length, line.start + offset),
    top: line.top,
  };
}
