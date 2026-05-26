import {
  dedent,
  extendSelectionToPoint,
  indent,
  resolveHoverTarget as resolveEditorHoverTarget,
  resolveWordSelection,
  setSelectionAtPoint,
  setSelection,
  toggleTask,
  updateSelectionFromDrag,
  type EditorHoverTarget,
  type EditorSelectionPoint,
} from "@/editor";
import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import type { FocusInput } from "./useInput";
import type { DocumentStorage } from "../lib/storage";
import {
  commentRangesSprig,
  editorStateSprig,
  useDocumintStore,
  useEditorCommand,
  useSprig,
} from "../store";
import { pointerViewSprig, type PointerLeaf } from "../overlays/leaves/sprigs";

type UsePointerOptions = {
  // DOM refs the hook reads from.
  canvasRef: RefObject<HTMLCanvasElement | null>;

  // Browser coordinate translation owned by useViewport.
  resolvePoint: (
    event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>,
  ) => { x: number; y: number } | null;

  // Host callbacks the hook invokes.
  autoScrollDuringDrag: (event: PointerEvent<HTMLElement>) => void;
  focusInput: FocusInput;
  isEditable: boolean;
  onActivity: () => void;
  storage: DocumentStorage;
};

type CanvasPointerEvent = PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>;
type CanvasPoint = { x: number; y: number };

type CanvasPointerHandlers = {
  onClick: (event: MouseEvent<HTMLCanvasElement>) => void;
  onDoubleClick: (event: MouseEvent<HTMLCanvasElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerLeave: () => void;
  onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => void;
};

type LeafHoverHandlers = {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
};

type PointerController = {
  canvasHandlers: CanvasPointerHandlers;
  cursor: "pointer" | "text";
  leaf: PointerLeaf | null;
  leafHandlers: LeafHoverHandlers;
};

// Short delay before hiding a hover leaf when the pointer leaves, giving the
// user time to move into the leaf itself without it flickering away.
const HOVER_HIDE_DELAY_MS = 48;
const MIN_HORIZONTAL_SWIPE_PX = 44;
const MAX_HORIZONTAL_SWIPE_VERTICAL_PX = 32;
const HORIZONTAL_SWIPE_RATIO = 1.6;
const MAX_HORIZONTAL_SWIPE_DURATION_MS = 600;
const SUPPRESSED_TOUCH_CLICK_DISTANCE_PX = 24;
const SUPPRESSED_TOUCH_CLICK_DURATION_MS = 500;

type TouchSwipe = {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  swiping: boolean;
};

type SuppressedTouchClick = {
  expiresAt: number;
  x: number;
  y: number;
};

type SwipePoint = {
  x: number;
  y: number;
  time: number;
};

export function resolveHorizontalSwipeDirection(
  start: SwipePoint,
  end: SwipePoint,
): "left" | "right" | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const elapsed = end.time - start.time;

  if (
    absX < MIN_HORIZONTAL_SWIPE_PX ||
    absY > MAX_HORIZONTAL_SWIPE_VERTICAL_PX ||
    absX < absY * HORIZONTAL_SWIPE_RATIO ||
    elapsed > MAX_HORIZONTAL_SWIPE_DURATION_MS
  ) {
    return null;
  }

  return dx < 0 ? "left" : "right";
}

/**
 * Owns all canvas pointer/click/dblclick interactions and hover state for
 * the editor.
 *
 * What this hook owns:
 *   - Hover state — which target is under the pointer and hide-on-leave
 *     timing. The resolved leaf/cursor view model is store-derived.
 *   - Drag-to-select on mouse/pen — anchor tracking, pointer capture, and
 *     autoscroll past the canvas edge.
 *   - Tap-to-place-caret on touch — deferred to `click` so the browser's
 *     native scroll-vs-tap disambiguation runs first.
 *   - Task toggles, double-click word selection, and Cmd/Ctrl-click link
 *     activation.
 *
 * Contract with the host:
 *   - The host provides DOM refs, coordinate translation, focus/activity
 *     callbacks, and storage for link activation.
 *   - The host spreads `canvasHandlers` onto the canvas, reads `cursor` for
 *     its style, and renders `leaf` with `leafHandlers` for contextual UI.
 *   - The host knows nothing about pointer types, drag anchors, hit testing,
 *     or gesture disambiguation — those live entirely in this hook.
 */
export function usePointer({
  autoScrollDuringDrag,
  canvasRef,
  focusInput,
  isEditable,
  onActivity,
  resolvePoint,
  storage,
}: UsePointerOptions): PointerController {
  /* Internal state */

  const store = useDocumintStore();
  const editorState = useSprig(editorStateSprig);
  const commentRanges = useSprig(commentRangesSprig);
  const setEditorSelection = useEditorCommand(setSelection);
  const setEditorSelectionAtPoint = useEditorCommand(setSelectionAtPoint);
  const extendEditorSelectionToPoint = useEditorCommand(extendSelectionToPoint);
  const indentCommand = useEditorCommand(indent);
  const dedentCommand = useEditorCommand(dedent);
  const toggleTaskItem = useEditorCommand(toggleTask);
  const dragEditorSelection = useEditorCommand(updateSelectionFromDrag);
  const [hoverTarget, setHoverTarget] = useState<EditorHoverTarget | null>(null);
  const { cursor, leaf } = useSprig(pointerViewSprig, hoverTarget);
  const hideTimeoutRef = useRef<number | null>(null);
  const isLeafHoveredRef = useRef(false);
  // Drag-to-select uses pointer capture; `lastPointerTypeRef` lets `click`
  // distinguish a touch tap (where pointerdown deferred) from a mouse/pen
  // click (where pointerdown already placed the caret).
  const dragPointerIdRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<EditorSelectionPoint | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);
  const touchSwipeRef = useRef<TouchSwipe | null>(null);
  const activeTouchPointerIdsRef = useRef<Set<number>>(new Set());
  const suppressedTouchClickRef = useRef<SuppressedTouchClick | null>(null);

  /* Hover lifecycle */

  // If the comment thread under the pointer disappears (e.g. resolved by
  // another user), the hover target is no longer meaningful — drop it.
  useEffect(() => {
    if (hoverTarget && hoverTarget.kind !== "task-toggle" && !leaf) {
      setHoverTarget(null);
    }
  }, [hoverTarget, leaf]);

  // Cancel any in-flight hide on unmount so we don't call setState on a
  // torn-down hook.
  useEffect(
    () => () => {
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    },
    [],
  );

  const cancelHide = useEffectEvent(() => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  });

  const scheduleHide = useEffectEvent(() => {
    cancelHide();
    hideTimeoutRef.current = window.setTimeout(() => {
      hideTimeoutRef.current = null;
      if (!isLeafHoveredRef.current) {
        setHoverTarget(null);
      }
    }, HOVER_HIDE_DELAY_MS);
  });

  const clearLeafIfPointerIsOutsideLeaf = useEffectEvent(() => {
    if (!isLeafHoveredRef.current) {
      cancelHide();
      setHoverTarget(null);
    }
  });

  const applyHoverTarget = useEffectEvent((target: EditorHoverTarget | null) => {
    if (!target) {
      clearLeafIfPointerIsOutsideLeaf();
      return;
    }

    if (target.kind === "task-toggle") {
      cancelHide();
      setHoverTarget((previous) =>
        previous?.kind === "task-toggle" && previous.listItemId === target.listItemId
          ? previous
          : target,
      );
      return;
    }

    if (target.commentThreadIndex !== null) {
      cancelHide();
      const threadIndex = target.commentThreadIndex;
      setHoverTarget((previous) =>
        previous?.kind !== "task-toggle" && previous?.commentThreadIndex === threadIndex
          ? previous
          : target,
      );
      return;
    }

    if (target.kind !== "link") {
      clearLeafIfPointerIsOutsideLeaf();
      return;
    }

    cancelHide();
    setHoverTarget((previous) =>
      previous?.kind === "link" &&
      previous.title === target.title &&
      previous.url === target.url &&
      previous.startOffset === target.startOffset &&
      previous.endOffset === target.endOffset
        ? previous
        : target,
    );
  });

  /* Hit testing */

  const resolveHoverTargetAtPoint = useEffectEvent((point: CanvasPoint) =>
    resolveEditorHoverTarget(editorState, store.layout.get(), point, commentRanges),
  );

  const resolveHoverTarget = useEffectEvent((event: CanvasPointerEvent) => {
    const point = resolvePoint(event);
    return point ? resolveHoverTargetAtPoint(point) : null;
  });

  /* Pointer-capture helpers */

  const releaseCanvasPointer = useEffectEvent((pointerId: number) => {
    const canvas = canvasRef.current;
    if (canvas && dragPointerIdRef.current === pointerId) {
      canvas.releasePointerCapture(pointerId);
    }
  });

  const clearCanvasDrag = useEffectEvent(() => {
    dragPointerIdRef.current = null;
    dragAnchorRef.current = null;
  });

  const clearTouchSwipe = useEffectEvent(() => {
    touchSwipeRef.current = null;
  });

  const suppressTouchClick = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    suppressedTouchClickRef.current = {
      expiresAt: event.timeStamp + SUPPRESSED_TOUCH_CLICK_DURATION_MS,
      x: event.clientX,
      y: event.clientY,
    };
  });

  const forgetTouchPointer = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch") {
      activeTouchPointerIdsRef.current.delete(event.pointerId);
    }
  });

  // pointerup and pointercancel collapse to the same response: release the
  // captured pointer and clear drag state. The browser fires pointercancel
  // when it preempts the gesture (e.g. native scroll on touch) and pointerup
  // on a clean release — both end the drag.
  const endPointerGesture = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    releaseCanvasPointer(event.pointerId);
    clearCanvasDrag();
    clearTouchSwipe();
    forgetTouchPointer(event);
  });

  /* Canvas event handlers */

  const handlePointerDown = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    lastPointerTypeRef.current = event.pointerType;

    // Touch defers everything to the synthesized `click` event so the browser
    // can disambiguate tap-vs-scroll first. Acting on `pointerdown` here would
    // capture the pointer and suppress native scrolling, and would open the
    // virtual keyboard at the start of every scroll gesture. Task toggles,
    // caret placement, and focus all fire from `handleClick` instead.
    if (event.pointerType === "touch") {
      activeTouchPointerIdsRef.current.add(event.pointerId);
      if (activeTouchPointerIdsRef.current.size > 1) {
        clearTouchSwipe();
      } else if (isEditable && event.isPrimary) {
        touchSwipeRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startedAt: event.timeStamp,
          swiping: false,
        };
      }
      return;
    }

    const canvas = canvasRef.current;
    const layout = store.layout.get();
    const point = resolvePoint(event);
    if (!point) return;

    const target = resolveHoverTarget(event);

    // Task toggles are handled in `click` for both mouse and touch — early
    // return here so we don't drop a caret next to the checkbox before the
    // toggle fires.
    if (target?.kind === "task-toggle") {
      return;
    }

    if (!canvas) return;

    const transition = event.shiftKey
      ? extendEditorSelectionToPoint(layout, point)
      : setEditorSelectionAtPoint(layout, point);
    if (!transition) return;

    const focus = transition.next.selection.focus;

    dragPointerIdRef.current = event.pointerId;
    dragAnchorRef.current = event.shiftKey ? transition.previous.selection.anchor : focus;
    onActivity();
    canvas.setPointerCapture(event.pointerId);

    // Pass the tapped caret to `focus` so it positions the hidden textarea
    // synchronously before invoking the native `focus()`. Without this, the
    // textarea's position only updates on the next React render via the
    // layout effect — which is too late for iOS's scroll-to-focused-input
    // decision, leaving the caret hidden behind the virtual keyboard.
    focusInput(focus);
  });

  const handlePointerMove = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    const touchSwipe = touchSwipeRef.current;
    if (event.pointerType === "touch" && touchSwipe?.pointerId === event.pointerId) {
      const dx = event.clientX - touchSwipe.startX;
      const dy = event.clientY - touchSwipe.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (
        absX >= MIN_HORIZONTAL_SWIPE_PX &&
        absY <= MAX_HORIZONTAL_SWIPE_VERTICAL_PX &&
        absX >= absY * HORIZONTAL_SWIPE_RATIO
      ) {
        touchSwipe.swiping = true;
        event.preventDefault();
      }
      return;
    }

    const anchor = dragAnchorRef.current;
    const point = resolvePoint(event);
    if (!point) return;

    // Hover updates are meaningless during a drag-select — the user is
    // extending a range, not interacting with hover targets. Skipping the
    // hit test here also prevents stray hover leaves (links, comment
    // threads, task toggles) from appearing as the pointer drags over
    // them mid-selection.
    if (dragPointerIdRef.current !== event.pointerId || !anchor) {
      applyHoverTarget(resolveHoverTargetAtPoint(point));
      return;
    }

    const transition = dragEditorSelection(store.layout.get(), point, anchor);
    if (!transition) return;

    onActivity();
    autoScrollDuringDrag(event);
  });

  const handlePointerLeave = useEffectEvent(() => {
    if (!isLeafHoveredRef.current) {
      scheduleHide();
    }
  });

  const handlePointerUp = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    const touchSwipe = touchSwipeRef.current;

    if (event.pointerType === "touch" && touchSwipe?.pointerId === event.pointerId) {
      const direction =
        activeTouchPointerIdsRef.current.size === 1
          ? resolveHorizontalSwipeDirection(
              {
                time: touchSwipe.startedAt,
                x: touchSwipe.startX,
                y: touchSwipe.startY,
              },
              {
                time: event.timeStamp,
                x: event.clientX,
                y: event.clientY,
              },
            )
          : null;

      if (direction) {
        event.preventDefault();
        suppressTouchClick(event);
        if (direction === "right") {
          indentCommand();
        } else {
          dedentCommand();
        }
      } else if (touchSwipe.swiping) {
        suppressTouchClick(event);
      }
    }

    endPointerGesture(event);
  });

  const handleClick = useEffectEvent((event: MouseEvent<HTMLCanvasElement>) => {
    const suppressedTouchClick = suppressedTouchClickRef.current;

    if (suppressedTouchClick) {
      const dx = event.clientX - suppressedTouchClick.x;
      const dy = event.clientY - suppressedTouchClick.y;
      const isSuppressedClick =
        event.timeStamp <= suppressedTouchClick.expiresAt &&
        Math.hypot(dx, dy) <= SUPPRESSED_TOUCH_CLICK_DISTANCE_PX;

      suppressedTouchClickRef.current = null;

      if (isSuppressedClick) {
        lastPointerTypeRef.current = null;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const wasTouchTap = lastPointerTypeRef.current === "touch";
    lastPointerTypeRef.current = null;

    // Task toggles fire from `click` for all input types — `click` is the
    // browser's already-disambiguated activation event, so we don't need to
    // hand-roll tap-vs-drag detection.
    const target = resolveHoverTarget(event);

    if (target?.kind === "task-toggle") {
      const transition = toggleTaskItem(target.listItemId);
      if (transition) {
        event.preventDefault();
        event.stopPropagation();
        onActivity();
      }
      return;
    }

    // Cmd/Ctrl-click on a link opens it; a plain click falls through to
    // caret placement so users can edit link text normally.
    if (target?.kind === "link" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      storage.openFile(target.url);
      return;
    }

    // Mouse/pen already placed the caret and focused during pointerdown;
    // re-running setSelection here would clobber any drag-selected range
    // (the synthesized click fires at the end of every drag).
    if (!wasTouchTap) {
      focusInput();
      return;
    }

    // Touch path: pointerdown deferred to here. Resolve the hit and place
    // the caret now, after the browser has confirmed this was a tap and
    // not a scroll/swipe/long-press.
    const point = resolvePoint(event);

    if (point) {
      const transition = setEditorSelectionAtPoint(store.layout.get(), point);
      if (!transition) {
        focusInput();
        return;
      }

      onActivity();
      focusInput(transition.next.selection.focus);
    } else {
      focusInput();
    }
  });

  const handleDoubleClick = useEffectEvent((event: MouseEvent<HTMLCanvasElement>) => {
    const currentState = store.editor.getState();
    const point = resolvePoint(event);
    const target = resolveHoverTarget(event);

    if (!point || target?.kind === "task-toggle") return;

    const wordSel = resolveWordSelection(currentState, store.layout.get(), point);
    if (!wordSel) return;

    event.preventDefault();
    event.stopPropagation();
    onActivity();
    setEditorSelection(wordSel);
    focusInput();
  });

  /* Leaf overlay handlers */

  const handleLeafPointerEnter = useEffectEvent(() => {
    isLeafHoveredRef.current = true;
    cancelHide();
  });

  const handleLeafPointerLeave = useEffectEvent(() => {
    isLeafHoveredRef.current = false;
    scheduleHide();
  });

  /* Public API */

  return {
    canvasHandlers: {
      onClick: handleClick,
      onDoubleClick: handleDoubleClick,
      onPointerCancel: endPointerGesture,
      onPointerDown: handlePointerDown,
      onPointerLeave: handlePointerLeave,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
    },
    cursor,
    leaf,
    leafHandlers: {
      onPointerEnter: handleLeafPointerEnter,
      onPointerLeave: handleLeafPointerLeave,
    },
  };
}
