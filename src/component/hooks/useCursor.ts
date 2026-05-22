import type { CaretTarget } from "@/editor";
import { useEffect, useEffectEvent, useRef } from "react";
import {
  caretInViewportSprig,
  caretTargetSprig,
  normalizedSelectionSprig,
  useSprig,
} from "../store";
import { cursorLeafSprig, type CursorLeaf } from "../overlays/leaves/sprigs";

/* Hook surface */

type UseCursorOptions = {
  activeAt: number | null;
  isEditable: boolean;
  layoutWidth: number;
  viewportHeight: number;

  // Host callbacks the hook invokes.
  getScrollTop: () => number;
  onVisibilityChange: () => void;
  scrollTo: (top: number) => number;
};

type CursorController = {
  /**
   * Whether the user caret is inside the editor's visible scroll window.
   * Used internally to suspend the blink interval when the caret scrolls
   * off-screen, and exposed for consumers that want to gate other
   * caret-anchored UI on the same signal.
   */
  caretInViewport: boolean;
  leaf: CursorLeaf | null;
  isVisible: () => boolean;
};

type FocusVisibilityRequest = {
  layoutWidth: number;
  offset: number;
  regionId: string;
  viewportHeight: number;
};

/* Constants */

// Interval between caret visibility toggles once blinking starts.
const CARET_BLINK_INTERVAL_MS = 530;

// Padding above and below the caret when scrolling it into view, so it
// doesn't sit flush against the viewport edge.
const FOCUS_VISIBILITY_PADDING = 24;

/**
 * Owns the browser lifecycle around the text caret — visual blink, activity
 * signals, and keeping the caret visible in the viewport.
 *
 * What this hook owns:
 *   - Caret blink lifecycle: solid while the shared idle clock is active,
 *     then blinking at `CARET_BLINK_INTERVAL_MS`. Disabled when a range is
 *     selected, and suspended when the caret is off-viewport.
 *   - Store-derived cursor view data: the contextual leaf, caret viewport
 *     status, and measured caret target.
 *   - Focus visibility: when the caret moves out of the visible viewport
 *     (via typing, navigation, or layout changes), scroll just enough to
 *     bring it back. Dedupes against repeat triggers for the same logical
 *     state to avoid scroll thrash.
 *   - Caret viewport status: reads whether the caret is inside the
 *     visible scroll window. Drives blink suspension and is exposed for
 *     other caret-anchored UI to gate on.
 *
 * Contract with the host:
 *   - The host renders the `leaf` as a contextual overlay (alongside
 *     pointer hover and selection leaves; the host arbitrates priority).
 *   - The host calls `isVisible()` from its overlay paint pass to decide
 *     whether to draw the caret on the current frame.
 *   - The host passes the shared idle clock state so any user action
 *     keeps the caret solid for a moment before blinking resumes.
 *   - The host provides `onVisibilityChange` (typically a render scheduler
 *     callback) so blink ticks can repaint the overlay canvas.
 *   - The host provides `scrollTo` and viewport metrics so this hook can
 *     keep the caret in view without the host owning that logic.
 */
export function useCursor({
  activeAt,
  getScrollTop,
  isEditable,
  layoutWidth,
  onVisibilityChange,
  scrollTo,
  viewportHeight,
}: UseCursorOptions): CursorController {
  /* Internal state */

  const normalizedSel = useSprig(normalizedSelectionSprig);
  const leaf = useSprig(cursorLeafSprig, isEditable);
  const caretInViewport = useSprig(caretInViewportSprig);
  const caretTarget = useSprig(caretTargetSprig);
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

  // Watches the selection focus and viewport metrics. When the caret leaves
  // the visible region (after typing, navigation, or layout changes), scrolls
  // just enough to bring it back. Dedupes against repeat triggers for the
  // same logical state to avoid scroll thrash on incidental rerenders.
  useEffect(() => {
    const focus = normalizedSel.end;
    const focusVisibilityRequest: FocusVisibilityRequest = {
      layoutWidth,
      offset: focus.offset,
      regionId: focus.regionId,
      viewportHeight,
    };

    if (
      areFocusVisibilityRequestsEqual(lastFocusVisibilityRequestRef.current, focusVisibilityRequest)
    ) {
      return;
    }

    if (!caretTarget) return;

    const currentTop = getScrollTop();
    const visibleTop = currentTop + FOCUS_VISIBILITY_PADDING;
    const visibleBottom = currentTop + viewportHeight - FOCUS_VISIBILITY_PADDING;

    if (caretTarget.top < visibleTop) {
      const appliedTop = scrollTo(Math.max(0, caretTarget.top - FOCUS_VISIBILITY_PADDING));
      if (
        isCaretVisibleAtScrollTop(caretTarget, appliedTop, viewportHeight, FOCUS_VISIBILITY_PADDING)
      ) {
        lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
      }
      return;
    }

    if (caretTarget.top + caretTarget.height > visibleBottom) {
      const appliedTop = scrollTo(
        Math.max(
          0,
          caretTarget.top + caretTarget.height - viewportHeight + FOCUS_VISIBILITY_PADDING,
        ),
      );
      if (
        isCaretVisibleAtScrollTop(caretTarget, appliedTop, viewportHeight, FOCUS_VISIBILITY_PADDING)
      ) {
        lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
      }
      return;
    }

    lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
  }, [
    caretTarget,
    layoutWidth,
    normalizedSel.end.offset,
    normalizedSel.end.regionId,
    viewportHeight,
  ]);

  /* Caret blink loop */

  // Restart whenever the blink eligibility flips: collapsed↔ranged selection
  // (`shouldBlinkCaret`), on/off-viewport (`caretInViewport`), and
  // active/idle input. During activity the caret stays solid and no blink
  // interval runs.
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
    previous?.layoutWidth === next.layoutWidth &&
    previous.regionId === next.regionId &&
    previous.offset === next.offset &&
    previous.viewportHeight === next.viewportHeight
  );
}

function isCaretVisibleAtScrollTop(
  caret: Pick<CaretTarget, "height" | "top">,
  scrollTop: number,
  visibleHeight: number,
  padding: number,
) {
  return (
    caret.top >= scrollTop + padding &&
    caret.top + caret.height <= scrollTop + visibleHeight - padding
  );
}
