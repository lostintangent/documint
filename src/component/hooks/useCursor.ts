import { useEffect, useEffectEvent, useRef } from "react";
import {
  caretInViewportSprig,
  cursorScrollTargetSprig,
  normalizedSelectionSprig,
  useSprig,
  type CursorScrollTarget,
} from "../store";
import { cursorLeafSprig, type CursorLeaf } from "../overlays/leaves/sprigs";

/* Hook surface */

type UseCursorOptions = {
  activeAt: number | null;
  isEditable: boolean;
  viewportWidth: number;
  viewportHeight: number;

  // Host callbacks the hook invokes.
  getScrollTop: () => number;
  onVisibilityChange: () => void;
  scrollTo: (top: number) => number;
};

type CursorController = {
  /**
   * Whether the caret is inside the visible scroll window. Used to suspend
   * blinking and gate caret-anchored UI.
   */
  caretInViewport: boolean;
  leaf: CursorLeaf | null;
  isVisible: () => boolean;
};

type FocusVisibilityRequest = {
  bottom: number;
  scrollTop: number;
  top: number;
  viewportWidth: number;
  viewportHeight: number;
};

/* Constants */

// Interval between caret visibility toggles once blinking starts.
const CARET_BLINK_INTERVAL_MS = 530;

// Padding above and below the caret when scrolling it into view, so it
// doesn't sit flush against the viewport edge.
const FOCUS_VISIBILITY_PADDING = 24;

/**
 * Owns caret browser lifetimes: contextual leaf data, blink cadence, viewport
 * status, and focus visibility. Selection moves scroll through
 * `cursorScrollTargetSprig`, whose estimated-bounds fallback lets off-layout
 * jumps such as search navigation land before the next layout pass.
 */
export function useCursor({
  activeAt,
  getScrollTop,
  isEditable,
  viewportWidth,
  onVisibilityChange,
  scrollTo,
  viewportHeight,
}: UseCursorOptions): CursorController {
  /* Internal state */

  const normalizedSel = useSprig(normalizedSelectionSprig);
  const leaf = useSprig(cursorLeafSprig, isEditable);
  const caretInViewport = useSprig(caretInViewportSprig);
  const scrollTarget = useSprig(cursorScrollTargetSprig);
  const shouldBlinkCaret =
    normalizedSel.start.regionId === normalizedSel.end.regionId &&
    normalizedSel.start.offset === normalizedSel.end.offset;
  const cursorVisibleRef = useRef(true);
  const lastFocusVisibilityRequestRef = useRef<FocusVisibilityRequest | null>(null);

  /* Visibility */

  const requestVisibilityPaint = useEffectEvent(() => {
    onVisibilityChange();
  });

  /* Focus visibility */

  // Dedupe identical visibility requests; layout/scroll changes may publish
  // the same target more than once.
  useEffect(() => {
    if (!scrollTarget) return;

    const focusVisibilityRequest: FocusVisibilityRequest = {
      bottom: scrollTarget.bottom,
      scrollTop: getScrollTop(),
      top: scrollTarget.top,
      viewportWidth,
      viewportHeight,
    };

    if (
      areFocusVisibilityRequestsEqual(lastFocusVisibilityRequestRef.current, focusVisibilityRequest)
    ) {
      return;
    }

    const currentTop = focusVisibilityRequest.scrollTop;
    const visibleTop = currentTop + FOCUS_VISIBILITY_PADDING;
    const visibleBottom = currentTop + viewportHeight - FOCUS_VISIBILITY_PADDING;

    if (scrollTarget.top < visibleTop) {
      const appliedTop = scrollTo(Math.max(0, scrollTarget.top - FOCUS_VISIBILITY_PADDING));
      if (
        isScrollTargetVisible(scrollTarget, appliedTop, viewportHeight, FOCUS_VISIBILITY_PADDING)
      ) {
        lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
      }
      return;
    }

    if (scrollTarget.bottom > visibleBottom) {
      const appliedTop = scrollTo(
        Math.max(0, scrollTarget.bottom - viewportHeight + FOCUS_VISIBILITY_PADDING),
      );
      if (
        isScrollTargetVisible(scrollTarget, appliedTop, viewportHeight, FOCUS_VISIBILITY_PADDING)
      ) {
        lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
      }
      return;
    }

    lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
  }, [scrollTarget, viewportWidth, viewportHeight]);

  /* Caret blink loop */

  // During activity the caret stays solid; idle collapsed selections blink.
  useEffect(() => {
    cursorVisibleRef.current = true;
    requestVisibilityPaint();

    if (!shouldBlinkCaret || !caretInViewport || activeAt !== null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      cursorVisibleRef.current = !cursorVisibleRef.current;
      requestVisibilityPaint();
    }, CARET_BLINK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [shouldBlinkCaret, caretInViewport, activeAt]);

  /* Public API */

  return {
    caretInViewport,
    leaf,
    isVisible: () => cursorVisibleRef.current,
  };
}

function areFocusVisibilityRequestsEqual(
  previous: FocusVisibilityRequest | null,
  next: FocusVisibilityRequest,
) {
  return (
    previous?.bottom === next.bottom &&
    previous?.scrollTop === next.scrollTop &&
    previous?.top === next.top &&
    previous?.viewportWidth === next.viewportWidth &&
    previous?.viewportHeight === next.viewportHeight
  );
}

function isScrollTargetVisible(
  target: CursorScrollTarget,
  scrollTop: number,
  visibleHeight: number,
  padding: number,
) {
  return target.top >= scrollTop + padding && target.bottom <= scrollTop + visibleHeight - padding;
}
