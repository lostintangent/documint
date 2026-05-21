import {
  setSelection,
  type EditorPoint,
  type EditorSelectionPoint,
  type NormalizedEditorSelection,
  updateSelectionFromDrag,
} from "@/editor";
import { type HTMLAttributes, type PointerEvent, useEffectEvent, useRef, useState } from "react";
import { selectionViewSprig, useEditorCommand, useSprig } from "../store";
import {
  selectionLeafSprig,
  type PromotedSelectionThread,
  type SelectionLeaf,
} from "../overlays/leaves/sprigs";
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

/**
 * Owns the selection-related UI affordances that live outside the canvas:
 * the start/end drag handles (touch UI for extending a range) and the
 * selection leaf (the comment-creation popover that anchors to a range).
 *
 * What this hook owns:
 *   - React handle props for the store-derived start/end selection handles.
 *   - The promoted-thread marker created when the host posts a new thread.
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
  autoScrollDuringDrag,
  isEditable,
  focusInput,
  onActivity,
  resolvePoint,
}: UseSelectionOptions): SelectionController {
  /* Derived selection state */

  const [promotedThread, setPromotedThread] = useState<PromotedSelectionThread | null>(null);
  const selection = useSprig(selectionViewSprig);
  const selectionLeaf = useSprig(selectionLeafSprig, promotedThread);
  const setEditorSelection = useEditorCommand(setSelection);
  const dragSelectionHandle = useEditorCommand(updateSelectionFromDrag);

  /* Internal state */

  const activeHandleKindRef = useRef<SelectionHandleKind | null>(null);
  const stationarySelectionPointRef = useRef<EditorSelectionPoint | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);

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

    if (
      !point ||
      !stationarySelectionPoint ||
      dragPointerIdRef.current !== event.pointerId ||
      !selection.layout
    ) {
      return;
    }

    const transition = dragSelectionHandle(selection.layout, point, stationarySelectionPoint);

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
      const stationarySelectionPoint = resolveStationarySelectionPoint(selection.normalized, kind);
      const draggedSelectionPoint =
        kind === "start" ? selection.normalized.start : selection.normalized.end;

      if (!selection.handles) {
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

  const handle: ResizeHandle | null = selection.handles
    ? {
        start: { ...selection.handles.start, props: createHandleProps("start") },
        end: { ...selection.handles.end, props: createHandleProps("end") },
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
