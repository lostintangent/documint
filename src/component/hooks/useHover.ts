import {
  resolveHoverTarget as resolveHoverTargetAtViewport,
  type EditorHoverTarget,
  type EditorState,
  type EditorViewportState,
} from "@/editor";
import type { EditorCommentState } from "@/editor/annotations";
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
import { resolveContextualLeaf, type ContextualLeaf } from "../leaves/lib/leaf-target";

type UseHoverOptions = {
  commentState: EditorCommentState;
  editorStateRef: RefObject<EditorState | null>;
  editorViewportState: LazyRefHandle<EditorViewportState>;
  resolveDocumentPoint: (
    event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>,
  ) => { x: number; y: number } | null;
};

// Short delay before hiding a hover leaf when the pointer leaves, giving the
// user time to move into the leaf itself without it flickering away.
const HOVER_HIDE_DELAY_MS = 48;

export function useHover({
  commentState,
  editorStateRef,
  editorViewportState,
  resolveDocumentPoint,
}: UseHoverOptions) {
  const [hoverTarget, setHoverTarget] = useState<EditorHoverTarget | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const isLeafHoveredRef = useRef(false);
  const leaf = resolveContextualLeaf(hoverTarget, commentState.threads);
  const cursor = hoverTarget?.kind === "task-toggle" || leaf?.kind === "link" ? "pointer" : "text";

  useEffect(() => {
    if (hoverTarget && hoverTarget.kind !== "task-toggle" && !leaf) {
      setHoverTarget(null);
    }
  }, [hoverTarget, leaf]);

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

  const clearLeaf = useEffectEvent(() => {
    cancelHide();
    setHoverTarget(null);
  });

  const clearLeafIfPointerIsOutsideLeaf = useEffectEvent(() => {
    if (!isLeafHoveredRef.current) {
      clearLeaf();
    }
  });

  useEffect(
    () => () => {
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    },
    [],
  );

  const resolveHoverTarget = useEffectEvent(
    (event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>) => {
      const currentState = editorStateRef.current;

      if (!currentState) {
        return null;
      }

      const point = resolveDocumentPoint(event);
      if (!point) {
        return null;
      }

      return resolveHoverTargetAtViewport(
        currentState,
        editorViewportState.get(),
        point,
        commentState.liveRanges,
      );
    },
  );

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

  const handlePointerMove = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    applyHoverTarget(resolveHoverTarget(event));
  });

  const handlePointerLeave = useEffectEvent(() => {
    if (!isLeafHoveredRef.current) {
      scheduleHide();
    }
  });

  const handleLeafPointerEnter = useEffectEvent(() => {
    isLeafHoveredRef.current = true;
    cancelHide();
  });

  const handleLeafPointerLeave = useEffectEvent(() => {
    isLeafHoveredRef.current = false;
    scheduleHide();
  });

  const handleClick = useEffectEvent((event: MouseEvent<HTMLCanvasElement>) => {
    const target = resolveHoverTarget(event);

    if (!target || target.kind !== "link" || (!event.metaKey && !event.ctrlKey)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.ownerDocument.defaultView?.open(
      target.url,
      "_blank",
      "noopener,noreferrer",
    );

    return true;
  });

  return {
    canvasHandlers: {
      onClick: handleClick,
      onPointerLeave: handlePointerLeave,
      onPointerMove: handlePointerMove,
    },
    cursor,
    leaf: leaf as ContextualLeaf | null,
    leafHandlers: {
      onPointerEnter: handleLeafPointerEnter,
      onPointerLeave: handleLeafPointerLeave,
    },
    resolveTarget: resolveHoverTarget,
  };
}
