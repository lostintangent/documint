import {
  getSelectionContext,
  hasNewAnimation,
  type EditorSelection,
  type EditorState,
} from "@/editor";

export type EditorReplaceReason = "external-content" | "reconciliation";

export type EditorTransitionReason = "command" | EditorReplaceReason;

export type EditorTransition = {
  previous: EditorState;
  next: EditorState;
  reason: EditorTransitionReason;
  documentChanged: boolean;
  selectionChanged: boolean;
  focusChanged: boolean;
  activeBlockChanged: boolean;
  commentsChanged: boolean;
  commentRangesChanged: boolean;
  imageUrlsChanged: boolean;
  animationStarted: boolean;
};

export function createEditorTransition(
  previous: EditorState,
  next: EditorState,
  reason: EditorTransitionReason,
): EditorTransition {
  const documentChanged = previous.documentIndex !== next.documentIndex;
  const commentsChanged =
    previous.documentIndex.document.comments !== next.documentIndex.document.comments;
  const selectionChanged = !areSelectionsEqual(previous.selection, next.selection);
  const focusChanged = !areSelectionPointsEqual(previous.selection.focus, next.selection.focus);

  return {
    previous,
    next,
    reason,
    documentChanged,
    selectionChanged,
    focusChanged,
    activeBlockChanged: resolveActiveBlockId(previous) !== resolveActiveBlockId(next),
    commentsChanged,
    // Live ranges are a projection of comments against document structure. This
    // conservative first-pass flag is intentionally broad; editor computed
    // values can tighten it with memoized range equality.
    commentRangesChanged: commentsChanged || documentChanged,
    imageUrlsChanged: !areStringSetsEqual(
      previous.documentIndex.imageUrls,
      next.documentIndex.imageUrls,
    ),
    animationStarted: hasNewAnimation(previous, next),
  };
}

function areSelectionsEqual(a: EditorSelection, b: EditorSelection) {
  return areSelectionPointsEqual(a.anchor, b.anchor) && areSelectionPointsEqual(a.focus, b.focus);
}

function areSelectionPointsEqual(a: EditorSelection["anchor"], b: EditorSelection["anchor"]) {
  return a.regionId === b.regionId && a.offset === b.offset;
}

function resolveActiveBlockId(state: EditorState) {
  return getSelectionContext(state).block?.blockId ?? null;
}

function areStringSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a === b) return true;
  if (a.size !== b.size) return false;

  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }

  return true;
}
