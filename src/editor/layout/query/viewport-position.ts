// Owns viewport-relative classification for already-measured geometry.

import type { EditorLayoutState } from "../state";

export type ViewportPositionStatus = "above" | "below" | "visible";

export function resolvePositionInViewport(
  viewport: EditorLayoutState,
  position: { bottom: number; top: number },
): ViewportPositionStatus {
  const viewportTop = viewport.viewport.top;
  const viewportBottom = viewportTop + viewport.viewport.height;

  if (position.bottom < viewportTop) {
    return "above";
  }

  if (position.top > viewportBottom) {
    return "below";
  }

  return "visible";
}
