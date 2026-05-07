import type { CaretTarget } from "@/editor";
import { useEffect, useEffectEvent, useRef } from "react";
import {
  caretInViewportValue,
  caretTargetValue,
  cursorLeafValue,
  normalizedSelectionValue,
  useStoreValue,
  type CursorLeaf,
} from "../store";

/* Hook surface */

type UseCursorOptions = {
  isEditable: boolean;
  layoutWidth: number;
  scrollContentHeight: number;
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
  markActivity: () => void;
};

type FocusVisibilityRequest = {
  layoutWidth: number;
  offset: number;
  regionId: string;
  scrollContentHeight: number;
  viewportHeight: number;
};

/* Constants */

// How long the caret stays solid after a keystroke before blinking resumes.
const CARET_IDLE_DELAY_MS = 600;

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
 *   - Caret blink lifecycle: solid for `CARET_IDLE_DELAY_MS` after any
 *     activity, then blinking at `CARET_BLINK_INTERVAL_MS`. Disabled when a
 *     range is selected, and suspended when the caret is off-viewport.
 *   - Store-derived cursor view data: the contextual leaf, caret viewport
 *     status, and measured caret target.
 *   - `markActivity()` — the activity signal other hooks call to keep the
 *     caret solid during typing, scrolling, and pointer interactions.
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
 *   - The host wires `markActivity` into other hooks (`useInput`,
 *     `usePointer`, `useSelection`) so any user action keeps the caret
 *     solid for a moment before blinking resumes.
 *   - The host provides `onVisibilityChange` (typically a render scheduler
 *     callback) so blink ticks can repaint the overlay canvas.
 *   - The host provides `scrollTo` and viewport metrics so this hook can
 *     keep the caret in view without the host owning that logic.
 */
export function useCursor({
  getScrollTop,
  isEditable,
  layoutWidth,
  onVisibilityChange,
  scrollContentHeight,
  scrollTo,
  viewportHeight,
}: UseCursorOptions): CursorController {
  /* Internal state */

  const normalizedSel = useStoreValue(normalizedSelectionValue);
  const leaf = useStoreValue(cursorLeafValue, isEditable);
  const caretInViewport = useStoreValue(caretInViewportValue);
  const caretTarget = useStoreValue(caretTargetValue);
  const shouldBlinkCaret =
    normalizedSel.start.regionId === normalizedSel.end.regionId &&
    normalizedSel.start.offset === normalizedSel.end.offset;
  const cursorVisibleRef = useRef(true);
  const lastActivityAtRef = useRef(0);
  const lastFocusVisibilityRequestRef = useRef<FocusVisibilityRequest | null>(null);

  /* Activity + visibility */

  const requestVisibilityPaint = useEffectEvent(() => {
    onVisibilityChange();
  });

  const markActivity = useEffectEvent(() => {
    lastActivityAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    cursorVisibleRef.current = true;
    requestVisibilityPaint();
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
      scrollContentHeight,
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
    scrollContentHeight,
    viewportHeight,
  ]);

  /* Caret blink loop */

  // Restart whenever the blink eligibility flips: collapsed↔ranged selection
  // (`shouldBlinkCaret`) and on/off-viewport (`caretInViewport`). The blink
  // is suspended when the caret is off-screen — the canvas painter clips
  // to the visible region anyway, so the timer ticks would just schedule
  // overlay paints that produce no pixels.
  useEffect(() => {
    cursorVisibleRef.current = true;
    requestVisibilityPaint();

    if (!shouldBlinkCaret || !caretInViewport || typeof window === "undefined") {
      return;
    }

    const intervalId = window.setInterval(() => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      if (now - lastActivityAtRef.current < CARET_IDLE_DELAY_MS) {
        if (!cursorVisibleRef.current) {
          cursorVisibleRef.current = true;
          requestVisibilityPaint();
        }

        return;
      }

      cursorVisibleRef.current = !cursorVisibleRef.current;
      requestVisibilityPaint();
    }, CARET_BLINK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [shouldBlinkCaret, caretInViewport]);

  /* Public API */

  return {
    caretInViewport,
    leaf,
    isVisible: () => cursorVisibleRef.current,
    markActivity,
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
    previous.scrollContentHeight === next.scrollContentHeight &&
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
