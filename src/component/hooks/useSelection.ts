import type { Mark } from "@/document";
import {
  getSelectionMarks,
  measureVisualCaretTarget,
  normalizeSelection,
  resolveDragFocus,
  setSelection,
  type EditorCommentState,
  type EditorPoint,
  type EditorSelectionPoint,
  type EditorState,
  type EditorLayoutState,
  type NormalizedEditorSelection,
} from "@/editor";
import type { LazyRefHandle } from "./useLazyRef";
import {
  type HTMLAttributes,
  type PointerEvent,
  type RefObject,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readSingleContainerSelectionRange } from "../lib/selection";
import type { FocusInput } from "./useInput";

export type ResizeHandle = {
  start: { left: number; top: number; props: HTMLAttributes<HTMLDivElement> };
  end: { left: number; top: number; props: HTMLAttributes<HTMLDivElement> };
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
  // Editor state and lookups the hook reads from.
  canShowSelectionLeaf: boolean;
  editorState: EditorState;
  editorStateRef: RefObject<EditorState | null>;
  editorViewportState: LazyRefHandle<EditorLayoutState>;
  resolvePoint: (event: PointerEvent<HTMLElement>) => EditorPoint | null;
  threads: EditorCommentState["threads"];

  // Host callbacks the hook invokes.
  applyNextState: (nextState: EditorState) => void;
  autoScrollDuringDrag: (event: PointerEvent<HTMLElement>) => void;
  focusInput: FocusInput;
  onActivity: () => void;
};

type SelectionHandles = {
  end: { left: number; top: number };
  start: { left: number; top: number };
};

type SelectionController = {
  handle: ResizeHandle | null;
  leaf: SelectionLeaf | null;
  promoteLeafToThread: (threadIndex: number, animateInitialComment?: boolean) => void;
};

/**
 * Owns the selection-related UI affordances that live outside the canvas:
 * the start/end drag handles (touch UI for extending a range) and the
 * selection leaf (the comment-creation popover that anchors to a range).
 *
 * What this hook owns:
 *   - Pixel positions for the start/end selection handles, recomputed when
 *     selection or viewport changes.
 *   - The selection leaf state (create-comment vs. thread), including
 *     promotion when the host posts a new thread.
 *   - The handle drag gesture — pointer capture, hit testing via
 *     `resolvePoint`, autoscroll past the canvas edge during drag, and
 *     selection extension.
 *
 * Contract with the host:
 *   - The host renders `<div>`s for the start and end handles, spreading
 *     `startHandleProps` / `endHandleProps` onto each, and positions them
 *     using the pixel coordinates in `handles`.
 *   - The host renders the selection `leaf` as a contextual overlay,
 *     calling `promoteLeafToThread(threadIndex)` once a comment is posted.
 *   - The host wires `resolvePoint` and `autoScrollDuringDrag` from
 *     `useViewport`, and `focusInput` from `useInput`.
 *   - The host does not own any handle-drag state — it lives entirely here.
 */
export function useSelection({
  applyNextState,
  autoScrollDuringDrag,
  canShowSelectionLeaf,
  editorState,
  editorStateRef,
  editorViewportState,
  focusInput,
  onActivity,
  resolvePoint,
  threads,
}: UseSelectionOptions): SelectionController {
  /* Derived selection state */

  const normalizedSel = useMemo(() => normalizeSelection(editorState), [editorState]);
  const selectionRange = useMemo(
    () => readSingleContainerSelectionRange(editorState),
    [editorState],
  );
  const activeMarks = useMemo(() => getSelectionMarks(editorState), [editorState]);

  /* Internal state */

  const [rawHandles, setRawHandles] = useState<SelectionHandles | null>(null);
  const [selectionLeaf, setSelectionLeaf] = useState<SelectionLeaf | null>(null);
  const activeHandleKindRef = useRef<SelectionHandleKind | null>(null);
  const stationarySelectionPointRef = useRef<EditorSelectionPoint | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);

  /* Layout: keep handles + leaf positioned in sync with selection */

  useLayoutEffect(() => {
    const nextHandles = resolveSelectionHandles(
      editorState,
      editorViewportState.get(),
      normalizedSel,
    );

    setRawHandles((previous) =>
      areSelectionHandlesEqual(previous, nextHandles) ? previous : nextHandles,
    );
  }, [
    editorState,
    editorViewportState,
    normalizedSel.end.offset,
    normalizedSel.end.regionId,
    normalizedSel.start.offset,
    normalizedSel.start.regionId,
  ]);

  useLayoutEffect(() => {
    const nextLeaf = resolveSelectionLeaf({
      canShowSelectionLeaf,
      currentLeaf: selectionLeaf,
      activeMarks,
      handles: rawHandles,
      selectionRange,
      threads,
    });

    setSelectionLeaf((previous) =>
      areSelectionLeavesEqual(previous, nextLeaf) ? previous : nextLeaf,
    );
  }, [activeMarks, canShowSelectionLeaf, rawHandles, selectionLeaf, selectionRange, threads]);

  const promoteLeafToThread = useEffectEvent(
    (threadIndex: number, animateInitialComment = true) => {
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
    },
  );

  /* Handle drag */

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
    const currentState = editorStateRef.current;
    const stationarySelectionPoint = stationarySelectionPointRef.current;
    const point = resolvePoint(event);

    if (
      !point ||
      !currentState ||
      !stationarySelectionPoint ||
      dragPointerIdRef.current !== event.pointerId
    ) {
      return;
    }

    const nextFocus = resolveDragFocus(
      currentState,
      editorViewportState.get(),
      point,
      stationarySelectionPoint,
    );

    if (!nextFocus) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onActivity();
    autoScrollDuringDrag(event);
    applyNextState(
      setSelection(currentState, {
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
      const stationarySelectionPoint = resolveStationarySelectionPoint(normalizedSel, kind);
      const draggedSelectionPoint = kind === "start" ? normalizedSel.start : normalizedSel.end;

      if (!rawHandles) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      dragPointerIdRef.current = event.pointerId;
      stationarySelectionPointRef.current = stationarySelectionPoint;
      activeHandleKindRef.current = kind;
      event.currentTarget.setPointerCapture(event.pointerId);
      onActivity();
      // Refocus the input bridge so the iOS keyboard stays visible while
      // the user drags the handle — without this, focus drifts to the
      // handle's host element and the keyboard dismisses mid-gesture.
      focusInput();
      applyNextState(
        setSelection(currentState, {
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

  /* Public API */

  const handle: ResizeHandle | null = rawHandles
    ? {
        start: { ...rawHandles.start, props: createHandleProps("start") },
        end: { ...rawHandles.end, props: createHandleProps("end") },
      }
    : null;

  return {
    handle,
    leaf: selectionLeaf,
    promoteLeafToThread,
  };
}

function resolveSelectionHandles(
  state: EditorState,
  viewport: EditorLayoutState,
  selection: NormalizedEditorSelection,
): SelectionHandles | null {
  if (selection.collapsed) {
    return null;
  }

  const startCaret = measureVisualCaretTarget(state, viewport, selection.start);
  const endCaret = measureVisualCaretTarget(state, viewport, selection.end);

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
  threads: EditorCommentState["threads"];
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

function areSelectionLeavesEqual(previous: SelectionLeaf | null, next: SelectionLeaf | null) {
  if (previous === next) {
    return true;
  }

  if (!previous || !next || previous.kind !== next.kind) {
    return false;
  }

  if (previous.kind === "create" && next.kind === "create") {
    return isSameSelectionCreateLeaf(previous, next);
  }

  return (
    previous.kind === "thread" &&
    next.kind === "thread" &&
    previous.animateInitialComment === next.animateInitialComment &&
    previous.left === next.left &&
    previous.threadIndex === next.threadIndex &&
    previous.top === next.top
  );
}

function areSelectionHandlesEqual(
  previous: SelectionHandles | null,
  next: SelectionHandles | null,
) {
  if (previous === next) {
    return true;
  }

  if (!previous || !next) {
    return false;
  }

  return (
    previous.start.left === next.start.left &&
    previous.start.top === next.start.top &&
    previous.end.left === next.end.left &&
    previous.end.top === next.end.top
  );
}

function areSameMarks(currentMarks: Mark[], nextMarks: Mark[]) {
  return (
    currentMarks.length === nextMarks.length &&
    currentMarks.every((mark, index) => mark === nextMarks[index])
  );
}

function resolveStationarySelectionPoint(
  selection: NormalizedEditorSelection,
  handleKind: SelectionHandleKind,
) {
  return handleKind === "start" ? selection.end : selection.start;
}
