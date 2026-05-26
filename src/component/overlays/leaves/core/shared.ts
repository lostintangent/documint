// Type vocabulary and shared resolver for the leaf system. Document leaves
// are contextual surfaces anchored to editor layout geometry. Fixed leaves
// are viewport chrome and do not extend `DocumentLeafBase`.
//
//   1. Hooks (useCursor / useSelection / usePointer) emit a
//      `DocumentLeafBase` subtype — the declarative "I attach here,
//      render this kind of leaf" candidate.
//   2. Documint resolves each candidate's anchor against the prepared
//      layout into a `DocumentLeafResolution` — the geometric form
//      `DocumentLeafAnchor` consumes.
//   3. `DocumentLeafAnchor` renders the resolution; the kind discriminator picks
//      the leaf-specific React component (LinkLeaf, AnnotationLeaf, …).

import { isResolvedCommentThread } from "@/document";
import type {
  EditorCommentState,
  EditorHoverTarget,
  EditorSelectionPoint,
  SelectionFormatting,
} from "@/editor";
import type { PointerEventHandler } from "react";
import type { CompletionItem } from "../../../completions/completions";

// Declarative anchoring intent emitted by leaf-producing hooks. Every
// leaf candidate kind extends this base.
export type DocumentLeafBase = {
  // Document point the leaf attaches to. The host derives the line-bottom
  // y (`top`), caret-x (`left`), and line height (`anchorHeight`) from it.
  anchor: EditorSelectionPoint;
  // Override `left` when the leaf's x doesn't come from the anchor — e.g.
  // table leaves (cell text-left) or selection-annotation (range-start).
  leftOverride?: number;
  // Extra vertical breathing room from the anchor, applied symmetrically
  // above or below. Selection-annotation uses 2 to clear the highlight.
  paddingY?: number;
};

// Reference-stable comparison hooks use to skip leaf re-renders when the
// underlying anchor target hasn't moved.
export function areDocumentLeafBasesEqual(previous: DocumentLeafBase, next: DocumentLeafBase) {
  return (
    previous.anchor.regionId === next.anchor.regionId &&
    previous.anchor.offset === next.anchor.offset &&
    previous.leftOverride === next.leftOverride &&
    previous.paddingY === next.paddingY
  );
}

// The fully-resolved geometric form of a `DocumentLeafBase`. Hooks emit
// the target (declarative); Documint resolves it against the prepared
// layout, then adds the cross-cutting presentation flags.
export type DocumentLeafResolution = {
  // Line height at the anchor row. The above-flip uses this plus the
  // shell's own height to clear the anchor line.
  anchorHeight: number;
  // True for hover leaves (renders the bridge child as the pointer
  // hand-off surface). False for cursor and selection leaves — the
  // wrapper also becomes pointer-event-transparent (see styles.css).
  bridge: boolean;
  // Document-absolute anchor coordinates.
  left: number;
  top: number;
  // Hover-bridge handlers — set only when `bridge: true`.
  onPointerEnter?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  // Extra vertical breathing room from the anchor, applied symmetrically
  // above or below (CSS variable `--documint-leaf-padding-y`).
  paddingY: number;
};

// Leaf shown when the caret sits on an empty top-level paragraph — the
// block-insertion menu (heading, list, table, …).
export type InsertionLeaf = DocumentLeafBase & {
  kind: "insertion";
};

// Leaf shown when the caret sits inside a table cell — the table-editing
// menu (insert/delete row/column, delete table).
export type TableLeaf = DocumentLeafBase & {
  cellIndex: number;
  columnCount: number;
  kind: "table";
  rowCount: number;
  rowIndex: number;
};

// Leaf shown when there's an active text selection — the annotation
// toolbar (formatting marks + add-comment trigger). Promoting this leaf
// after a comment is added produces a `ThreadLeaf`.
export type AnnotationLeaf = DocumentLeafBase & {
  formatting: SelectionFormatting;
  kind: "annotation";
  selection: {
    endOffset: number;
    regionId: string;
    startOffset: number;
  };
};

// Leaf shown when hover or caret lands on a link span.
export type LinkLeaf = DocumentLeafBase & {
  endOffset: number;
  kind: "link";
  regionId: string;
  startOffset: number;
  title: string | null;
  url: string;
};

// Leaf showing a comment thread. Produced by two paths:
//   - usePointer / useCursor when hover or caret lands on a commented span.
//   - useSelection when a selection-annotation leaf is promoted post-submit.
// Both paths emit this same shape so the renderer doesn't normalize.
export type ThreadLeaf = DocumentLeafBase & {
  // Plays the entry animation for a freshly-promoted thread; false for
  // hover/cursor-derived threads.
  animateInitialComment: boolean;
  kind: "thread";
  // Set when the commented span is also a link (hover/cursor path); null
  // for selection-promoted threads.
  link: { title: string | null; url: string } | null;
  // Whether the thread is currently resolved.
  resolved: boolean;
  thread: EditorCommentState["threads"][number];
  threadIndex: number;
};

// Leaf shown while the caret is positioned after a completion trigger (e.g.
// `:` for emoji, `@` for mentions) — the inline suggestion list. The anchor
// points to the trigger character so `DocumentLeafAnchor` positions the popover
// at that line's bottom, with the normal above/below flip.
export type CompletionLeaf = DocumentLeafBase & {
  activeIndex: number;
  kind: "completion";
  matches: readonly CompletionItem[];
  onHover: (index: number) => void;
  onSelect: (item: CompletionItem) => void;
};

export type SearchLeaf = {
  activeMatchNumber: number;
  canNavigate: boolean;
  caseSensitive: boolean;
  kind: "search";
  matchCount: number;
  onChange: (query: string) => void;
  onClose: () => void;
  onDismiss: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleCaseSensitive: () => void;
  query: string;
};

// Resolves an editor hover/selection-point target into the leaf candidate
// that should appear for it. Shared between usePointer (hover) and
// useCursor (caret-on-annotated-span) since the discrimination is the
// same in both contexts.
export function resolveContextualLeaf(
  target: EditorHoverTarget | null,
  threads: EditorCommentState["threads"],
  ranges: EditorCommentState["ranges"],
): ThreadLeaf | LinkLeaf | null {
  if (!target || target.kind === "task-toggle") {
    return null;
  }

  if (target.commentThreadIndex !== null) {
    const thread = threads[target.commentThreadIndex] ?? null;
    // Comment leaves anchor to the start of the comment range, not the
    // hover point.
    const range = ranges.find((entry) => entry.threadIndex === target.commentThreadIndex);
    if (!thread || !range) {
      return null;
    }

    return {
      anchor: { regionId: range.regionId, offset: range.startOffset },
      animateInitialComment: false,
      kind: "thread",
      link:
        target.kind === "link"
          ? {
              title: target.title,
              url: target.url,
            }
          : null,
      resolved: isResolvedCommentThread(thread),
      thread,
      threadIndex: target.commentThreadIndex,
    };
  }

  if (target.kind !== "link") {
    return null;
  }

  return {
    anchor: { regionId: target.regionId, offset: target.startOffset },
    endOffset: target.endOffset,
    kind: "link",
    regionId: target.regionId,
    startOffset: target.startOffset,
    title: target.title,
    url: target.url,
  };
}
