// Owns pointer-to-selection resolution against a prepared `DocumentLayout`.
// Given a click/drag point, finds the line and offset the user landed on,
// including inert-block redirects, drag focus, and word selection.

import {
  isInertBlock,
  nextBlockInFlow,
  type DocumentIndex,
  type EditorSelectionPoint,
  type EditorState,
} from "../../state";
import type { DocumentLayout, DocumentLayoutLine } from "../measure";
import type { DocumentCaretTarget } from "./caret";
import {
  findDocumentLayoutLineAtPoint,
  findNearestDocumentLayoutLineForRegion,
  measureCanvasLineOffsetLeft,
  resolveBoundaryOffset,
} from "./lookup";
import { resolveLineContentInset } from "./geometry";

export type DocumentHitTestResult = DocumentCaretTarget & {
  lineIndex: number;
};

// Layout-only hit test: given a point, return the line + offset it lands on.
// Knows nothing about list markers, inert blocks, or other editor concerns —
// `resolveEditorHitAtPoint` layers those on top.
export function hitTestDocumentLayout(
  layout: DocumentLayout,
  _documentIndex: DocumentIndex,
  point: { x: number; y: number },
): DocumentHitTestResult | null {
  const lineEntry = findDocumentLayoutLineAtPoint(layout, point);

  if (!lineEntry) {
    return null;
  }

  const { index: lineIndex, line } = lineEntry;
  const container = layout.regionMetrics.get(line.regionId);

  if (!container) {
    return null;
  }

  const localX = Math.max(0, point.x - line.left);
  const offset = resolveBoundaryOffset(line.boundaries, localX);

  return {
    blockId: line.blockId,
    regionId: line.regionId,
    height: line.height,
    left: measureCanvasLineOffsetLeft(line, offset),
    lineIndex,
    offset: Math.min(container.textLength, line.start + offset),
    top: line.top,
  };
}

export function resolveEditorHitAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
) {
  const result = resolveLayoutLineAtPoint(layout, state, point);

  if (!result) {
    return null;
  }

  // Inert-redirect hits snap to the start of the redirected-to line; the
  // original click x is meaningless because the click landed on an inert
  // block whose chrome the line doesn't belong to.
  const offsetX = result.snapToLineStart ? result.line.left : point.x;
  return resolveHitOnLine(layout, state, result.line, offsetX);
}

export function resolveHitBelowLayout(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
) {
  const lastLine = layout.lines[layout.lines.length - 1];

  if (!lastLine || point.y <= lastLine.top + lastLine.height) {
    return null;
  }

  return resolveHitOnLine(layout, state, lastLine, point.x);
}

// Resolves the focus point of a mouse drag. The focus follows the pointer's
// hit across any region; if the pointer overshoots the document's content
// edge, it clamps to the anchor region's near edge instead of collapsing.
export function resolveDragFocusPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
  anchor: EditorSelectionPoint,
): EditorSelectionPoint | null {
  const anchorContainer = findContainer(state, anchor.regionId);

  if (!anchorContainer) {
    return null;
  }

  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (hit) {
    return {
      regionId: hit.regionId,
      offset: hit.offset,
    };
  }

  const isAboveLayout = point.y < resolveViewportTop(layout);

  return {
    regionId: anchor.regionId,
    offset: isAboveLayout ? 0 : anchorContainer.text.length,
  };
}

export function resolveWordSelectionAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
) {
  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (!hit) {
    return null;
  }

  const container = findContainer(state, hit.regionId);

  if (!container || container.text.length === 0) {
    return null;
  }

  const offset =
    hit.offset < container.text.length && /\w/.test(container.text[hit.offset] ?? "")
      ? hit.offset
      : hit.offset > 0 && /\w/.test(container.text[hit.offset - 1] ?? "")
        ? hit.offset - 1
        : hit.offset;
  const range = expandWordRange(container.text, offset);

  if (range.start === range.end) {
    return null;
  }

  return {
    anchor: {
      regionId: hit.regionId,
      offset: range.start,
    },
    focus: {
      regionId: hit.regionId,
      offset: range.end,
    },
  };
}

// Resolves a horizontal position on an already-identified line to a selection
// hit. This avoids re-resolving the line from coordinates, which can land on
// the wrong line when Y falls exactly on a line boundary.
function resolveHitOnLine(
  layout: DocumentLayout,
  state: EditorState,
  line: DocumentLayoutLine,
  x: number,
) {
  const container = layout.regionMetrics.get(line.regionId);

  if (!container) {
    return null;
  }

  const localX = Math.max(0, x - resolveLineContentInset(state, line) - line.left);
  const offset = resolveBoundaryOffset(line.boundaries, localX);
  const resolvedOffset = Math.min(container.textLength, line.start + offset);

  return {
    regionId: line.regionId,
    offset: resolvedOffset,
    left: measureCanvasLineOffsetLeft(line, offset),
    top: line.top,
    height: line.height,
  };
}

type LayoutLineHit = {
  line: DocumentLayoutLine;
  // Inert-redirect hits should snap to the start of the resolved line
  // rather than computing an offset from the original click x (the
  // click landed on the inert block, not on this line's content).
  snapToLineStart?: boolean;
};

function resolveLayoutLineAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): LayoutLineHit | null {
  for (const [regionId, extent] of layout.regionBounds) {
    if (
      point.x >= extent.left &&
      point.x <= extent.right &&
      point.y >= extent.top &&
      point.y <= extent.bottom
    ) {
      const line = findNearestDocumentLayoutLineForRegion(layout, regionId, point.y)?.line ?? null;
      return line ? { line } : null;
    }
  }

  const lineHit = findDocumentLayoutLineAtPoint(layout, point)?.line ?? null;

  if (lineHit) {
    return { line: lineHit };
  }

  // If the point is in a block's padding (e.g. below a heading's text but
  // above the next block), resolve to the block's last line. Inert leaf
  // blocks have no lines of their own — clicks on them redirect to the
  // first line of the next region in flow, landing the caret at the start
  // of the following block rather than nowhere.
  for (const block of layout.blocks) {
    if (point.y < block.top || point.y > block.bottom) continue;

    for (let i = layout.lines.length - 1; i >= 0; i--) {
      if (layout.lines[i]!.blockId === block.id) {
        return { line: layout.lines[i]! };
      }
    }

    const blockEntry = state.documentIndex.blockIndex.get(block.id);
    if (blockEntry && isInertBlock(blockEntry)) {
      const nextLeaf = nextBlockInFlow(state.documentIndex, block.id);
      if (nextLeaf) {
        const firstLine = layout.lines.find((line) => line.blockId === nextLeaf.id);
        if (firstLine) return { line: firstLine, snapToLineStart: true };
      }
    }
  }

  return null;
}

function findContainer(state: EditorState, regionId: string) {
  return state.documentIndex.regionIndex.get(regionId) ?? null;
}

function resolveViewportTop(layout: DocumentLayout) {
  return layout.lines[0]?.top ?? 0;
}

function expandWordRange(text: string, offset: number) {
  let start = offset;
  let end = offset;

  while (start > 0 && /\w/.test(text[start - 1] ?? "")) {
    start -= 1;
  }

  while (end < text.length && /\w/.test(text[end] ?? "")) {
    end += 1;
  }

  return {
    end,
    start,
  };
}
