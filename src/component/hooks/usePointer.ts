import {
  extendSelectionToPoint,
  resolveDragFocus,
  resolveHoverTarget as resolveHoverTargetAtViewport,
  resolveSelectionHit,
  resolveWordSelection,
  setSelection,
  toggleTask,
  type EditorCommentState,
  type EditorHoverTarget,
  type EditorSelectionPoint,
  type EditorState,
  type EditorLayoutState,
} from "@/editor";
import type { LazyRefHandle } from "./useLazyRef";
import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { resolveContextualLeaf, type ContextualLeaf } from "../overlays/leaves/lib/leaf-target";
import type { FocusInput } from "./useInput";

type UsePointerOptions = {
  // DOM refs the hook reads from.
  canvasRef: RefObject<HTMLCanvasElement | null>;

  // Editor state and lookups the hook reads from.
  commentState: EditorCommentState;
  editorStateRef: RefObject<EditorState | null>;
  editorViewportState: LazyRefHandle<EditorLayoutState>;
  readCurrentState: () => EditorState;
  resolvePoint: (
    event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>,
  ) => { x: number; y: number } | null;

  // Host callbacks the hook invokes.
  applyNextState: (nextState: EditorState | null) => void;
  autoScrollDuringDrag: (event: PointerEvent<HTMLElement>) => void;
  focusInput: FocusInput;
  onActivity: () => void;
};

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
  leaf: ContextualLeaf | null;
  leafHandlers: LeafHoverHandlers;
};

// Short delay before hiding a hover leaf when the pointer leaves, giving the
// user time to move into the leaf itself without it flickering away.
const HOVER_HIDE_DELAY_MS = 48;

/**
 * Owns all canvas pointer/click/dblclick interactions and hover state for
 * the editor.
 *
 * What this hook owns:
 *   - Hover state — which target is under the pointer, cursor style, the
 *     visible contextual leaf, and hide-on-leave timing.
 *   - Drag-to-select on mouse/pen — anchor tracking, pointer capture, and
 *     autoscroll past the canvas edge.
 *   - Tap-to-place-caret on touch — deferred to `click` so the browser's
 *     native scroll-vs-tap disambiguation runs first.
 *   - Task toggles, double-click word selection, and Cmd/Ctrl-click link
 *     activation.
 *
 * Contract with the host:
 *   - The host provides DOM refs, editor state accessors, and callbacks for
 *     state changes / focus / activity (see `UsePointerOptions`).
 *   - The host spreads `canvasHandlers` onto the canvas, reads `cursor` for
 *     its style, and renders `leaf` with `leafHandlers` for contextual UI.
 *   - The host knows nothing about pointer types, drag anchors, hit testing,
 *     or gesture disambiguation — those live entirely in this hook.
 */
export function usePointer({
  applyNextState,
  autoScrollDuringDrag,
  canvasRef,
  commentState,
  editorStateRef,
  editorViewportState,
  focusInput,
  onActivity,
  readCurrentState,
  resolvePoint,
}: UsePointerOptions): PointerController {
  /* Internal state */

  const [hoverTarget, setHoverTarget] = useState<EditorHoverTarget | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const isLeafHoveredRef = useRef(false);
  // Drag-to-select uses pointer capture; `lastPointerTypeRef` lets `click`
  // distinguish a touch tap (where pointerdown deferred) from a mouse/pen
  // click (where pointerdown already placed the caret).
  const dragPointerIdRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<EditorSelectionPoint | null>(null);
  const lastPointerTypeRef = useRef<string | null>(null);

  const leaf = resolveContextualLeaf(hoverTarget, commentState.threads);
  const cursor = hoverTarget?.kind === "task-toggle" || leaf?.kind === "link" ? "pointer" : "text";

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
      const thread = commentState.threads[target.commentThreadIndex] ?? null;

      if (!thread) {
        clearLeafIfPointerIsOutsideLeaf();
        return;
      }

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

  const resolveHoverTarget = useEffectEvent(
    (event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>) => {
      const currentState = editorStateRef.current;
      if (!currentState) return null;

      const point = resolvePoint(event);
      if (!point) return null;

      return resolveHoverTargetAtViewport(
        currentState,
        editorViewportState.get(),
        point,
        commentState.liveRanges,
      );
    },
  );

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

  // pointerup and pointercancel collapse to the same response: release the
  // captured pointer and clear drag state. The browser fires pointercancel
  // when it preempts the gesture (e.g. native scroll on touch) and pointerup
  // on a clean release — both end the drag.
  const endPointerGesture = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    releaseCanvasPointer(event.pointerId);
    clearCanvasDrag();
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
      return;
    }

    const canvas = canvasRef.current;
    const currentState = readCurrentState();
    const point = resolvePoint(event);
    if (!point) return;

    const target = resolveHoverTarget(event);

    // Task toggles are handled in `click` for both mouse and touch — early
    // return here so we don't drop a caret next to the checkbox before the
    // toggle fires.
    if (target?.kind === "task-toggle") {
      return;
    }

    const hit = resolveSelectionHit(currentState, editorViewportState.get(), point);
    if (!canvas || !hit) return;

    dragPointerIdRef.current = event.pointerId;
    onActivity();
    canvas.setPointerCapture(event.pointerId);

    if (event.shiftKey) {
      // Preserve the existing anchor so a subsequent drag continues extending from the same origin.
      dragAnchorRef.current = currentState.selection.anchor;
      applyNextState(extendSelectionToPoint(currentState, hit.regionId, hit.offset));
    } else {
      dragAnchorRef.current = { offset: hit.offset, regionId: hit.regionId };
      applyNextState(setSelection(currentState, { offset: hit.offset, regionId: hit.regionId }));
    }

    // Pass the tapped caret to `focus` so it positions the hidden textarea
    // synchronously before invoking the native `focus()`. Without this, the
    // textarea's position only updates on the next React render via the
    // layout effect — which is too late for iOS's scroll-to-focused-input
    // decision, leaving the caret hidden behind the virtual keyboard.
    focusInput({ offset: hit.offset, regionId: hit.regionId });
  });

  const handlePointerMove = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    const anchor = dragAnchorRef.current;
    const currentState = readCurrentState();
    const point = resolvePoint(event);
    if (!point) return;

    // Hover updates are meaningless during a drag-select — the user is
    // extending a range, not interacting with hover targets. Skipping the
    // hit test here also prevents stray hover leaves (links, comment
    // threads, task toggles) from appearing as the pointer drags over
    // them mid-selection.
    if (dragPointerIdRef.current !== event.pointerId || !anchor) {
      applyHoverTarget(resolveHoverTarget(event));
      return;
    }

    const nextFocus = resolveDragFocus(currentState, editorViewportState.get(), point, anchor);
    if (!nextFocus) return;

    onActivity();
    autoScrollDuringDrag(event);
    applyNextState(setSelection(currentState, { anchor, focus: nextFocus }));
  });

  const handlePointerLeave = useEffectEvent(() => {
    if (!isLeafHoveredRef.current) {
      scheduleHide();
    }
  });

  const handleClick = useEffectEvent((event: MouseEvent<HTMLCanvasElement>) => {
    const wasTouchTap = lastPointerTypeRef.current === "touch";
    lastPointerTypeRef.current = null;

    // Task toggles fire from `click` for all input types — `click` is the
    // browser's already-disambiguated activation event, so we don't need to
    // hand-roll tap-vs-drag detection.
    const target = resolveHoverTarget(event);

    if (target?.kind === "task-toggle") {
      const currentState = readCurrentState();
      const toggled = toggleTask(currentState, target.listItemId);
      if (toggled) {
        event.preventDefault();
        event.stopPropagation();
        onActivity();
        applyNextState(toggled);
      }
      return;
    }

    // Cmd/Ctrl-click on a link opens it in a new tab; a plain click falls
    // through to caret placement so users can edit link text normally.
    if (target?.kind === "link" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.ownerDocument.defaultView?.open(
        target.url,
        "_blank",
        "noopener,noreferrer",
      );
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
    const currentState = readCurrentState();
    const point = resolvePoint(event);
    const hit = point ? resolveSelectionHit(currentState, editorViewportState.get(), point) : null;

    if (hit) {
      onActivity();
      applyNextState(setSelection(currentState, { offset: hit.offset, regionId: hit.regionId }));
      focusInput({ offset: hit.offset, regionId: hit.regionId });
    } else {
      focusInput();
    }
  });

  const handleDoubleClick = useEffectEvent((event: MouseEvent<HTMLCanvasElement>) => {
    const currentState = readCurrentState();
    const point = resolvePoint(event);
    const target = resolveHoverTarget(event);

    if (!point || target?.kind === "task-toggle") return;

    const wordSel = resolveWordSelection(currentState, editorViewportState.get(), point);
    if (!wordSel) return;

    event.preventDefault();
    event.stopPropagation();
    onActivity();
    applyNextState(setSelection(currentState, wordSel));
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
      onPointerUp: endPointerGesture,
    },
    cursor,
    leaf,
    leafHandlers: {
      onPointerEnter: handleLeafPointerEnter,
      onPointerLeave: handleLeafPointerLeave,
    },
  };
}
