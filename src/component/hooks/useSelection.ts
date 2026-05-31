import {
  setSelection,
  type EditorPoint,
  type EditorSelectionPoint,
  type NormalizedEditorSelection,
  updateSelectionFromDrag,
} from "@/editor";
import { type PointerEvent, useEffectEvent, useRef, useState } from "react";
import {
  normalizedSelectionSprig,
  selectionHandlesSprig,
  useDocumintStore,
  useEditorCommand,
  useSprig,
} from "../store";
import {
  selectionLeafSprig,
  type PromotedSelectionThread,
  type SelectionLeaf,
} from "../overlays/leaves/sprigs";
import type { ResizeHandle } from "../Documint";
import type { FocusInput } from "./useInput";

type SelectionHandleKind = "start" | "end";

type SelectionHandleProps = {
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
};

type UseSelectionOptions = {
  isEditable: boolean;
  resolvePoint: (event: PointerEvent<HTMLElement>) => EditorPoint | null;

  // Host callbacks the hook invokes.
  autoScrollDuringDrag: (event: PointerEvent<HTMLElement>) => void;
  focusInput: FocusInput;
  onActivity: () => void;
};

type SelectionController = {
  handle: ResizeHandle | null;
  leaf: SelectionLeaf | null;
  promoteLeafToThread: (threadIndex: number, animateInitialComment?: boolean) => void;
};

export function useSelection({
  autoScrollDuringDrag,
  isEditable,
  focusInput,
  onActivity,
  resolvePoint,
}: UseSelectionOptions): SelectionController {
  /* Derived selection state */

  const store = useDocumintStore();
  const normalizedSelection = useSprig(normalizedSelectionSprig);
  const selectionHandles = useSprig(selectionHandlesSprig);
  const setEditorSelection = useEditorCommand(setSelection);
  const dragSelectionHandle = useEditorCommand(updateSelectionFromDrag);

  /* Selection leaf */

  const [promotedThread, setPromotedThread] = useState<PromotedSelectionThread | null>(null);
  const selectionLeaf = useSprig(selectionLeafSprig, promotedThread);

  const promoteLeafToThread = useEffectEvent(
    (threadIndex: number, animateInitialComment = true) => {
      if (selectionLeaf?.kind !== "annotation") {
        return;
      }

      setPromotedThread({
        anchor: selectionLeaf.anchor,
        animateInitialComment,
        leftOverride: selectionLeaf.leftOverride,
        paddingY: selectionLeaf.paddingY,
        selection: selectionLeaf.selection,
        threadIndex,
      });
    },
  );

  /* Handle drag */

  const activeHandleKindRef = useRef<SelectionHandleKind | null>(null);
  const stationarySelectionPointRef = useRef<EditorSelectionPoint | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);

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
    const stationarySelectionPoint = stationarySelectionPointRef.current;
    const point = resolvePoint(event);
    const layout = store.layout.peekRendered();

    if (
      !point ||
      !stationarySelectionPoint ||
      dragPointerIdRef.current !== event.pointerId ||
      !layout
    ) {
      return;
    }

    const transition = dragSelectionHandle(layout, point, stationarySelectionPoint);

    if (!transition) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onActivity();
    autoScrollDuringDrag(event);
  });

  const createHandleProps = (kind: SelectionHandleKind): SelectionHandleProps => ({
    onPointerCancel: (event) => {
      clearDrag(event);
    },
    onPointerDown: (event) => {
      const stationarySelectionPoint = resolveStationarySelectionPoint(normalizedSelection, kind);
      const draggedSelectionPoint =
        kind === "start" ? normalizedSelection.start : normalizedSelection.end;

      if (!selectionHandles) {
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
      setEditorSelection({
        anchor: stationarySelectionPoint,
        focus: draggedSelectionPoint,
      });
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

  const handle: ResizeHandle | null = selectionHandles
    ? {
        start: { ...selectionHandles.start, props: createHandleProps("start") },
        end: { ...selectionHandles.end, props: createHandleProps("end") },
      }
    : null;

  return {
    handle,
    leaf: isEditable ? selectionLeaf : null,
    promoteLeafToThread,
  };
}

function resolveStationarySelectionPoint(
  selection: NormalizedEditorSelection,
  handleKind: SelectionHandleKind,
) {
  return handleKind === "start" ? selection.end : selection.start;
}
