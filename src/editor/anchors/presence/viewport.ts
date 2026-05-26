/**
 * Geometric projection of a presence target against the prepared viewport.
 * Decides whether a text cursor or comment thread sits above, below, or
 * inside the visible scroll window.
 *
 * Two consumers:
 *   - `resolvePresenceViewport` — runs over the full presence list and adds a
 *     scroll target so the host can scroll to an off-screen remote presence.
 *   - `resolveCursorViewportStatus` — single-cursor status check. Used by the
 *     host's own caret (`useCursor`) to gate the leaf overlay and the blink
 *     interval when the user's cursor scrolls off-screen.
 *
 * The geometric core (`resolvePositionInViewport`) is shared with other
 * viewport-gated content, including animated text decorations.
 */

import {
  measureCaretTarget,
  resolvePositionInViewport,
  resolveScrollTopToReveal,
  type EditorLayoutState,
} from "../../layout";
import type { DocumentIndex, EditorSelectionPoint } from "../../state";
import type { EditorState } from "../../state/types";
import { resolveCommentThreadViewportPosition, type EditorCommentRange } from "../comments";
import type { EditorPresence, EditorPresenceViewport, EditorPresenceViewportStatus } from ".";

const presenceViewportScrollMargin = 48;

/* Public API */

export function resolvePresenceViewport(
  state: EditorState,
  viewport: EditorLayoutState,
  presence: EditorPresence[],
  commentRanges: readonly EditorCommentRange[],
): EditorPresence[];
export function resolvePresenceViewport(
  documentIndex: DocumentIndex,
  viewport: EditorLayoutState,
  presence: EditorPresence[],
  commentRanges: readonly EditorCommentRange[],
): EditorPresence[];
export function resolvePresenceViewport(
  stateOrIndex: EditorState | DocumentIndex,
  viewport: EditorLayoutState,
  presence: EditorPresence[],
  commentRanges: readonly EditorCommentRange[],
): EditorPresence[] {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  if (presence.length === 0) {
    return [];
  }

  return presence.map((presenceItem) => ({
    ...presenceItem,
    viewport: resolveEditorPresenceViewport(documentIndex, viewport, commentRanges, presenceItem),
  }));
}

export function resolveCursorViewportStatus(
  state: EditorState,
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
): EditorPresenceViewportStatus;
export function resolveCursorViewportStatus(
  documentIndex: DocumentIndex,
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
): EditorPresenceViewportStatus;
export function resolveCursorViewportStatus(
  stateOrIndex: EditorState | DocumentIndex,
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
): EditorPresenceViewportStatus {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  const position = resolveCursorPosition(documentIndex, viewport, point);
  if (!position) {
    return "unresolved";
  }
  return resolvePositionInViewport(viewport, position);
}

/* Internals */

function resolveEditorPresenceViewport(
  documentIndex: DocumentIndex,
  viewport: EditorLayoutState,
  commentRanges: readonly EditorCommentRange[],
  presence: EditorPresence,
): EditorPresenceViewport {
  const position = presence.cursorPoint
    ? resolveCursorPosition(documentIndex, viewport, presence.cursorPoint)
    : presence.commentThreadIndex != null
      ? resolveCommentThreadViewportPosition(viewport, commentRanges, presence.commentThreadIndex)
      : null;
  if (!position) {
    return { status: "unresolved" };
  }

  return {
    scrollTop: resolvePresenceTargetScrollTop(viewport, position),
    status: resolvePositionInViewport(viewport, position),
  };
}

function resolveCursorPosition(
  documentIndex: DocumentIndex,
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
): { bottom: number; top: number } | null {
  const exactCaret = measureCaretTarget(viewport.layout, documentIndex, point);
  if (exactCaret) {
    return { bottom: exactCaret.top + exactCaret.height, top: exactCaret.top };
  }
  return viewport.estimateRegionBounds(point.regionId);
}

function resolvePresenceTargetScrollTop(
  viewport: EditorLayoutState,
  position: { bottom: number; top: number },
) {
  // Presence anchors at the start: when scrolling to a remote cursor or
  // comment thread, we want to see what they are working on (everything
  // below the target), not the prior context above it.
  return resolveScrollTopToReveal(viewport, position, {
    align: "start",
    margin: presenceViewportScrollMargin,
  });
}
