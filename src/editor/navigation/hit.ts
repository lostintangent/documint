// Owns point-to-editor-intent resolution over prepared layout geometry.

import type { Link, Resource } from "@/document";
import type { EditorCommentRange } from "../anchors";
import {
  findDocumentLayoutLineAtPoint,
  measureCanvasLineOffsetLeft,
  resolveBoundaryOffset,
} from "../layout/query/line-lookup";
import {
  resolveInlineImageBounds,
  resolveListMarkerTarget,
  resolveTaskCheckboxBounds,
} from "../layout/query/line-visuals";
import { CHECKBOX_HIT_PADDING } from "../layout/lib/marker-metrics";
import type { DocumentLayout, LayoutLine } from "../layout/measure";
import {
  isMetadataPath,
  isInertBlock,
  nextBlockInFlow,
  resolveEditorTextAtPath,
  resolveIndexedBlock,
  resolveMetadataField,
  resolveInlinesAtPath,
  type EditorSelectionPoint,
  type EditorState,
  type IndexedInline,
} from "../state";
import { resolveWordRangeAtOffset } from "../text/words";

export type EditorHoverTarget =
  | {
      kind: "metadata-toggle";
    }
  | {
      endOffset: number;
      kind: "link";
      commentThreadIndex: number | null;
      path: string;
      startOffset: number;
      title: string | null;
      url: string;
    }
  | {
      kind: "resource";
      commentThreadIndex: number | null;
      label: string;
      protocol: string;
      path: string;
      url: string;
    }
  | {
      kind: "task-toggle";
      listItemPath: string;
    }
  | {
      kind: "metadata-boolean-toggle";
      path: string;
    }
  | {
      kind: "text";
      commentThreadIndex: number | null;
    };

export function isCanvasDirectActivationTarget(
  target: EditorHoverTarget | null,
): target is Extract<
  EditorHoverTarget,
  { kind: "metadata-boolean-toggle" | "metadata-toggle" | "task-toggle" }
> {
  return (
    target?.kind === "metadata-toggle" ||
    target?.kind === "metadata-boolean-toggle" ||
    target?.kind === "task-toggle"
  );
}

export function canExtendSelectionBetweenPaths(anchorPath: string, targetPath: string) {
  const anchorIsMetadata = isMetadataPath(anchorPath);
  const targetIsMetadata = isMetadataPath(targetPath);
  return anchorIsMetadata ? targetPath === anchorPath : !targetIsMetadata;
}

export function resolveEditorHitAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): EditorSelectionPoint | null {
  const line = findDocumentLayoutLineAtPoint(layout, point)?.line;

  if (line) {
    return resolveHitOnLine(state, line, point.x);
  }

  // A point in a block's padding resolves to the block's last line. Inert
  // leaf blocks have no lines, so they redirect to the start of the next
  // text path in flow; the click x is meaningless there.
  for (const block of layout.blocks) {
    if (point.y < block.top || point.y > block.bottom) continue;

    for (let i = layout.lines.length - 1; i >= 0; i--) {
      if (layout.lines[i]!.blockPath === block.blockPath) {
        return resolveHitOnLine(state, layout.lines[i]!, point.x);
      }
    }

    const indexedBlock = resolveIndexedBlock(state.documentIndex, block.blockPath);
    if (indexedBlock && isInertBlock(indexedBlock)) {
      const nextLeaf = nextBlockInFlow(state.documentIndex, block.blockPath);
      if (nextLeaf) {
        const firstLine = layout.lines.find((line) => line.blockPath === nextLeaf.path);
        if (firstLine) return resolveHitOnLine(state, firstLine, firstLine.left);
      }
    }
  }

  return null;
}

function resolveHitBelowLayout(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): EditorSelectionPoint | null {
  const lastLine = layout.lines[layout.lines.length - 1];

  if (!lastLine || point.y <= lastLine.top + lastLine.height) {
    return null;
  }

  return resolveHitOnLine(state, lastLine, point.x);
}

export function resolveSelectionPointAt(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
): EditorSelectionPoint | null {
  return (
    resolveEditorHitAtPoint(viewport.layout, state, point) ??
    resolveHitBelowLayout(viewport.layout, state, point)
  );
}

// Resolves the focus point of a mouse drag. The focus follows the pointer's
// hit across any path; if the pointer overshoots the document's content edge,
// it clamps to the anchor path's near edge instead of collapsing.
export function resolveDragFocus(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
  anchor: EditorSelectionPoint,
): EditorSelectionPoint | null {
  const anchorText = resolveEditorTextAtPath(state.documentIndex, anchor.path);

  if (anchorText === null) {
    return null;
  }

  const hit = resolveEditorHitAtPoint(viewport.layout, state, point);

  if (hit) {
    return canExtendSelectionBetweenPaths(anchor.path, hit.path) ? hit : anchor;
  }

  const isAboveLayout = point.y < (viewport.layout.lines[0]?.top ?? 0);

  return {
    path: anchor.path,
    offset: isAboveLayout ? 0 : anchorText.length,
  };
}

export function resolveWordSelection(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
) {
  const hit = resolveEditorHitAtPoint(viewport.layout, state, point);

  if (!hit) {
    return null;
  }

  const text = resolveEditorTextAtPath(state.documentIndex, hit.path);
  const range = text === null ? null : resolveWordRangeAtOffset(text, hit.offset);

  if (!range) {
    return null;
  }

  return {
    anchor: {
      path: hit.path,
      offset: range.start,
    },
    focus: {
      path: hit.path,
      offset: range.end,
    },
  };
}

export function resolveHoverTarget(
  state: EditorState,
  viewport: { layout: DocumentLayout },
  point: { x: number; y: number },
  commentRanges: readonly EditorCommentRange[],
): EditorHoverTarget | null {
  const { layout } = viewport;
  const header = layout.metadata?.header;
  if (header && pointInRect(point, header)) {
    return {
      kind: "metadata-toggle",
    };
  }

  const metadataCheckbox = layout.metadata?.rows.find(
    (row) => row.checkbox && pointInRect(point, row.checkbox.rect, CHECKBOX_HIT_PADDING),
  )?.checkbox;

  if (metadataCheckbox) {
    const metadataField = resolveMetadataField(state.documentIndex, metadataCheckbox.path);

    if (metadataField?.type === "boolean" && metadataField.value === metadataCheckbox.checked) {
      return {
        kind: "metadata-boolean-toggle",
        path: metadataCheckbox.path,
      };
    }
  }

  const taskToggle = resolveTaskToggleAtPoint(layout, state, point);

  if (taskToggle) {
    return taskToggle;
  }

  const line = findDocumentLayoutLineAtPoint(layout, point)?.line ?? null;
  // Click placement intentionally redirects block padding to nearby text.
  // Hover affordances must stay within the painted line's vertical bounds so
  // an absent leaf's bridge area cannot activate the leaf.
  if (!line || point.y < line.top || point.y >= line.top + line.height) {
    return null;
  }

  const hit = resolveHitOnLine(state, line, point.x);

  if (!hit) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtPoint(
    line,
    hit.offset,
    point.x,
    commentRanges,
  );
  const inlines = resolveInlinesAtPath(state.documentIndex, hit.path);
  // An image's caret offset flips at its midpoint, so its box decides instead.
  const image = line.inlineReferences?.find((reference) => {
    if (reference.kind !== "image") {
      return false;
    }

    const { left, width } = resolveInlineImageBounds(line, reference);
    return point.x >= left && point.x < left + width;
  });
  const imageRun =
    image && inlines?.find((entry) => entry.start === image.start && entry.node.type === "image");

  if (imageRun) {
    return imageRun.link
      ? linkHoverTarget(imageRun, imageRun.link, hit.path, commentThreadIndex)
      : { kind: "text", commentThreadIndex };
  }

  const resourceRun = inlines?.find(
    (entry) =>
      entry.node.type === "resource" && hit.offset >= entry.start && hit.offset <= entry.end,
  );

  if (resourceRun?.node.type === "resource") {
    return resourceHoverTarget(resourceRun.node, hit.path, commentThreadIndex);
  }

  const linkRun = inlines?.find(
    (entry) => entry.link && hit.offset >= entry.start && hit.offset < entry.end,
  );

  if (linkRun?.link) {
    return linkHoverTarget(linkRun, linkRun.link, hit.path, commentThreadIndex);
  }

  return {
    kind: "text",
    commentThreadIndex,
  };
}

// Resolves what user-actionable target sits at a given document offset.
export function resolveTargetAtOffset(
  state: EditorState,
  path: string,
  offset: number,
  commentRanges: readonly EditorCommentRange[],
): EditorHoverTarget | null {
  const inlines = resolveInlinesAtPath(state.documentIndex, path);

  if (!inlines) {
    return null;
  }

  const commentThreadIndex = resolveCommentThreadIndexAtOffset(path, offset, commentRanges);
  // A tap on a linked image's left half puts the caret before it, so either side surfaces its link.
  const run =
    inlines.find((entry) => entry.start === offset && entry.node.type === "image" && entry.link) ??
    inlines.find((entry) => offset >= entry.start && offset <= entry.end) ??
    null;

  if (run?.node.type === "resource") {
    return resourceHoverTarget(run.node, path, commentThreadIndex);
  }

  if (run?.link) {
    return linkHoverTarget(run, run.link, path, commentThreadIndex);
  }

  if (commentThreadIndex !== null) {
    return {
      commentThreadIndex,
      kind: "text",
    };
  }

  return null;
}

function resolveTaskToggleAtPoint(
  layout: DocumentLayout,
  state: EditorState,
  point: { x: number; y: number },
): EditorHoverTarget | null {
  const line = resolveInteractiveLineAtPoint(layout, point);

  if (!line) {
    return null;
  }

  const target = resolveListMarkerTarget(state, line, layout.options);

  if (target?.marker.kind !== "task") {
    return null;
  }

  const bounds = resolveTaskCheckboxBounds(line, target.left);
  return pointInRect(point, bounds, CHECKBOX_HIT_PADDING)
    ? {
        kind: "task-toggle",
        listItemPath: target.listItemPath,
      }
    : null;
}

function resourceHoverTarget(
  resource: Resource,
  path: string,
  commentThreadIndex: number | null,
): EditorHoverTarget {
  return {
    commentThreadIndex,
    kind: "resource",
    label: resource.label,
    protocol: resource.protocol,
    path,
    url: resource.url,
  };
}

function linkHoverTarget(
  run: IndexedInline,
  link: Link,
  path: string,
  commentThreadIndex: number | null,
): EditorHoverTarget {
  return {
    commentThreadIndex,
    endOffset: run.end,
    kind: "link",
    path,
    startOffset: run.start,
    title: link.title,
    url: link.url,
  };
}

// Resolves a horizontal position on an already-identified line to a selection
// hit. This avoids re-resolving the line from coordinates, which can land on
// the wrong line when Y falls exactly on a line boundary.
function resolveHitOnLine(
  state: EditorState,
  line: LayoutLine,
  x: number,
): EditorSelectionPoint | null {
  const text = resolveEditorTextAtPath(state.documentIndex, line.path);

  if (text === null) {
    return null;
  }

  const localX = Math.max(0, x - line.contentInset - line.left);
  const offset = resolveBoundaryOffset(line.boundaries, localX);
  return { path: line.path, offset: Math.min(text.length, line.start + offset) };
}

function resolveCommentThreadIndexAtOffset(
  path: string,
  offset: number,
  commentRanges: readonly EditorCommentRange[],
) {
  for (const range of commentRanges) {
    if (range.path === path && offset >= range.startOffset && offset <= range.endOffset) {
      return range.threadIndex;
    }
  }

  return null;
}

function resolveCommentThreadIndexAtPoint(
  line: LayoutLine,
  offset: number,
  x: number,
  commentRanges: readonly EditorCommentRange[],
) {
  // Horizontal whitespace clamps to a line boundary offset. Confirm the
  // candidate against the quote's measured span so an end-boundary match
  // does not extend beyond the painted text.
  for (const range of commentRanges) {
    if (range.path !== line.path || offset < range.startOffset || offset > range.endOffset) {
      continue;
    }

    const startOffset = Math.max(range.startOffset, line.start);
    const endOffset = Math.min(range.endOffset, line.end);

    if (endOffset <= startOffset) {
      continue;
    }

    const left = measureCanvasLineOffsetLeft(line, startOffset - line.start) + line.contentInset;
    const right = measureCanvasLineOffsetLeft(line, endOffset - line.start) + line.contentInset;

    if (x >= left && x <= right) {
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
      (entry) =>
        point.y >= entry.top - CHECKBOX_HIT_PADDING &&
        point.y <= entry.top + entry.height + CHECKBOX_HIT_PADDING,
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

function pointInRect(
  point: { x: number; y: number },
  rect: { height: number; left: number; top: number; width: number },
  padding = 0,
) {
  return (
    point.x >= rect.left - padding &&
    point.x <= rect.left + rect.width + padding &&
    point.y >= rect.top - padding &&
    point.y <= rect.top + rect.height + padding
  );
}
