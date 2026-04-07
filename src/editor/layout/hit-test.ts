import type { CanvasLiveCommentRange } from "../comments";
import type { EditorState } from "../model/state";
import type { CanvasSelectionPoint, DocumentListItemMarker } from "../model/document-editor";
import { measureCanvasTextWidth } from "../render/font-metrics";
import {
  findLineAtPoint,
  findLineForRegionOffset,
  findNearestLineInRegion,
  measureCaretTarget,
  measureLineOffsetLeft,
  resolveSelectionHit,
  type ViewportLayout,
} from "./index";

// Resolves editor interactions on top of prepared layout geometry. This stays
// separate from `layout/document` because it owns pointer-to-selection behavior,
// interactive task/link targeting, and point-based helpers rather than the
// layout geometry model itself.

export type CanvasCheckboxHit = {
  listItemId: string;
};

export type CanvasLinkHit = {
  anchorBottom: number;
  anchorLeft: number;
  endOffset: number;
  regionId: string;
  startOffset: number;
  title: string | null;
  url: string;
};

export type EditorHoverTarget =
  | {
      anchorBottom: number;
      anchorLeft: number;
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
      anchorBottom: number;
      anchorLeft: number;
      kind: "text";
      commentThreadIndex: number | null;
    };

const LIST_MARKER_TEXT_INSET = 18;
const TASK_CHECKBOX_SIZE = 14;
const TASK_MARKER_TEXT_INSET = 22;

// Base editor hits

export function resolveEditorHitAtPoint(
  layout: ViewportLayout,
  state: EditorState,
  point: { x: number; y: number },
) {
  const line = resolveLayoutLineAtPoint(layout, point);

  if (!line) {
    return null;
  }

  return resolveSelectionHit(layout, state.documentEditor, {
    x: point.x - resolveLineContentInset(state, line),
    y: point.y,
  });
}

// Drag and selection helpers

export function resolveDragFocusPointAtLocation(
  layout: ViewportLayout,
  state: EditorState,
  point: { x: number; y: number },
  anchor: CanvasSelectionPoint,
) {
  const hit = resolveEditorHitAtPoint(layout, state, point);
  const anchorContainer = findContainer(state, anchor.regionId);

  if (!anchorContainer) {
    return null;
  }

  if (!hit) {
    return {
      regionId: anchor.regionId,
      offset: point.y < resolveViewportTop(layout) ? 0 : anchorContainer.text.length,
    };
  }

  if (hit.regionId === anchor.regionId) {
    return {
      regionId: hit.regionId,
      offset: hit.offset,
    };
  }

  return {
    regionId: anchor.regionId,
    offset: hit.position < anchorContainer.start ? 0 : anchorContainer.text.length,
  };
}

export function resolveWordSelectionAtPoint(
  layout: ViewportLayout,
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

// Interactive targets

export function resolveTaskCheckboxHitAtPoint(
  layout: ViewportLayout,
  state: EditorState,
  point: { x: number; y: number },
) {
  const line = resolveInteractiveLineAtPoint(layout, point);

  if (!line || line.start !== 0) {
    return null;
  }

  const listItemEntry = findBlockAncestor(state, line.blockId, "listItem");

  if (!listItemEntry) {
    return null;
  }

  const marker = resolveListItemMarker(state, listItemEntry.id);

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
        listItemId: listItemEntry.id,
      }
    : null;
}

export function resolveLinkHitAtPoint(
  layout: ViewportLayout,
  state: EditorState,
  point: { x: number; y: number },
) {
  const hit = resolveEditorHitAtPoint(layout, state, point);

  if (!hit) {
    return null;
  }

  const container = findContainer(state, hit.regionId);

  if (!container) {
    return null;
  }

  const run = container.runs.find(
    (entry) => entry.link && hit.offset >= entry.start && hit.offset < entry.end,
  );

  if (!run?.link) {
    return null;
  }

  const anchor = resolveHoverAnchor(layout, state, hit.regionId, run.start);

  if (!anchor) {
    return null;
  }

  return {
    anchorBottom: anchor.anchorBottom,
    anchorLeft: anchor.anchorLeft,
    endOffset: run.end,
    regionId: hit.regionId,
    startOffset: run.start,
    title: run.link.title,
    url: run.link.url,
  };
}

export function resolveHoverTargetAtPoint(
  layout: ViewportLayout,
  state: EditorState,
  point: { x: number; y: number },
  liveCommentRanges: CanvasLiveCommentRange[],
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

  const commentThreadIndex = resolveCommentThreadIndexAtPosition(hit.position, liveCommentRanges);
  const commentAnchor = commentThreadIndex !== null
    ? resolveCommentAnchor(commentThreadIndex, layout, state, liveCommentRanges)
    : null;
  const linkHit = resolveLinkHitAtPoint(layout, state, point);

  if (linkHit) {
    return {
      anchorBottom: commentAnchor?.anchorBottom ?? linkHit.anchorBottom,
      anchorLeft: commentAnchor?.anchorLeft ?? linkHit.anchorLeft,
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
    anchorBottom: commentAnchor?.anchorBottom ?? hit.top + hit.height,
    anchorLeft: commentAnchor?.anchorLeft ?? hit.left,
    kind: "text",
    commentThreadIndex,
  };
}

export function resolveTargetAtSelectionPoint(
  layout: ViewportLayout,
  state: EditorState,
  selectionPoint: CanvasSelectionPoint,
  liveCommentRanges: CanvasLiveCommentRange[],
): EditorHoverTarget | null {
  const container = state.documentEditor.regionIndex.get(selectionPoint.regionId);

  if (!container) {
    return null;
  }

  const absolutePosition = container.start + selectionPoint.offset;
  const commentThreadIndex = resolveCommentThreadIndexAtPosition(absolutePosition, liveCommentRanges);
  const commentAnchor = commentThreadIndex !== null
    ? resolveCommentAnchor(commentThreadIndex, layout, state, liveCommentRanges)
    : null;
  const run =
    container.runs.find(
      (entry) =>
        selectionPoint.offset >= entry.start &&
        selectionPoint.offset <= entry.end,
    ) ?? null;

  if (run?.link) {
    const linkAnchor = resolveHoverAnchor(layout, state, selectionPoint.regionId, run.start);

    if (!linkAnchor) {
      return null;
    }

    return {
      anchorBottom: commentAnchor?.anchorBottom ?? linkAnchor.anchorBottom,
      anchorLeft: commentAnchor?.anchorLeft ?? linkAnchor.anchorLeft,
      commentThreadIndex,
      endOffset: run.end,
      kind: "link",
      regionId: selectionPoint.regionId,
      startOffset: run.start,
      title: run.link.title,
      url: run.link.url,
    };
  }

  if (commentAnchor) {
    return {
      anchorBottom: commentAnchor.anchorBottom,
      anchorLeft: commentAnchor.anchorLeft,
      commentThreadIndex,
      kind: "text",
    };
  }

  return null;
}

// Visual geometry helpers shared by paint and keyboard navigation.

export function resolveCaretVisualLeft(
  state: EditorState,
  layout: ViewportLayout,
  caret: NonNullable<ReturnType<typeof measureCaretTarget>>,
) {
  const resolvedLine = findLineForRegionOffset(layout, caret.regionId, caret.offset);

  if (!resolvedLine) {
    return caret.left;
  }

  return (
    caret.left +
    resolveLineContentInset(state, resolvedLine) +
    resolveCollapsedTrailingSpaceWidth(state, resolvedLine, caret.offset)
  );
}

export function resolveLineVisualLeft(
  state: EditorState,
  line: ViewportLayout["lines"][number],
  offset: number,
) {
  return measureLineOffsetLeft(line, offset) + resolveLineContentInset(state, line);
}

export function resolveLineContentInset(
  state: EditorState,
  line: ViewportLayout["lines"][number],
) {
  const listItemEntry = findBlockAncestor(state, line.blockId, "listItem");

  if (!listItemEntry) {
    return 0;
  }

  const marker = resolveListItemMarker(state, listItemEntry.id);

  return marker?.kind === "task" ? TASK_MARKER_TEXT_INSET : LIST_MARKER_TEXT_INSET;
}

export function resolveTaskCheckboxBounds(line: ViewportLayout["lines"][number]) {
  return {
    left: line.left,
    size: TASK_CHECKBOX_SIZE,
    top: line.top + 3,
  };
}

// Structural helpers shared by paint and hit testing.

export function findBlockAncestor(
  state: EditorState,
  blockId: string,
  type: EditorState["documentEditor"]["blocks"][number]["type"],
) {
  let current = state.documentEditor.blockIndex.get(blockId) ?? null;

  while (current) {
    if (current.type === type) {
      return current;
    }

    const parentBlockId = current.parentBlockId;

    current = parentBlockId ? state.documentEditor.blockIndex.get(parentBlockId) ?? null : null;
  }

  return null;
}

export function resolveListItemMarker(state: EditorState, listItemId: string): DocumentListItemMarker | null {
  return state.documentEditor.listItemMarkers.get(listItemId) ?? null;
}

function resolveCommentThreadIndexAtPosition(
  position: number,
  liveCommentRanges: CanvasLiveCommentRange[],
) {
  for (const range of liveCommentRanges) {
    if (position >= range.start && position <= range.end) {
      return range.threadIndex;
    }
  }

  return null;
}

function resolveCommentAnchor(
  threadIndex: number,
  layout: ViewportLayout,
  state: EditorState,
  liveCommentRanges: CanvasLiveCommentRange[],
) {
  const range = liveCommentRanges.find((entry) => entry.threadIndex === threadIndex);

  if (!range) {
    return null;
  }

  const container = state.documentEditor.regions.find(
    (entry) =>
      range.start >= entry.start &&
      range.start <= entry.start + entry.text.length,
  );

  if (!container) {
    return null;
  }

  const offset = Math.max(0, Math.min(container.text.length, range.start - container.start));
  return resolveHoverAnchor(layout, state, container.id, offset);
}

function resolveHoverAnchor(
  layout: ViewportLayout,
  state: EditorState,
  regionId: string,
  offset: number,
) {
  const line = findLineForRegionOffset(layout, regionId, offset);

  if (!line) {
    return null;
  }

  return {
    anchorBottom: line.top + line.height,
    anchorLeft: measureLineOffsetLeft(line, offset) + resolveLineContentInset(state, line),
  };
}

function resolveCollapsedTrailingSpaceWidth(
  state: EditorState,
  line: ViewportLayout["lines"][number],
  offset: number,
) {
  if (offset <= line.end) {
    return 0;
  }

  const container = state.documentEditor.regionIndex.get(line.regionId);

  if (!container) {
    return 0;
  }

  const hiddenTrailingText = container.text.slice(line.end, offset);

  if (!/^[ \t]+$/u.test(hiddenTrailingText)) {
    return 0;
  }

  return measureCanvasTextWidth(hiddenTrailingText, line.font);
}

function resolveLayoutLineAtPoint(
  layout: ViewportLayout,
  point: { x: number; y: number },
) {
  for (const [regionId, extent] of layout.regionExtents) {
    if (
      point.x >= extent.left &&
      point.x <= extent.right &&
      point.y >= extent.top &&
      point.y <= extent.bottom
    ) {
      return findNearestLineInRegion(layout, regionId, point.y)?.line ?? null;
    }
  }

  return findLineAtPoint(layout, point)?.line ?? null;
}

function resolveInteractiveLineAtPoint(
  layout: ViewportLayout,
  point: { x: number; y: number },
) {
  return (
    layout.lines.find((entry) => point.y >= entry.top - 4 && point.y <= entry.top + entry.height + 4) ??
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
  return state.documentEditor.regionIndex.get(regionId) ?? null;
}

function resolveViewportTop(layout: ViewportLayout) {
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
