// Owns point-to-editor-intent resolution over prepared layout geometry.

import type { EditorCommentRange } from "../anchors";
import {
  findDocumentLayoutLineAtPoint,
  measureCanvasLineOffsetLeft,
  resolveBoundaryOffset,
} from "../layout/query/line-lookup";
import {
  resolveLineContentInset,
  resolveListItemMarker,
  resolveTaskCheckboxBounds,
} from "../layout/query/line-visuals";
import type { DocumentLayout, DocumentLayoutLine } from "../layout/measure";
import {
  findAncestorBlockEntry,
  isInertBlock,
  nextBlockInFlow,
  regionInlines,
  resolveBlockEntry,
  resolveRegion,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import { resolveWordRangeAtOffset } from "../text/words";

export type EditorHit = {
  height: number;
  left: number;
  offset: number;
  regionId: string;
  top: number;
};

export type SelectionHit = {
  regionId: string;
  offset: number;
};

export type CanvasCheckboxHit = {
  listItemId: string;
};

export type CanvasLinkHit = {
  endOffset: number;
  regionId: string;
  startOffset: number;
  title: string | null;
  url: string;
};

export type EditorHoverTarget =
  | {
      endOffset: number;
      kind: "link";
      commentThreadIndex: number | null;
      regionId: string;
      startOffset: number;
      title: string | null;
      url: string;
    }
  | {
      kind: "task-toggle";
      listItemId: string;
    }
  | {
      kind: "text";
      commentThreadIndex: number | null;
    };

export function resolveEditorHitAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): EditorHit | null {
  const result = resolveLayoutLineAtPoint(layout, state, point);

  if (!result) {
    return null;
  }

  // Inert-redirect hits snap to the start of the redirected-to line; the
  // original click x is meaningless because the click landed on an inert
  // block whose chrome the line doesn't belong to.
  const offsetX = result.snapToLineStart ? result.line.left : point.x;
  return resolveHitOnLine(state, result.line, offsetX);
}

export function resolveHitBelowLayout(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): EditorHit | null {
  const lastLine = layout.lines[layout.lines.length - 1];

  if (!lastLine || point.y <= lastLine.top + lastLine.height) {
    return null;
  }

  return resolveHitOnLine(state, lastLine, point.x);
}

export function resolveSelectionHit(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
): SelectionHit | null {
  return (
    resolveEditorHitAtPoint(viewport.layout, state, point) ??
    resolveHitBelowLayout(viewport.layout, state, point)
  );
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

export function resolveDragFocus(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
  anchor: EditorSelectionPoint,
): SelectionHit | null {
  return resolveDragFocusPoint(viewport.layout, state, point, anchor);
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

  const range = resolveWordRangeAtOffset(container.text, hit.offset);

  if (!range) {
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

export function resolveWordSelection(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
) {
  return resolveWordSelectionAtPoint(viewport.layout, state, point);
}

export function resolveTaskCheckboxHitAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): CanvasCheckboxHit | null {
  const line = resolveInteractiveLineAtPoint(layout, point);

  if (!line || line.start !== 0) {
    return null;
  }

  const listItemEntry = findAncestorBlockEntry(state.documentIndex, line.blockId, "listItem");

  if (!listItemEntry) {
    return null;
  }

  const marker = resolveListItemMarker(state, listItemEntry.block.id);

  if (marker?.kind !== "task") {
    return null;
  }

  const bounds = resolveTaskCheckboxBounds(line);
  const left = bounds.left - 4;
  const right = bounds.left + bounds.size + 4;
  const top = bounds.top - 4;
  const bottom = bounds.top + bounds.size + 4;

  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
    ? {
        listItemId: listItemEntry.block.id,
      }
    : null;
}

export function resolveLinkHitAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): CanvasLinkHit | null {
  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (!hit) {
    return null;
  }

  const container = findContainer(state, hit.regionId);

  if (!container) {
    return null;
  }

  const run = regionInlines(container).find(
    (entry) => entry.link && hit.offset >= entry.start && hit.offset < entry.end,
  );

  if (!run?.link) {
    return null;
  }

  return {
    endOffset: run.end,
    regionId: hit.regionId,
    startOffset: run.start,
    title: run.link.title,
    url: run.link.url,
  };
}

export function resolveHoverTargetAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
  commentRanges: readonly EditorCommentRange[],
): EditorHoverTarget | null {
  const checkboxHit = resolveTaskCheckboxHitAtPoint(layout, state, point);

  if (checkboxHit) {
    return {
      kind: "task-toggle",
      listItemId: checkboxHit.listItemId,
    };
  }

  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (!hit) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtOffset(
    hit.regionId,
    hit.offset,
    commentRanges,
  );
  const linkHit = resolveLinkHitAtPoint(layout, state, point);

  if (linkHit) {
    return {
      endOffset: linkHit.endOffset,
      kind: "link",
      commentThreadIndex,
      regionId: linkHit.regionId,
      startOffset: linkHit.startOffset,
      title: linkHit.title,
      url: linkHit.url,
    };
  }

  return {
    kind: "text",
    commentThreadIndex,
  };
}

export function resolveHoverTarget(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
  commentRanges: readonly EditorCommentRange[],
): EditorHoverTarget | null {
  return resolveHoverTargetAtPoint(viewport.layout, state, point, commentRanges);
}

// Resolves what user-actionable target sits at a given document offset.
export function resolveTargetAtOffset(
  state: EditorState,
  regionId: string,
  offset: number,
  commentRanges: readonly EditorCommentRange[],
): EditorHoverTarget | null {
  const container = resolveRegion(state.documentIndex, regionId);

  if (!container) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtOffset(regionId, offset, commentRanges);
  const run =
    regionInlines(container).find((entry) => offset >= entry.start && offset <= entry.end) ?? null;

  if (run?.link) {
    return {
      commentThreadIndex,
      endOffset: run.end,
      kind: "link",
      regionId,
      startOffset: run.start,
      title: run.link.title,
      url: run.link.url,
    };
  }

  if (commentThreadIndex !== null) {
    return {
      commentThreadIndex,
      kind: "text",
    };
  }

  return null;
}

// Resolves a horizontal position on an already-identified line to a selection
// hit. This avoids re-resolving the line from coordinates, which can land on
// the wrong line when Y falls exactly on a line boundary.
function resolveHitOnLine(
  state: EditorState,
  line: DocumentLayoutLine,
  x: number,
): EditorHit | null {
  const region = resolveRegion(state.documentIndex, line.regionId);

  if (!region) {
    return null;
  }

  const localX = Math.max(0, x - resolveLineContentInset(state, line) - line.left);
  const offset = resolveBoundaryOffset(line.boundaries, localX);
  const resolvedOffset = Math.min(region.text.length, line.start + offset);

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
  const lineHit = findDocumentLayoutLineAtPoint(layout, point)?.line ?? null;

  if (lineHit) {
    return { line: lineHit };
  }

  // If the point is in a block's padding, resolve to the block's last line.
  // Inert leaf blocks have no lines of their own and redirect to the first
  // line of the next region in flow.
  for (const block of layout.blocks) {
    if (point.y < block.top || point.y > block.bottom) continue;

    for (let i = layout.lines.length - 1; i >= 0; i--) {
      if (layout.lines[i]!.blockId === block.id) {
        return { line: layout.lines[i]! };
      }
    }

    const blockEntry = resolveBlockEntry(state.documentIndex, block.id);
    if (blockEntry && isInertBlock(blockEntry)) {
      const nextLeaf = nextBlockInFlow(state.documentIndex, block.id);
      if (nextLeaf) {
        const firstLine = layout.lines.find((line) => line.blockId === nextLeaf.block.id);
        if (firstLine) return { line: firstLine, snapToLineStart: true };
      }
    }
  }

  return null;
}

function resolveCommentThreadIndexAtOffset(
  regionId: string,
  offset: number,
  commentRanges: readonly EditorCommentRange[],
) {
  for (const range of commentRanges) {
    if (range.regionId === regionId && offset >= range.startOffset && offset <= range.endOffset) {
      return range.threadIndex;
    }
  }

  return null;
}

function resolveInteractiveLineAtPoint(
  layout: DocumentLayout,
  point: { x: number; y: number },
): DocumentLayoutLine | null {
  return (
    layout.lines.find(
      (entry) => point.y >= entry.top - 4 && point.y <= entry.top + entry.height + 4,
    ) ??
    layout.lines
      .filter((entry) => Math.abs(point.y - (entry.top + entry.height / 2)) <= 10)
      .sort(
        (left, right) =>
          Math.abs(point.y - (left.top + left.height / 2)) -
          Math.abs(point.y - (right.top + right.height / 2)),
      )[0] ??
    null
  );
}

function findContainer(state: EditorState, regionId: string) {
  return resolveRegion(state.documentIndex, regionId);
}

function resolveViewportTop(layout: DocumentLayout) {
  return layout.lines[0]?.top ?? 0;
}
