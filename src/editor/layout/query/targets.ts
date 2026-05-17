// Owns interactive target resolution: link hits, task-checkbox hits, hover
// targets (combining link/comment/text kinds), inline-image bounds, and the
// offset-based target lookup that pairs with hover. Point-driven entries
// run through hit-test against a prepared `DocumentLayout`; the offset-
// driven entry is pure state/anchors (no geometry).

import type { EditorCommentRange } from "../../anchors";
import type { DocumentResources } from "@/types";
import { findAncestorBlockEntry, type EditorInline, type EditorState } from "../../state";
import type { EditorLayoutState } from "..";
import type { DocumentLayout, DocumentLayoutLine } from "../measure";
import { resolveInlineImageDimensions } from "../measure/image";
import { findDocumentLayoutLineForRegionOffset, measureCanvasLineOffsetLeft } from "./lookup";
import {
  resolveLineContentInset,
  resolveListItemMarker,
  resolveTaskCheckboxBounds,
} from "./geometry";
import { resolveEditorHitAtPoint } from "./hit-test";

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

export type InlineBounds = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function resolveTaskCheckboxHitAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
) {
  const line = resolveInteractiveLineAtPoint(layout, point);

  if (!line || line.start !== 0) {
    return null;
  }

  const listItemEntry = findAncestorBlockEntry(state.documentIndex, line.blockId, "listItem");

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

  const run = container.inlines.find(
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
  commentRanges: EditorCommentRange[],
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

// Resolves what user-actionable target sits at a given document offset —
// link mark, comment thread, or nothing. Pure state/anchors query: no
// layout geometry involved. Used when the position is already known
// (selection, programmatic placement); the pointer-driven sibling
// `resolveHoverTargetAtPoint` composes hit-test on top of this kind of
// lookup.
export function resolveTargetAtOffset(
  state: EditorState,
  regionId: string,
  offset: number,
  commentRanges: EditorCommentRange[],
): EditorHoverTarget | null {
  const container = state.documentIndex.regionIndex.get(regionId);

  if (!container) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtOffset(regionId, offset, commentRanges);
  const run =
    container.inlines.find((entry) => offset >= entry.start && offset <= entry.end) ?? null;

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

export function measureInlineImageBounds(
  state: EditorState,
  viewport: EditorLayoutState,
  resources: DocumentResources,
  run: EditorInline,
): InlineBounds | null {
  const region = state.documentIndex.regionIndex.get(state.selection.anchor.regionId);

  if (!run.image || !region) {
    return null;
  }

  const line = findDocumentLayoutLineForRegionOffset(viewport.layout, region.id, run.start);

  if (!line) {
    return null;
  }

  const textLeft = line.left + resolveLineContentInset(state, line);
  const left = textLeft + measureCanvasLineOffsetLeft(line, run.start - line.start) - line.left;
  const right = textLeft + measureCanvasLineOffsetLeft(line, run.end - line.start) - line.left;
  const { height } = resolveInlineImageDimensions(run, resources, line.width);
  const top = line.top + Math.max(0, Math.floor((line.height - height) / 2));

  return { left, top, width: right - left, height };
}

function resolveCommentThreadIndexAtOffset(
  regionId: string,
  offset: number,
  commentRanges: EditorCommentRange[],
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
  return state.documentIndex.regionIndex.get(regionId) ?? null;
}
