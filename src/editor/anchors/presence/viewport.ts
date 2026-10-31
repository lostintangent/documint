/**
 * Geometric resolution of a presence target against the prepared viewport.
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
import type { EditorSelectionPoint } from "../../state";
import { resolveCommentThreadViewportPosition, type EditorCommentRange } from "../comments";
import type { EditorPresence, EditorPresenceViewport, EditorPresenceViewportStatus } from ".";

const presenceViewportScrollMargin = 48;

/* Public API */

export function resolvePresenceViewport(
  viewport: EditorLayoutState,
  presence: EditorPresence[],
  commentRanges: readonly EditorCommentRange[],
): EditorPresence[] {
  if (presence.length === 0) {
    return [];
  }

  return presence.map((presenceItem) => ({
    ...presenceItem,
    viewport: resolveEditorPresenceViewport(viewport, commentRanges, presenceItem),
  }));
}

export function resolveCursorViewportStatus(
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
): EditorPresenceViewportStatus {
  const position = resolveCursorPosition(viewport, point);
  if (!position) {
    return "unresolved";
  }
  return resolvePositionInViewport(viewport, position);
}

/* Internals */

function resolveEditorPresenceViewport(
  viewport: EditorLayoutState,
  commentRanges: readonly EditorCommentRange[],
  presence: EditorPresence,
): EditorPresenceViewport {
  const position = presence.cursorPoint
    ? resolveCursorPosition(viewport, presence.cursorPoint)
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
  viewport: EditorLayoutState,
  point: EditorSelectionPoint,
): { bottom: number; top: number } | null {
  const exactCaret = measureCaretTarget(viewport.layout, {
    path: point.path,
    offset: point.offset,
  });
  if (exactCaret) {
    return { bottom: exactCaret.top + exactCaret.height, top: exactCaret.top };
  }
  return viewport.estimatePathBounds(point.path);
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
