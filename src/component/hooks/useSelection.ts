import type { Mark } from "@/document";
import type { CommentState } from "@/editor/comments";
import type { Editor, EditorSelectionPoint } from "@/editor";
import {
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { resolvePointerPointInScrollContainer } from "../lib/pointer";
import { readSingleContainerSelectionRange } from "../lib/selection";

type SelectionHandlePosition = {
  left: number;
  top: number;
};

type SelectionHandleKind = "start" | "end";

type SelectionHandleProps = {
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
};

type SelectionLeaf =
  | {
      activeMarks: Mark[];
      kind: "create";
      left: number;
      selection: {
        endOffset: number;
        regionId: string;
        startOffset: number;
      };
      top: number;
    }
  | {
      animateInitialComment?: boolean;
      kind: "thread";
      left: number;
      threadIndex: number;
      top: number;
    };

type SelectionCreateLeaf = Extract<SelectionLeaf, { kind: "create" }>;

type UseSelectionOptions = {
  autoScrollContainer: (event: PointerEvent<HTMLDivElement>) => void;
  canShowSelectionLeaf: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  threads: CommentState["threads"];
  editor: Editor;
  editorState: ReturnType<Editor["createState"]>;
  editorStateRef: RefObject<ReturnType<Editor["createState"]> | null>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  getViewportRenderData: () => ReturnType<Editor["prepareViewport"]>;
  onActivity: () => void;
  onEditorStateChange: (stateChange: ReturnType<Editor["setSelection"]>) => void;
};

type SelectionHandles = {
  end: SelectionHandlePosition;
  start: SelectionHandlePosition;
};

type SelectionController = {
  endHandleProps: SelectionHandleProps;
  handles: SelectionHandles | null;
  leaf: SelectionLeaf | null;
  promoteLeafToThread: (threadIndex: number, animateInitialComment?: boolean) => void;
  startHandleProps: SelectionHandleProps;
};

export function useSelection({
  autoScrollContainer,
  canShowSelectionLeaf,
  canvasRef,
  threads,
  editor,
  editorState,
  editorStateRef,
  scrollContainerRef,
  getViewportRenderData,
  onActivity,
  onEditorStateChange,
}: UseSelectionOptions): SelectionController {
  const normalizedSelection = useMemo(
    () => editor.normalizeSelection(editorState),
    [editor, editorState],
  );
  const selectionRange = useMemo(
    () => readSingleContainerSelectionRange(editorState),
    [editorState],
  );
  const activeMarks = useMemo(
    () => editor.getSelectionMarks(editorState),
    [editor, editorState],
  );
  const [handles, setHandles] = useState<SelectionHandles | null>(null);
  const [selectionLeaf, setSelectionLeaf] = useState<SelectionLeaf | null>(null);
  const activeHandleKindRef = useRef<SelectionHandleKind | null>(null);
  const stationarySelectionPointRef = useRef<EditorSelectionPoint | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    setHandles(resolveSelectionHandles(editor, editorState, getViewportRenderData(), normalizedSelection));
  }, [
    editor,
    editorState,
    getViewportRenderData,
    normalizedSelection.end.offset,
    normalizedSelection.end.regionId,
    normalizedSelection.start.offset,
    normalizedSelection.start.regionId,
  ]);

  useEffect(() => {
    const nextLeaf = resolveSelectionLeaf({
      canShowSelectionLeaf,
      currentLeaf: selectionLeaf,
      activeMarks,
      handles,
      selectionRange,
      threads,
    });

    if (
      nextLeaf?.kind === "create" &&
      isSameSelectionCreateLeaf(selectionLeaf, nextLeaf)
    ) {
      return;
    }

    setSelectionLeaf(nextLeaf);
  }, [activeMarks, canShowSelectionLeaf, handles, selectionLeaf, selectionRange, threads]);

  const promoteLeafToThread = useEffectEvent((threadIndex: number, animateInitialComment = true) => {
    setSelectionLeaf((currentLeaf) =>
      currentLeaf?.kind === "create"
        ? {
            animateInitialComment,
            kind: "thread",
            left: currentLeaf.left,
            threadIndex,
            top: currentLeaf.top,
          }
        : currentLeaf,
    );
  });

  const clearDrag = useEffectEvent((event?: PointerEvent<HTMLDivElement>) => {
    if (
      event &&
      dragPointerIdRef.current === event.pointerId &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    activeHandleKindRef.current = null;
    stationarySelectionPointRef.current = null;
    dragPointerIdRef.current = null;
  });

  const updateSelectionFromHandle = useEffectEvent((event: PointerEvent<HTMLDivElement>) => {
    const scrollContainer = scrollContainerRef.current;
    const currentState = editorStateRef.current;
    const stationarySelectionPoint = stationarySelectionPointRef.current;

    if (
      !scrollContainer ||
      !currentState ||
      !stationarySelectionPoint ||
      dragPointerIdRef.current !== event.pointerId
    ) {
      return;
    }

    const point = resolvePointerPointInScrollContainer(event, scrollContainer);
    const nextFocus = editor.resolveDragFocus(
      currentState,
      getViewportRenderData(),
      point,
      stationarySelectionPoint,
    );

    if (!nextFocus) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onActivity();
    autoScrollContainer(event);
    onEditorStateChange(
      editor.setSelection(currentState, {
        anchor: stationarySelectionPoint,
        focus: nextFocus,
      }),
    );
  });

  const createHandleProps = (kind: SelectionHandleKind): SelectionHandleProps => ({
    onPointerCancel: (event) => {
      clearDrag(event);
    },
    onPointerDown: (event) => {
      const currentState = editorStateRef.current ?? editorState;
      const stationarySelectionPoint = resolveStationarySelectionPoint(normalizedSelection, kind);
      const draggedSelectionPoint =
        kind === "start" ? normalizedSelection.start : normalizedSelection.end;

      if (!handles) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragPointerIdRef.current = event.pointerId;
      stationarySelectionPointRef.current = stationarySelectionPoint;
      activeHandleKindRef.current = kind;
      event.currentTarget.setPointerCapture(event.pointerId);
      onActivity();
      canvasRef.current?.focus({
        preventScroll: true,
      });
      onEditorStateChange(
        editor.setSelection(currentState, {
          anchor: stationarySelectionPoint,
          focus: draggedSelectionPoint,
        }),
      );
    },
    onPointerMove: (event) => {
      if (activeHandleKindRef.current !== kind) {
        return;
      }

      updateSelectionFromHandle(event);
    },
    onPointerUp: (event) => {
      if (activeHandleKindRef.current === kind) {
        updateSelectionFromHandle(event);
      }

      clearDrag(event);
    },
  });

  return {
    endHandleProps: createHandleProps("end"),
    handles,
    leaf: selectionLeaf,
    promoteLeafToThread,
    startHandleProps: createHandleProps("start"),
  };
}

function resolveSelectionHandles(
  editor: Editor,
  state: ReturnType<Editor["createState"]>,
  viewport: ReturnType<Editor["prepareViewport"]>,
  selection: ReturnType<Editor["normalizeSelection"]>,
): SelectionHandles | null {
  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset === selection.end.offset
  ) {
    return null;
  }

  const startCaret = editor.measureVisualCaretTarget(state, viewport, selection.start);
  const endCaret = editor.measureVisualCaretTarget(state, viewport, selection.end);

  if (!startCaret || !endCaret) {
    return null;
  }

  return {
    end: {
      left: endCaret.left,
      top: endCaret.top + endCaret.height,
    },
    start: {
      left: startCaret.left,
      top: startCaret.top,
    },
  };
}

function resolveSelectionCreateLeaf(
  selection: {
    endOffset: number;
    regionId: string;
    startOffset: number;
  },
  handles: SelectionHandles,
  activeMarks: Mark[],
): SelectionCreateLeaf {
  return {
    activeMarks,
    kind: "create",
    left: handles.start.left,
    selection,
    top: handles.end.top,
  };
}

function resolveSelectionLeaf({
  activeMarks,
  canShowSelectionLeaf,
  currentLeaf,
  handles,
  selectionRange,
  threads,
}: {
  activeMarks: Mark[];
  canShowSelectionLeaf: boolean;
  currentLeaf: SelectionLeaf | null;
  handles: SelectionHandles | null;
  selectionRange: {
    endOffset: number;
    regionId: string;
    startOffset: number;
  } | null;
  threads: CommentState["threads"];
}): SelectionLeaf | null {
  if (!canShowSelectionLeaf || !selectionRange || !handles) {
    return null;
  }

  if (currentLeaf?.kind === "thread") {
    return threads[currentLeaf.threadIndex] ? currentLeaf : null;
  }

  return resolveSelectionCreateLeaf(selectionRange, handles, activeMarks);
}

function isSameSelectionCreateLeaf(
  currentLeaf: SelectionLeaf | null,
  nextLeaf: SelectionCreateLeaf,
) {
  return (
    currentLeaf?.kind === "create" &&
    currentLeaf.left === nextLeaf.left &&
    currentLeaf.selection.regionId === nextLeaf.selection.regionId &&
    currentLeaf.selection.startOffset === nextLeaf.selection.startOffset &&
    currentLeaf.selection.endOffset === nextLeaf.selection.endOffset &&
    areSameMarks(currentLeaf.activeMarks, nextLeaf.activeMarks) &&
    currentLeaf.top === nextLeaf.top
  );
}

function areSameMarks(currentMarks: Mark[], nextMarks: Mark[]) {
  return (
    currentMarks.length === nextMarks.length &&
    currentMarks.every((mark, index) => mark === nextMarks[index])
  );
}

function resolveStationarySelectionPoint(
  selection: ReturnType<Editor["normalizeSelection"]>,
  handleKind: SelectionHandleKind,
) {
  return handleKind === "start" ? selection.end : selection.start;
}
