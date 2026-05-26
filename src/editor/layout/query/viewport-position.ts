// Owns viewport-relative classification for already-measured geometry.

import type { EditorLayoutState } from "../state";

export type ViewportPositionStatus = "above" | "below" | "visible";

export type ScrollRevealAlignment = "auto" | "end" | "start";

const DEFAULT_SCROLL_REVEAL_MARGIN = 48;

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

/**
 * Resolves the scroll-container top that reveals `bounds` inside the prepared
 * viewport, leaving a comfort margin from the viewport edge.
 *
 *   - `align: "start"` anchors the top of `bounds` near the top of the viewport.
 *   - `align: "end"` anchors the bottom of `bounds` near the bottom.
 *   - `align: "auto"` (default) anchors at the start when `bounds` sits above
 *     the current viewport or is too tall to fit comfortably, and at the end
 *     when `bounds` sits below — preserving prior reading context when
 *     scrolling down to find something.
 *
 * `margin` is clamped to at most a quarter of the viewport height so very
 * short viewports still resolve sensibly. The result is clamped to the
 * scrollable range `[0, totalHeight - viewportHeight]`.
 */
export function resolveScrollTopToReveal(
  viewport: EditorLayoutState,
  bounds: { bottom: number; top: number },
  options: { align?: ScrollRevealAlignment; margin?: number } = {},
): number {
  const viewportHeight = viewport.viewport.height;
  const maxScrollTop = Math.max(0, viewport.totalHeight - viewportHeight);
  const margin = Math.min(options.margin ?? DEFAULT_SCROLL_REVEAL_MARGIN, viewportHeight / 4);
  const align = resolveScrollRevealAlignment(viewport, bounds, options.align ?? "auto", margin);
  const candidate =
    align === "start" ? bounds.top - margin : bounds.bottom - viewportHeight + margin;

  return Math.max(0, Math.min(maxScrollTop, candidate));
}

function resolveScrollRevealAlignment(
  viewport: EditorLayoutState,
  bounds: { bottom: number; top: number },
  align: ScrollRevealAlignment,
  margin: number,
): "end" | "start" {
  if (align !== "auto") {
    return align;
  }

  // Bounds too tall to fit between the two margins: anchor at the start so
  // the leading edge of the content is the part the user sees.
  if (bounds.bottom - bounds.top > viewport.viewport.height - margin * 2) {
    return "start";
  }

  // Bounds already above the current viewport: bring them down to the top.
  if (bounds.top < viewport.viewport.top + margin) {
    return "start";
  }

  // Bounds inside or below the current viewport: bring them up to the
  // bottom edge so prior context stays visible above.
  return "end";
}
