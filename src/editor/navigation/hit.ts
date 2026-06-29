// Owns point-to-editor-intent resolution over prepared layout geometry.

import type { EditorCommentRange } from "../anchors";
import {
  findDocumentLayoutLineAtPoint,
  measureCanvasLineOffsetLeft,
  resolveBoundaryOffset,
} from "../layout/query/line-lookup";
import {
  resolveListMarkerTarget,
  resolveTaskCheckboxBounds,
} from "../layout/query/line-visuals";
import type { DocumentLayout, LayoutLine } from "../layout/measure";
import {
  isInertBlock,
  nextBlockInFlow,
  regionInlines,
  resolveIndexedBlock,
  resolveRegion,
  type EditorSelectionPoint,
  type EditorState,
} from "../state";
import { resolveWordRangeAtOffset } from "../text/words";

export type EditorHit = {
  height: number;
  left: number;
  offset: number;
  regionPath: string;
  top: number;
};

export type SelectionHit = {
  regionPath: string;
  offset: number;
};

export type CanvasCheckboxHit = {
  listItemPath: string;
};

export type CanvasLinkHit = {
  endOffset: number;
  regionPath: string;
  startOffset: number;
  title: string | null;
  url: string;
};

export type CanvasResourceHit = {
  label: string;
  protocol: string;
  regionPath: string;
  url: string;
};

export type EditorHoverTarget =
  | {
      endOffset: number;
      kind: "link";
      commentThreadIndex: number | null;
      regionPath: string;
      startOffset: number;
      title: string | null;
      url: string;
    }
  | {
      kind: "resource";
      commentThreadIndex: number | null;
      label: string;
      protocol: string;
      regionPath: string;
      url: string;
    }
  | {
      kind: "task-toggle";
      listItemPath: string;
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
  const anchorContainer = findContainer(state, anchor.regionPath);

  if (!anchorContainer) {
    return null;
  }

  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (hit) {
    return {
      regionPath: hit.regionPath,
      offset: hit.offset,
    };
  }

  const isAboveLayout = point.y < resolveViewportTop(layout);

  return {
    regionPath: anchor.regionPath,
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

  const container = findContainer(state, hit.regionPath);

  if (!container || container.text.length === 0) {
    return null;
  }

  const range = resolveWordRangeAtOffset(container.text, hit.offset);

  if (!range) {
    return null;
  }

  return {
    anchor: {
      regionPath: hit.regionPath,
      offset: range.start,
    },
    focus: {
      regionPath: hit.regionPath,
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

  if (!line) {
    return null;
  }

  const target = resolveListMarkerTarget(state, line);

  if (target?.marker.kind !== "task") {
    return null;
  }

  const bounds = resolveTaskCheckboxBounds(line);
  const left = bounds.left - 4;
  const right = bounds.left + bounds.size + 4;
  const top = bounds.top - 4;
  const bottom = bounds.top + bounds.size + 4;

  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
    ? {
        listItemPath: target.listItemPath,
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

  return resolveLinkHit(state, hit);
}

function resolveLinkHit(state: EditorState, hit: EditorHit): CanvasLinkHit | null {
  const container = findContainer(state, hit.regionPath);

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
    regionPath: hit.regionPath,
    startOffset: run.start,
    title: run.link.title,
    url: run.link.url,
  };
}

export function resolveResourceHitAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): CanvasResourceHit | null {
  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (!hit) {
    return null;
  }

  return resolveResourceHit(state, hit);
}

function resolveResourceHit(state: EditorState, hit: EditorHit): CanvasResourceHit | null {
  const container = findContainer(state, hit.regionPath);

  if (!container) {
    return null;
  }

  const run = regionInlines(container).find(
    (entry) =>
      entry.node.type === "resource" && hit.offset >= entry.start && hit.offset <= entry.end,
  );

  if (run?.node.type !== "resource") {
    return null;
  }

  return {
    label: run.node.label,
    protocol: run.node.protocol,
    regionPath: hit.regionPath,
    url: run.node.url,
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
      listItemPath: checkboxHit.listItemPath,
    };
  }

  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (!hit) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtOffset(
    hit.regionPath,
    hit.offset,
    commentRanges,
  );
  const resourceHit = resolveResourceHit(state, hit);

  if (resourceHit) {
    return {
      commentThreadIndex,
      kind: "resource",
      label: resourceHit.label,
      protocol: resourceHit.protocol,
      regionPath: resourceHit.regionPath,
      url: resourceHit.url,
    };
  }

  const linkHit = resolveLinkHit(state, hit);

  if (linkHit) {
    return {
      endOffset: linkHit.endOffset,
      kind: "link",
      commentThreadIndex,
      regionPath: linkHit.regionPath,
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
  regionPath: string,
  offset: number,
  commentRanges: readonly EditorCommentRange[],
): EditorHoverTarget | null {
  const container = resolveRegion(state.documentIndex, regionPath);

  if (!container) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtOffset(regionPath, offset, commentRanges);
  const run =
    regionInlines(container).find((entry) => offset >= entry.start && offset <= entry.end) ?? null;

  if (run?.node.type === "resource") {
    return {
      commentThreadIndex,
      kind: "resource",
      label: run.node.label,
      protocol: run.node.protocol,
      regionPath,
      url: run.node.url,
    };
  }

  if (run?.link) {
    return {
      commentThreadIndex,
      endOffset: run.end,
      kind: "link",
      regionPath,
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
function resolveHitOnLine(state: EditorState, line: LayoutLine, x: number): EditorHit | null {
  const region = resolveRegion(state.documentIndex, line.regionPath);

  if (!region) {
    return null;
  }

  const localX = Math.max(0, x - line.contentInset - line.left);
  const offset = resolveBoundaryOffset(line.boundaries, localX);
  const resolvedOffset = Math.min(region.text.length, line.start + offset);

  return {
    regionPath: line.regionPath,
    offset: resolvedOffset,
    left: measureCanvasLineOffsetLeft(line, offset),
    top: line.top,
    height: line.height,
  };
}

type LayoutLineHit = {
  line: LayoutLine;
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
      if (layout.lines[i]!.blockPath === block.blockPath) {
        return { line: layout.lines[i]! };
      }
    }

    const indexedBlock = resolveIndexedBlock(state.documentIndex, block.blockPath);
    if (indexedBlock && isInertBlock(indexedBlock)) {
      const nextLeaf = nextBlockInFlow(state.documentIndex, block.blockPath);
      if (nextLeaf) {
        const firstLine = layout.lines.find((line) => line.blockPath === nextLeaf.path);
        if (firstLine) return { line: firstLine, snapToLineStart: true };
      }
    }
  }

  return null;
}

function resolveCommentThreadIndexAtOffset(
  regionPath: string,
  offset: number,
  commentRanges: readonly EditorCommentRange[],
) {
  for (const range of commentRanges) {
    if (range.regionPath === regionPath && offset >= range.startOffset && offset <= range.endOffset) {
      return range.threadIndex;
    }
  }

  return null;
}

function resolveInteractiveLineAtPoint(
  layout: DocumentLayout,
  point: { x: number; y: number },
): LayoutLine | null {
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

function findContainer(state: EditorState, regionPath: string) {
  return resolveRegion(state.documentIndex, regionPath);
}

function resolveViewportTop(layout: DocumentLayout) {
  return layout.lines[0]?.top ?? 0;
}
