import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import {
  caretInViewportSprig,
  caretTargetSprig,
  normalizedSelectionSprig,
  renderedViewportSizeSprig,
  selectionSprig,
  useDocumintStore,
  useSprig,
} from "../store";
import { cursorLeafSprig, type CursorLeaf } from "../overlays/leaves/sprigs";
import type {
  CaretTarget,
  EditorLayoutState,
  EditorSelection,
  NormalizedEditorSelection,
} from "@/editor";
import { equalShallowObject } from "../store/core/equality";

/* Hook surface */

type UseCursorOptions = {
  activeAt: number | null;
  readOnly: boolean;
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

type CursorRevealIntent = {
  selection: EditorSelection;
  viewportWidth: number;
  viewportHeight: number;
};

type CursorRevealTarget = {
  bottom: number;
  top: number;
  viewportHeight: number;
  viewportWidth: number;
};

/* Constants */

// Interval between caret visibility toggles once blinking starts.
const CARET_BLINK_INTERVAL_MS = 530;

// Padding above and below the caret when scrolling it into view, so it
// doesn't sit flush against the viewport edge.
const CURSOR_REVEAL_PADDING = 24;

export function useCursor({
  activeAt,
  getScrollTop,
  viewportWidth,
  onVisibilityChange,
  readOnly,
  scrollTo,
  viewportHeight,
}: UseCursorOptions): CursorController {
  /* Shared cursor state */

  const normalizedSelection = useSprig(normalizedSelectionSprig);
  const selection = useSprig(selectionSprig);
  const store = useDocumintStore();

  /* Cursor leaf */

  const leaf = useSprig(cursorLeafSprig, readOnly);

  /* Cursor reveal */

  const caretTarget = useSprig(caretTargetSprig);
  const renderedViewportSize = useSprig(renderedViewportSizeSprig);
  const lastRevealIntentRef = useRef<CursorRevealIntent | null>(null);

  /* Caret blink */

  const caretInViewport = useSprig(caretInViewportSprig);
  const shouldBlinkCaret = !readOnly && normalizedSelection.collapsed;
  const caretVisibleRef = useRef(true);
  const requestCaretPaint = useEffectEvent(() => {
    onVisibilityChange();
  });
  const revealCursorTarget = useEffectEvent((target: CursorRevealTarget) => {
    const currentTop = getScrollTop();
    const visibleTop = currentTop + CURSOR_REVEAL_PADDING;
    const visibleBottom = currentTop + viewportHeight - CURSOR_REVEAL_PADDING;

    if (target.top < visibleTop) {
      scrollTo(Math.max(0, target.top - CURSOR_REVEAL_PADDING));
      return;
    }

    if (target.bottom > visibleBottom) {
      scrollTo(Math.max(0, target.bottom - viewportHeight + CURSOR_REVEAL_PADDING));
    }
  });

  /* Cursor reveal effect */

  // Reveal focus after selection moves or viewport dimensions change. Plain
  // scrolling republishes layout too, but it should not pull the viewport back
  // to an unchanged selection.
  useLayoutEffect(() => {
    const revealTarget = resolveCursorRevealTarget({
      caretTarget,
      layout: store.layout.peekRendered(),
      normalizedSelection,
    });

    if (!revealTarget) return;
    if (
      revealTarget.viewportWidth !== viewportWidth ||
      revealTarget.viewportHeight !== viewportHeight
    ) {
      return;
    }

    const revealIntent: CursorRevealIntent = {
      selection,
      viewportWidth,
      viewportHeight,
    };

    if (equalShallowObject(lastRevealIntentRef.current, revealIntent)) {
      return;
    }

    lastRevealIntentRef.current = revealIntent;
    revealCursorTarget(revealTarget);
  }, [
    caretTarget,
    normalizedSelection,
    renderedViewportSize,
    selection,
    store.layout,
    viewportWidth,
    viewportHeight,
  ]);

  /* Caret blink effect */

  // During activity the caret stays solid; idle collapsed selections blink.
  useEffect(() => {
    caretVisibleRef.current = !readOnly;
    requestCaretPaint();

    if (!shouldBlinkCaret || !caretInViewport || activeAt !== null) {
      return;
    }

    const intervalId = window.setInterval(() => {
      caretVisibleRef.current = !caretVisibleRef.current;
      requestCaretPaint();
    }, CARET_BLINK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [readOnly, shouldBlinkCaret, caretInViewport, activeAt]);

  /* Public API */

  return {
    caretInViewport,
    leaf,
    // `isVisible` is read during render, before effects can clear the ref
    // after a read-only flip. Keep the read-only gate on the synchronous read.
    isVisible: () => !readOnly && caretVisibleRef.current,
  };
}

function resolveCursorRevealTarget({
  caretTarget,
  layout,
  normalizedSelection,
}: {
  caretTarget: CaretTarget | null;
  layout: EditorLayoutState | null;
  normalizedSelection: NormalizedEditorSelection;
}): CursorRevealTarget | null {
  if (!layout) {
    return null;
  }

  if (caretTarget) {
    return {
      bottom: caretTarget.top + caretTarget.height,
      top: caretTarget.top,
      viewportHeight: layout.viewport.height,
      viewportWidth: layout.viewport.width,
    };
  }

  const bounds = layout.estimatePathBounds(normalizedSelection.end.path);
  return bounds
    ? {
        ...bounds,
        viewportHeight: layout.viewport.height,
        viewportWidth: layout.viewport.width,
      }
    : null;
}
