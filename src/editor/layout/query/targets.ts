// Owns interactive target resolution against a prepared `DocumentLayout`:
// link hits, task-checkbox hits, hover targets (combining link/comment/text
// kinds), and inline-image bounds. These take a known point or selection
// point and answer "what's there to interact with?".

import type { EditorCommentRange } from "../../anchors";
import type { DocumentResources } from "@/types";
import type {
  EditorInline,
  EditorSelectionPoint,
  EditorState,
} from "../../state";
import type { EditorLayoutState } from "..";
import type { DocumentLayout, DocumentLayoutLine } from "../measure";
import { resolveInlineImageDimensions } from "../measure/image";
import {
  findDocumentLayoutLineForRegionOffset,
  measureCanvasLineOffsetLeft,
} from "./lookup";
import {
  findBlockAncestor,
  resolveLineContentInset,
  resolveListItemMarker,
  resolveTaskCheckboxBounds,
} from "./geometry";
import { resolveEditorHitAtPoint } from "./hit-test";

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
  layout: DocumentLayout,
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

  const run = container.inlines.find(
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
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
  liveCommentRanges: EditorCommentRange[],
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

  const commentThreadIndex = resolveCommentThreadIndexAtSelectionPoint(
    hit.regionId,
    hit.offset,
    liveCommentRanges,
  );
  const commentAnchor =
    commentThreadIndex !== null
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
  layout: DocumentLayout,
  state: EditorState,
  selectionPoint: EditorSelectionPoint,
  liveCommentRanges: EditorCommentRange[],
): EditorHoverTarget | null {
  const container = state.documentIndex.regionIndex.get(selectionPoint.regionId);

  if (!container) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtSelectionPoint(
    selectionPoint.regionId,
    selectionPoint.offset,
    liveCommentRanges,
  );
  const commentAnchor =
    commentThreadIndex !== null
      ? resolveCommentAnchor(commentThreadIndex, layout, state, liveCommentRanges)
      : null;
  const run =
    container.inlines.find(
      (entry) => selectionPoint.offset >= entry.start && selectionPoint.offset <= entry.end,
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

function resolveCommentThreadIndexAtSelectionPoint(
  regionId: string,
  offset: number,
  liveCommentRanges: EditorCommentRange[],
) {
  for (const range of liveCommentRanges) {
    if (range.regionId === regionId && offset >= range.startOffset && offset <= range.endOffset) {
      return range.threadIndex;
    }
  }

  return null;
}

function resolveCommentAnchor(
  threadIndex: number,
  layout: DocumentLayout,
  state: EditorState,
  liveCommentRanges: EditorCommentRange[],
) {
  const range = liveCommentRanges.find((entry) => entry.threadIndex === threadIndex);

  if (!range) {
    return null;
  }

  return resolveHoverAnchor(layout, state, range.regionId, range.startOffset);
}

function resolveHoverAnchor(
  layout: DocumentLayout,
  state: EditorState,
  regionId: string,
  offset: number,
) {
  const line = findDocumentLayoutLineForRegionOffset(layout, regionId, offset);

  if (!line) {
    return null;
  }

  return {
    anchorBottom: line.top + line.height,
    anchorLeft: measureCanvasLineOffsetLeft(line, offset) + resolveLineContentInset(state, line),
  };
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
