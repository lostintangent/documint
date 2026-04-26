import {
  measureCaretTarget,
  measureVisualCaretTarget,
  normalizeSelection,
  resolveTargetAtSelection,
  type EditorCommentState,
  type EditorState,
  type EditorViewportState,
  type NormalizedEditorSelection,
} from "@/editor";
import type { LazyRefHandle } from "./useLazyRef";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveContextualLeaf, type ContextualLeaf } from "../overlays/leaves/lib/leaf-target";

/* Public types (consumed by the host to render the cursor leaf) */

export type InsertionLeaf = {
  kind: "insertion";
  left: number;
  top: number;
};

export type TableLeaf = {
  cellIndex: number;
  columnCount: number;
  kind: "table";
  left: number;
  rowCount: number;
  rowIndex: number;
  top: number;
};

export type CursorLeaf = ContextualLeaf | InsertionLeaf | TableLeaf;

/* Hook surface */

type UseCursorOptions = {
  // Editor state and lookups the hook reads from.
  canShowInsertionLeaf: boolean;
  canShowTableLeaf: boolean;
  commentState: EditorCommentState;
  editorState: EditorState;
  editorViewportState: LazyRefHandle<EditorViewportState>;
  layoutWidth: number;
  scrollContentHeight: number;
  viewportHeight: number;

  // Host callbacks the hook invokes.
  getScrollTop: () => number;
  onVisibilityChange: () => void;
  scrollTo: (top: number) => number;
};

type CursorController = {
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
 * Owns everything anchored to the text caret — visual blink, the contextual
 * leaf at the caret position, and keeping the caret visible in the viewport.
 *
 * What this hook owns:
 *   - Caret blink lifecycle: solid for `CARET_IDLE_DELAY_MS` after any
 *     activity, then blinking at `CARET_BLINK_INTERVAL_MS`. Disabled when a
 *     range is selected.
 *   - The "cursor leaf" — an insertion menu (empty paragraph), table
 *     control, or contextual link/comment leaf, derived from where the
 *     caret currently sits.
 *   - `markActivity()` — the activity signal other hooks call to keep the
 *     caret solid during typing, scrolling, and pointer interactions.
 *   - Focus visibility: when the caret moves out of the visible viewport
 *     (via typing, navigation, or layout changes), scroll just enough to
 *     bring it back. Dedupes against repeat triggers for the same logical
 *     state to avoid scroll thrash.
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
  canShowInsertionLeaf,
  canShowTableLeaf,
  commentState,
  editorState,
  editorViewportState,
  getScrollTop,
  layoutWidth,
  onVisibilityChange,
  scrollContentHeight,
  scrollTo,
  viewportHeight,
}: UseCursorOptions): CursorController {
  /* Internal state */

  const normalizedSel = useMemo(() => normalizeSelection(editorState), [editorState]);
  const [leaf, setLeaf] = useState<CursorLeaf | null>(null);
  const shouldBlinkCaret =
    normalizedSel.start.regionId === normalizedSel.end.regionId &&
    normalizedSel.start.offset === normalizedSel.end.offset;
  const cursorVisibleRef = useRef(true);
  const lastActivityAtRef = useRef(0);
  const lastFocusVisibilityRequestRef = useRef<FocusVisibilityRequest | null>(null);

  /* Activity + visibility */

  const emitVisibilityChange = useEffectEvent(() => {
    onVisibilityChange();
  });

  const markActivity = useEffectEvent(() => {
    lastActivityAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    cursorVisibleRef.current = true;
    emitVisibilityChange();
  });

  /* Cursor leaf */

  useLayoutEffect(() => {
    const nextLeaf = resolveCursorLeaf({
      canShowInsertionLeaf,
      canShowTableLeaf,
      commentState,
      normalizedSelection: normalizedSel,
      state: editorState,
      viewport: editorViewportState.get(),
    });

    setLeaf((previous) => (areCursorLeavesEqual(previous, nextLeaf) ? previous : nextLeaf));
  }, [
    canShowInsertionLeaf,
    canShowTableLeaf,
    commentState,
    editorState,
    editorViewportState,
  ]);

  /* Focus visibility */

  // Watches the selection focus and viewport metrics. When the caret leaves
  // the visible region (after typing, navigation, or layout changes), scrolls
  // just enough to bring it back. Dedupes against repeat triggers for the
  // same logical state to avoid scroll thrash on incidental rerenders.
  useEffect(() => {
    const focus = editorState.selection.focus;
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

    const caret = measureCaretTarget(editorState, editorViewportState.get(), focus);
    if (!caret) return;

    const currentTop = getScrollTop();
    const visibleTop = currentTop + FOCUS_VISIBILITY_PADDING;
    const visibleBottom = currentTop + viewportHeight - FOCUS_VISIBILITY_PADDING;

    if (caret.top < visibleTop) {
      const appliedTop = scrollTo(Math.max(0, caret.top - FOCUS_VISIBILITY_PADDING));
      if (isCaretVisibleAtScrollTop(caret, appliedTop, viewportHeight, FOCUS_VISIBILITY_PADDING)) {
        lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
      }
      return;
    }

    if (caret.top + caret.height > visibleBottom) {
      const appliedTop = scrollTo(
        Math.max(0, caret.top + caret.height - viewportHeight + FOCUS_VISIBILITY_PADDING),
      );
      if (isCaretVisibleAtScrollTop(caret, appliedTop, viewportHeight, FOCUS_VISIBILITY_PADDING)) {
        lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
      }
      return;
    }

    lastFocusVisibilityRequestRef.current = focusVisibilityRequest;
  }, [
    editorState,
    editorState.selection.focus.offset,
    editorState.selection.focus.regionId,
    editorViewportState,
    layoutWidth,
    scrollContentHeight,
    scrollTo,
    viewportHeight,
  ]);

  /* Caret blink loop */

  useEffect(() => {
    cursorVisibleRef.current = true;
    emitVisibilityChange();

    if (!shouldBlinkCaret || typeof window === "undefined") {
      return;
    }

    const intervalId = window.setInterval(() => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      if (now - lastActivityAtRef.current < CARET_IDLE_DELAY_MS) {
        if (!cursorVisibleRef.current) {
          cursorVisibleRef.current = true;
          emitVisibilityChange();
        }

        return;
      }

      cursorVisibleRef.current = !cursorVisibleRef.current;
      emitVisibilityChange();
    }, CARET_BLINK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [shouldBlinkCaret]);

  /* Public API */

  return {
    leaf,
    isVisible: () => cursorVisibleRef.current,
    markActivity,
  };
}

function resolveCursorLeaf({
  canShowInsertionLeaf,
  canShowTableLeaf,
  commentState,
  normalizedSelection,
  state,
  viewport,
}: {
  canShowInsertionLeaf: boolean;
  canShowTableLeaf: boolean;
  commentState: EditorCommentState;
  normalizedSelection: NormalizedEditorSelection;
  state: EditorState;
  viewport: EditorViewportState | null;
}): CursorLeaf | null {
  if (!viewport) {
    return null;
  }
  const focus = state.selection.focus;

  if (
    normalizedSelection.start.regionId !== normalizedSelection.end.regionId ||
    normalizedSelection.start.offset !== normalizedSelection.end.offset
  ) {
    return null;
  }

  const insertionLeaf = canShowInsertionLeaf ? resolveInsertionLeaf(state, viewport) : null;

  if (insertionLeaf) {
    return insertionLeaf;
  }

  const tableLeaf = canShowTableLeaf ? resolveTableLeaf(state, viewport) : null;

  if (tableLeaf) {
    return tableLeaf;
  }

  return resolveContextualLeaf(
    resolveTargetAtSelection(state, viewport, focus, commentState.liveRanges),
    commentState.threads,
  );
}

function resolveTableLeaf(state: EditorState, viewport: EditorViewportState): TableLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = state.documentIndex.regionIndex.get(focus.regionId);
  const tableCellPosition = focusedRegion
    ? (state.documentIndex.tableCellIndex.get(focusedRegion.id) ?? null)
    : null;

  if (!focusedRegion || !tableCellPosition) {
    return null;
  }

  const blockEntry = state.documentIndex.blockIndex.get(focusedRegion.blockId);
  const table =
    blockEntry?.type === "table" ? state.documentIndex.document.blocks[blockEntry.rootIndex] : null;

  if (!blockEntry || !table || table.type !== "table") {
    return null;
  }

  const caret = measureVisualCaretTarget(state, viewport, focus);
  const textLeft = resolveRegionTextLeft(viewport, focusedRegion.id);
  const columnCount = Math.max(1, ...table.rows.map((row) => row.cells.length));

  return caret && textLeft !== null
    ? {
        cellIndex: tableCellPosition.cellIndex,
        columnCount,
        kind: "table",
        left: textLeft,
        rowCount: table.rows.length,
        rowIndex: tableCellPosition.rowIndex,
        top: caret.top + caret.height,
      }
    : null;
}

function resolveRegionTextLeft(viewport: EditorViewportState, regionId: string) {
  const firstLine = viewport.layout.lines.find((line) => line.regionId === regionId);

  return firstLine ? firstLine.left : null;
}

function resolveInsertionLeaf(
  state: EditorState,
  viewport: EditorViewportState,
): InsertionLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = state.documentIndex.regionIndex.get(focus.regionId);

  if (!focusedRegion || focusedRegion.blockType !== "paragraph" || focusedRegion.text.length > 0) {
    return null;
  }

  if (focus.offset !== 0) {
    return null;
  }

  const blockEntry = state.documentIndex.blockIndex.get(focusedRegion.blockId);

  if (!blockEntry || blockEntry.parentBlockId !== null) {
    return null;
  }

  const caret = measureVisualCaretTarget(state, viewport, focus);

  return caret
    ? {
        kind: "insertion",
        left: caret.left,
        top: caret.top + caret.height,
      }
    : null;
}

function areCursorLeavesEqual(previous: CursorLeaf | null, next: CursorLeaf | null) {
  if (previous === next) {
    return true;
  }

  if (!previous || !next || previous.kind !== next.kind) {
    return false;
  }

  switch (previous.kind) {
    case "comment":
      return (
        next.kind === "comment" &&
        previous.left === next.left &&
        previous.link?.title === next.link?.title &&
        previous.link?.url === next.link?.url &&
        previous.thread === next.thread &&
        previous.threadIndex === next.threadIndex &&
        previous.top === next.top
      );
    case "insertion":
      return next.kind === "insertion" && previous.left === next.left && previous.top === next.top;
    case "link":
      return (
        next.kind === "link" &&
        previous.endOffset === next.endOffset &&
        previous.left === next.left &&
        previous.regionId === next.regionId &&
        previous.startOffset === next.startOffset &&
        previous.title === next.title &&
        previous.top === next.top &&
        previous.url === next.url
      );
    case "table":
      return (
        next.kind === "table" &&
        previous.cellIndex === next.cellIndex &&
        previous.columnCount === next.columnCount &&
        previous.left === next.left &&
        previous.rowCount === next.rowCount &&
        previous.rowIndex === next.rowIndex &&
        previous.top === next.top
      );
  }
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
  caret: { height: number; top: number },
  scrollTop: number,
  visibleHeight: number,
  padding: number,
) {
  return (
    caret.top >= scrollTop + padding &&
    caret.top + caret.height <= scrollTop + visibleHeight - padding
  );
}
