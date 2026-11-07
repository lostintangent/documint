import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
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
  focused: boolean;
  readOnly: boolean;
  viewportWidth: number;
  viewportHeight: number;

  // Host callbacks the hook invokes.
  getScrollTop: () => number;
  scrollTo: (top: number) => void;
};

type CursorController = {
  leaf: CursorLeaf | null;
  isVisible: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
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
export const CURSOR_REVEAL_PADDING = 24;

export function useCursor({
  activeAt,
  focused,
  getScrollTop,
  viewportWidth,
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
  const [blink] = useState(() =>
    createCaretBlink((toggle) => {
      const intervalId = window.setInterval(toggle, CARET_BLINK_INTERVAL_MS);
      return () => window.clearInterval(intervalId);
    }),
  );
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

  const caretShown = focused && !readOnly;
  const caretBlinks = normalizedSelection.collapsed && caretInViewport && activeAt === null;
  // A layout effect, so a blur or read-only flip hides the caret in the same
  // commit, before the next overlay paint reads it.
  useLayoutEffect(() => blink.sync(caretShown, caretBlinks), [blink, caretBlinks, caretShown]);

  /* Public API */

  return {
    leaf,
    isVisible: blink.isVisible,
    subscribeVisibility: blink.subscribe,
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

export function createCaretBlink(startTimer: (toggle: () => void) => () => void) {
  const listeners = new Set<() => void>();
  let visible = false;
  const setVisible = (next: boolean) => {
    if (next === visible) return;
    visible = next;
    listeners.forEach((listener) => listener());
  };

  return {
    isVisible: () => visible,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync: (shown: boolean, blinks: boolean) => {
      setVisible(shown);
      return shown && blinks ? startTimer(() => setVisible(!visible)) : undefined;
    },
  };
}
