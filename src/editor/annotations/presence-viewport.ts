import type { ViewportLayout } from "../layout";
import { measureCaretTarget } from "../layout";
import type { DocumentIndex } from "../state";
import type { EditorState } from "../state/state";
import type {
  EditorPresence,
  EditorPresenceViewport,
  EditorPresenceViewportStatus,
} from "./presence";

type PresenceViewport = {
  estimateRegionBounds: (regionId: string) => { bottom: number; top: number } | null;
  layout: ViewportLayout;
  totalHeight: number;
  viewport: {
    height: number;
    top: number;
  };
};

const presenceViewportScrollMargin = 48;

export function resolvePresenceViewport(
  state: EditorState,
  viewport: PresenceViewport,
  presence: EditorPresence[],
): EditorPresence[];
export function resolvePresenceViewport(
  documentIndex: DocumentIndex,
  viewport: PresenceViewport,
  presence: EditorPresence[],
): EditorPresence[];
export function resolvePresenceViewport(
  stateOrIndex: EditorState | DocumentIndex,
  viewport: PresenceViewport,
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
  viewport: PresenceViewport,
  presence: EditorPresence,
): EditorPresenceViewport {
  if (!presence.cursorPoint) {
    return createUnresolvedPresenceViewport();
  }

  const exactCaret = measureCaretTarget(viewport.layout, documentIndex, presence.cursorPoint);
  const extent = exactCaret
    ? {
        bottom: exactCaret.top + exactCaret.height,
        top: exactCaret.top,
      }
    : viewport.estimateRegionBounds(presence.cursorPoint.regionId);

  if (!extent) {
    return createUnresolvedPresenceViewport();
  }

  return {
    scrollTop: resolvePresenceCursorScrollTop(viewport, extent),
    status: resolvePresenceViewportStatus(viewport, extent),
  };
}

function resolvePresenceViewportStatus(
  viewport: PresenceViewport,
  extent: { bottom: number; top: number },
): EditorPresenceViewportStatus {
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

function resolvePresenceCursorScrollTop(viewport: PresenceViewport, extent: { top: number }) {
  const maxScrollTop = Math.max(0, viewport.totalHeight - viewport.viewport.height);
  const targetTop =
    extent.top - Math.min(presenceViewportScrollMargin, viewport.viewport.height / 4);

  return Math.max(0, Math.min(maxScrollTop, targetTop));
}

function createUnresolvedPresenceViewport(): EditorPresenceViewport {
  return {
    scrollTop: null,
    status: "unresolved",
  };
}
