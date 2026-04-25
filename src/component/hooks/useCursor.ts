import {
  measureVisualCaretTarget,
  normalizeSelection,
  resolveTargetAtSelection,
  type EditorState,
  type EditorViewportState,
  type NormalizedEditorSelection,
} from "@/editor";
import type { EditorCommentState } from "@/editor/annotations";
import type { LazyRefHandle } from "./useLazyRef";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveContextualLeaf, type ContextualLeaf } from "../leaves/lib/leaf-target";

type UseCursorOptions = {
  canShowInsertionLeaf: boolean;
  canShowTableLeaf: boolean;
  commentState: EditorCommentState;
  editorState: EditorState;
  editorViewportState: LazyRefHandle<EditorViewportState>;
  onVisibilityChange: () => void;
};

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

type CursorController = {
  leaf: CursorLeaf | null;
  isVisible: () => boolean;
  markActivity: () => void;
};

// How long the caret stays solid after a keystroke before blinking resumes.
const CARET_IDLE_DELAY_MS = 600;

// Interval between caret visibility toggles once blinking starts.
const CARET_BLINK_INTERVAL_MS = 530;

export function useCursor({
  canShowInsertionLeaf,
  canShowTableLeaf,
  commentState,
  editorState,
  editorViewportState,
  onVisibilityChange,
}: UseCursorOptions): CursorController {
  const normalizedSel = useMemo(
    () => normalizeSelection(editorState),
    [editorState],
  );
  const [leaf, setLeaf] = useState<CursorLeaf | null>(null);
  const shouldBlinkCaret =
    normalizedSel.start.regionId === normalizedSel.end.regionId &&
    normalizedSel.start.offset === normalizedSel.end.offset;
  const cursorVisibleRef = useRef(true);
  const lastActivityAtRef = useRef(0);
  const emitVisibilityChange = useEffectEvent(() => {
    onVisibilityChange();
  });

  const markActivity = useEffectEvent(() => {
    lastActivityAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    cursorVisibleRef.current = true;
    emitVisibilityChange();
  });

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
    normalizedSel.end.offset,
    normalizedSel.end.regionId,
    normalizedSel.start.offset,
    normalizedSel.start.regionId,
  ]);

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

function resolveTableLeaf(
  state: EditorState,
  viewport: EditorViewportState,
): TableLeaf | null {
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
