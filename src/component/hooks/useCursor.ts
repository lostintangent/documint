import type { Editor, PreparedViewport } from "@/editor";
import type { CommentState } from "@/editor/comments";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import { resolveContextualLeaf, type ContextualLeaf } from "../leaves/lib/leaf-target";

type UseCursorOptions = {
  canShowInsertionLeaf: boolean;
  canShowTableLeaf: boolean;
  commentState: CommentState;
  editor: Editor;
  editorState: ReturnType<Editor["createState"]>;
  onVisibilityChange: () => void;
  viewport: PreparedViewport | null;
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

const idleDelayMs = 600;
const blinkIntervalMs = 530;

export function useCursor({
  canShowInsertionLeaf,
  canShowTableLeaf,
  commentState,
  editor,
  editorState,
  onVisibilityChange,
  viewport,
}: UseCursorOptions): CursorController {
  const normalizedSelection = useMemo(
    () => editor.normalizeSelection(editorState),
    [editor, editorState],
  );
  const leaf = useMemo(
    () =>
      resolveCursorLeaf({
        canShowInsertionLeaf,
        canShowTableLeaf,
        commentState,
        editor,
        normalizedSelection,
        state: editorState,
        viewport,
      }),
    [canShowInsertionLeaf, canShowTableLeaf, commentState, editor, editorState, normalizedSelection, viewport],
  );
  const shouldBlinkCaret =
    normalizedSelection.start.regionId === normalizedSelection.end.regionId &&
    normalizedSelection.start.offset === normalizedSelection.end.offset;
  const cursorVisibleRef = useRef(true);
  const lastActivityAtRef = useRef(0);
  const emitVisibilityChange = useEffectEvent(() => {
    onVisibilityChange();
  });

  const markActivity = useEffectEvent(() => {
    lastActivityAtRef.current =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    cursorVisibleRef.current = true;
    emitVisibilityChange();
  });

  useEffect(() => {
    cursorVisibleRef.current = true;
    emitVisibilityChange();

    if (!shouldBlinkCaret || typeof window === "undefined") {
      return;
    }

    const intervalId = window.setInterval(() => {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();

      if (now - lastActivityAtRef.current < idleDelayMs) {
        if (!cursorVisibleRef.current) {
          cursorVisibleRef.current = true;
          emitVisibilityChange();
        }

        return;
      }

      cursorVisibleRef.current = !cursorVisibleRef.current;
      emitVisibilityChange();
    }, blinkIntervalMs);

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
  editor,
  normalizedSelection,
  state,
  viewport,
}: {
  canShowInsertionLeaf: boolean;
  canShowTableLeaf: boolean;
  commentState: CommentState;
  editor: Editor;
  normalizedSelection: ReturnType<Editor["normalizeSelection"]>;
  state: ReturnType<Editor["createState"]>;
  viewport: PreparedViewport | null;
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

  const insertionLeaf = canShowInsertionLeaf
    ? resolveInsertionLeaf(editor, state, viewport)
    : null;

  if (insertionLeaf) {
    return insertionLeaf;
  }

  const tableLeaf = canShowTableLeaf
    ? resolveTableLeaf(editor, state, viewport)
    : null;

  if (tableLeaf) {
    return tableLeaf;
  }

  return resolveContextualLeaf(
    editor.resolveTargetAtSelection(
      state,
      viewport,
      focus,
      commentState.liveRanges,
    ),
    commentState.threads,
  );
}

function resolveTableLeaf(
  editor: Editor,
  state: ReturnType<Editor["createState"]>,
  viewport: PreparedViewport,
): TableLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = state.documentEditor.regionIndex.get(focus.regionId);
  const tableCellPosition = focusedRegion
    ? state.documentEditor.tableCellIndex.get(focusedRegion.id) ?? null
    : null;

  if (!focusedRegion || !tableCellPosition) {
    return null;
  }

  const blockEntry = state.documentEditor.blockIndex.get(focusedRegion.blockId);
  const table =
    blockEntry?.type === "table"
      ? state.documentEditor.document.blocks[blockEntry.rootIndex]
      : null;

  if (!blockEntry || !table || table.type !== "table") {
    return null;
  }

  const caret = editor.measureVisualCaretTarget(state, viewport, focus);
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

function resolveRegionTextLeft(
  viewport: PreparedViewport,
  regionId: string,
) {
  const firstLine = viewport.layout.lines.find((line) => line.regionId === regionId);

  return firstLine ? firstLine.left : null;
}

function resolveInsertionLeaf(
  editor: Editor,
  state: ReturnType<Editor["createState"]>,
  viewport: PreparedViewport,
): InsertionLeaf | null {
  const focus = state.selection.focus;
  const focusedRegion = state.documentEditor.regionIndex.get(focus.regionId);

  if (!focusedRegion || focusedRegion.blockType !== "paragraph" || focusedRegion.text.length > 0) {
    return null;
  }

  if (focus.offset !== 0) {
    return null;
  }

  const blockEntry = state.documentEditor.blockIndex.get(focusedRegion.blockId);

  if (!blockEntry || blockEntry.parentBlockId !== null) {
    return null;
  }

  const caret = editor.measureVisualCaretTarget(state, viewport, focus);

  return caret
    ? {
        kind: "insertion",
        left: caret.left,
        top: caret.top + caret.height,
      }
    : null;
}
