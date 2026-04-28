/**
 * Geometric projection of resolved presence cursors against the prepared
 * viewport. Decides whether each cursor is above, below, or visible in the
 * current scroll window, and computes the scroll target needed to bring an
 * off-screen cursor into view.
 *
 * Sibling to `./presence`, which owns the semantic step (anchor → cursor
 * point); this module owns the geometric step.
 */

import { measureCaretTarget, type EditorViewportState } from "../layout";
import type { DocumentIndex } from "../state";
import type { EditorState } from "../state/types";
import type { EditorPresence, EditorPresenceViewport } from "./presence";

const presenceViewportScrollMargin = 48;

export function resolvePresenceViewport(
  state: EditorState,
  viewport: EditorViewportState,
  presence: EditorPresence[],
): EditorPresence[];
export function resolvePresenceViewport(
  documentIndex: DocumentIndex,
  viewport: EditorViewportState,
  presence: EditorPresence[],
): EditorPresence[];
export function resolvePresenceViewport(
  stateOrIndex: EditorState | DocumentIndex,
  viewport: EditorViewportState,
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

function resolveEditorPresenceViewport(
  documentIndex: DocumentIndex,
  viewport: EditorViewportState,
  presence: EditorPresence,
): EditorPresenceViewport {
  if (!presence.cursorPoint) {
    return { status: "unresolved" };
  }

  const exactCaret = measureCaretTarget(viewport.layout, documentIndex, presence.cursorPoint);
  const extent = exactCaret
    ? {
        bottom: exactCaret.top + exactCaret.height,
        top: exactCaret.top,
      }
    : viewport.estimateRegionBounds(presence.cursorPoint.regionId);

  if (!extent) {
    return { status: "unresolved" };
  }

  return {
    scrollTop: resolvePresenceCursorScrollTop(viewport, extent),
    status: resolvePresenceViewportStatus(viewport, extent),
  };
}

function resolvePresenceViewportStatus(
  viewport: EditorViewportState,
  extent: { bottom: number; top: number },
): "above" | "below" | "visible" {
  const viewportTop = viewport.viewport.top;
  const viewportBottom = viewportTop + viewport.viewport.height;

  if (extent.bottom < viewportTop) {
    return "above";
  }

  if (extent.top > viewportBottom) {
    return "below";
  }

  return "visible";
}

function resolvePresenceCursorScrollTop(viewport: EditorViewportState, extent: { top: number }) {
  const maxScrollTop = Math.max(0, viewport.totalHeight - viewport.viewport.height);
  const targetTop =
    extent.top - Math.min(presenceViewportScrollMargin, viewport.viewport.height / 4);

  return Math.max(0, Math.min(maxScrollTop, targetTop));
}
