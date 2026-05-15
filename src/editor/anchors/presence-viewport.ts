/**
 * Geometric projection of a cursor against the prepared viewport. Decides
 * whether a cursor sits above, below, or inside the visible scroll window.
 *
 * Two consumers:
 *   - `resolvePresenceViewport` — runs over the full presence list and adds a
 *     scroll target so the host can scroll to an off-screen remote cursor.
 *   - `resolveCursorViewportStatus` — single-cursor status check. Used by the
 *     host's own caret (`useCursor`) to gate the leaf overlay and the blink
 *     interval when the user's cursor scrolls off-screen.
 *
 * The geometric core (`resolvePositionInViewport`) is shared with other
 * viewport-gated content, including animated text decorations.
 */

import { measureCaretTarget, resolvePositionInViewport, type EditorLayoutState } from "../layout";
import type { DocumentIndex, EditorSelectionPoint } from "../state";
import type { EditorState } from "../state/types";
import type {
  EditorPresence,
  EditorPresenceViewport,
  EditorPresenceViewportStatus,
} from "./presence";

const presenceViewportScrollMargin = 48;

/* Public API */

export function resolvePresenceViewport(
  state: EditorState,
  viewport: EditorLayoutState,
  presence: EditorPresence[],
): EditorPresence[];
export function resolvePresenceViewport(
  documentIndex: DocumentIndex,
  viewport: EditorLayoutState,
  presence: EditorPresence[],
): EditorPresence[];
export function resolvePresenceViewport(
  stateOrIndex: EditorState | DocumentIndex,
  viewport: EditorLayoutState,
  presence: EditorPresence[],
): EditorPresence[] {
  const documentIndex = "documentIndex" in stateOrIndex ? stateOrIndex.documentIndex : stateOrIndex;
  if (presence.length === 0) {
    return [];
  }

  return presence.map((presenceItem) => ({
    ...presenceItem,
    viewport: resolveEditorPresenceViewport(documentIndex, viewport, presenceItem),
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
  presence: EditorPresence,
): EditorPresenceViewport {
  if (!presence.cursorPoint) {
    return { status: "unresolved" };
  }

  const position = resolveCursorPosition(documentIndex, viewport, presence.cursorPoint);
  if (!position) {
    return { status: "unresolved" };
  }

  return {
    scrollTop: resolvePresenceCursorScrollTop(viewport, position),
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

function resolvePresenceCursorScrollTop(viewport: EditorLayoutState, position: { top: number }) {
  const maxScrollTop = Math.max(0, viewport.totalHeight - viewport.viewport.height);
  const targetTop =
    position.top - Math.min(presenceViewportScrollMargin, viewport.viewport.height / 4);

  return Math.max(0, Math.min(maxScrollTop, targetTop));
}
