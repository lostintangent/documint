import {
  createCanvasRenderCache,
  prepareViewport,
  type EditorPoint,
  type EditorState,
  type EditorViewportState,
} from "@/editor";
import type { DocumentResources, EditorTheme } from "@/types";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type UIEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { type LazyRefHandle, useLazyRef } from "./useLazyRef";
import { autoScrollSelectionContainer } from "../lib/selection";
import { resolvePointerPointInScrollContainer } from "../lib/pointer";

type ViewportMetrics = {
  height: number;
  top: number;
};

type UseViewportOptions = {
  // Editor inputs the viewport reads to compute prepared state.
  editorState: EditorState;
  editorStateRef: RefObject<EditorState | null>;
  renderResources: DocumentResources | null;
  theme: EditorTheme;
};

export type ViewportController = {
  actions: {
    autoScrollDuringDrag: (event: PointerEvent<HTMLElement>) => void;
    getScrollTop: () => number;
    observePreparedViewport: (viewportState: EditorViewportState) => void;
    observeScrollContainer: (scrollContainer: HTMLDivElement) => void;
    /**
     * Notify the viewport that the editor state has transitioned. The viewport
     * decides whether the cached layout is still valid for the new state and
     * invalidates if not — callers don't touch the cache directly.
     */
    reconcileEditorState: (prevState: EditorState | null, nextState: EditorState) => void;
    /**
     * Force a fresh layout for the next paint and return it. Use this from the
     * viewport-render path; lighter paint paths (content-only, overlay-only)
     * should peek the cached state via `state.preparedViewport.peek()`.
     */
    prepareNextPaint: () => EditorViewportState;
    resolvePoint: (
      event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>,
    ) => EditorPoint | null;
    scrollTo: (top: number) => number;
  };
  props: {
    getScrollContainer: (options?: { onScroll?: (event: UIEvent<HTMLDivElement>) => void }) => {
      onScroll: (event: UIEvent<HTMLDivElement>) => void;
      ref: RefObject<HTMLDivElement | null>;
    };
    scrollContent: {
      style: CSSProperties;
    };
  };
  refs: {
    scrollContainer: RefObject<HTMLDivElement | null>;
  };
  state: {
    layoutWidth: number;
    preparedViewport: LazyRefHandle<EditorViewportState>;
    scrollContentHeight: number;
    surfaceWidth: number;
    viewportHeight: number;
    viewportTop: number;
  };
};

/**
 * Owns all scroll behavior and viewport metrics for the editor.
 *
 * What this hook owns:
 *   - The scroll container DOM ref (created internally, exposed to the host
 *     via `props.getScrollContainer` for spreading and `refs.scrollContainer`
 *     for direct access).
 *   - Viewport metrics (width, height, scroll position, content height),
 *     tracked via `ResizeObserver` and the scroll event.
 *   - The lazily-prepared editor viewport state — the heavy "what to paint
 *     where" structure used by hit testing and rendering.
 *   - Wheel event handling, attached natively so we can call `preventDefault`
 *     and own the scroll math (the default browser scroll doesn't mesh with
 *     our virtualized scroll content height).
 *   - Autoscroll while dragging a selection beyond the visible edge.
 *   - Coordinate translation: pointer/mouse event → document point.
 *
 * Contract with the host:
 *   - Spread `props.getScrollContainer({onScroll})` onto the scroll container
 *     element. The optional `onScroll` callback is invoked after the viewport
 *     records the scroll (typically used to schedule a render).
 *   - Spread `props.scrollContent.style` onto the inner scroll content wrapper
 *     so it sizes to the virtualized content height.
 *   - Call `actions.scrollTo(top)` for content reconciliation and focus
 *     visibility scroll-into-view.
 *   - Call `actions.observePreparedViewport(state)` from the render pipeline
 *     so the scroll content height stays in sync with editor content.
 *   - Call `actions.reconcileEditorState(prev, next)` whenever the editor
 *     state transitions; the viewport decides whether the cached layout is
 *     still usable for the new state.
 *   - Call `actions.prepareNextPaint()` from the viewport-render path to get
 *     a freshly-prepared layout. Lighter paint paths (content-only,
 *     overlay-only) read the cached layout via `state.preparedViewport.peek()`.
 *   - Read `state.preparedViewport` (a read-only `LazyRefHandle`) and share
 *     it with the other hooks (usePointer, useInput, useSelection).
 *   - Wire `actions.resolvePoint` and `actions.autoScrollDuringDrag` into
 *     the other hooks that need them — this hook is the single owner of
 *     coordinate translation and drag-edge autoscroll.
 */
export function useViewport({
  editorState,
  editorStateRef,
  renderResources,
  theme,
}: UseViewportOptions): ViewportController {
  /* Internal state */

  const renderCacheRef = useRef(createCanvasRenderCache());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportMetricsRef = useRef<ViewportMetrics>({ height: 240, top: 0 });
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(240);
  const [viewportTop, setViewportTopState] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(240);
  const layoutWidth = resolveLayoutWidth(surfaceWidth);

  /* Prepared viewport (lazy cache) */

  const createEditorViewportState = useEffectEvent((): EditorViewportState => {
    const currentState = editorStateRef.current ?? editorState;
    const viewport = viewportMetricsRef.current;

    return prepareViewport(
      currentState,
      {
        height: viewport.height,
        paddingX: theme.paddingX,
        paddingY: theme.paddingY,
        top: viewport.top,
        width: layoutWidth,
      },
      renderCacheRef.current,
      renderResources,
    );
  });

  const preparedViewport = useLazyRef(createEditorViewportState);

  const observePreparedViewport = useEffectEvent((viewportState: EditorViewportState) => {
    setScrollContentHeight((previous) => {
      const nextHeight = resolveScrollContentHeight(
        viewportState,
        viewportMetricsRef.current.height,
      );
      return previous === nextHeight ? previous : nextHeight;
    });
  });

  /* Scroll position */

  const setViewportTop = useEffectEvent((top: number) => {
    viewportMetricsRef.current = { ...viewportMetricsRef.current, top };
    setViewportTopState((previous) => (previous === top ? previous : top));
    preparedViewport.invalidate();
  });

  const observeScrollContainer = useEffectEvent((scrollContainer: HTMLDivElement) => {
    const next = readViewportMetrics(scrollContainer);
    const topChanged = next.top !== viewportMetricsRef.current.top;
    viewportMetricsRef.current = next;
    setViewportTopState((previous) => (previous === next.top ? previous : next.top));
    // Invalidate the lazy viewport cache when scroll position changes —
    // otherwise renders triggered by native scroll events would read stale
    // viewport state. (Programmatic `scrollTo` already invalidates via
    // `setViewportTop`; this keeps the two paths consistent.)
    if (topChanged) {
      preparedViewport.invalidate();
    }
  });

  const scrollTo = useEffectEvent((top: number) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      setViewportTop(top);
      return top;
    }

    scrollContainer.scrollTop = top;
    const appliedTop = scrollContainer.scrollTop;
    setViewportTop(appliedTop);
    return appliedTop;
  });

  const getScrollTop = useEffectEvent(() => {
    return scrollContainerRef.current?.scrollTop ?? viewportMetricsRef.current.top;
  });

  /* Cache reuse policy */

  // Decide whether the cached layout can be reused after an editor state
  // transition. The cache survives:
  //   - state changes that don't touch the document (e.g. selection moves);
  //   - state changes whose new selection focus lives inside a region the
  //     cached layout already knows about — the visible area is still valid
  //     and the next paint will refresh it anyway.
  // Anything else invalidates so the next read reflects the new structure.
  const reconcileEditorState = useEffectEvent(
    (prevState: EditorState | null, nextState: EditorState) => {
      const documentChanged =
        prevState !== null && prevState.documentIndex !== nextState.documentIndex;
      const cachedViewportState = preparedViewport.peek();
      const canReuse =
        !documentChanged ||
        !cachedViewportState ||
        cachedViewportState.layout.regionLineIndices.has(nextState.selection.focus.regionId);

      if (!canReuse) {
        preparedViewport.invalidate();
      }
    },
  );

  // Force a fresh layout for the next paint. Used by the viewport-render
  // path; lighter paths (content / overlay) peek the cached layout instead.
  const prepareNextPaint = useEffectEvent((): EditorViewportState => {
    preparedViewport.invalidate();
    return preparedViewport.get();
  });

  /* Coordinate translation + drag autoscroll */

  const resolvePoint = useEffectEvent(
    (event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>): EditorPoint | null => {
      const scrollContainer = scrollContainerRef.current;
      return scrollContainer ? resolvePointerPointInScrollContainer(event, scrollContainer) : null;
    },
  );

  // Wraps the lib autoscroll so `usePointer` and `useSelection` call a
  // single viewport method instead of importing the lib themselves and
  // threading the scroll container ref. Keeps this hook the single owner
  // of scroll-position mutation.
  const autoScrollDuringDrag = useEffectEvent((event: PointerEvent<HTMLElement>) => {
    autoScrollSelectionContainer(scrollContainerRef.current, event);
  });

  /* Resize observation */

  // Track container size changes. ResizeObserver is the only reliable signal
  // for layout-driven dimension changes. Wheel and touch scroll are handled
  // natively by the browser via `overflow: auto` on the scroll container —
  // we just observe the resulting scroll events through `getScrollContainer`
  // to keep state in sync.
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const nextSurfaceWidth = Math.max(0, Math.floor(entry.contentRect.width));
      const nextViewportHeight = readViewportHeight(scrollContainer);

      viewportMetricsRef.current = {
        ...viewportMetricsRef.current,
        height: nextViewportHeight,
      };
      setSurfaceWidth((previous) => (previous === nextSurfaceWidth ? previous : nextSurfaceWidth));
      setViewportHeight((previous) =>
        previous === nextViewportHeight ? previous : nextViewportHeight,
      );
    });

    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  /* Public API */

  const getScrollContainer: ViewportController["props"]["getScrollContainer"] = (options) => ({
    onScroll: (event) => {
      observeScrollContainer(event.currentTarget);
      options?.onScroll?.(event);
    },
    ref: scrollContainerRef,
  });

  return {
    actions: {
      autoScrollDuringDrag,
      getScrollTop,
      observePreparedViewport,
      observeScrollContainer,
      prepareNextPaint,
      reconcileEditorState,
      resolvePoint,
      scrollTo,
    },
    props: {
      getScrollContainer,
      scrollContent: {
        style: {
          height: `${scrollContentHeight}px`,
        },
      },
    },
    refs: {
      scrollContainer: scrollContainerRef,
    },
    state: {
      layoutWidth,
      preparedViewport,
      scrollContentHeight,
      surfaceWidth,
      viewportHeight,
      viewportTop,
    },
  };
}

function resolveLayoutWidth(surfaceWidth: number) {
  return Math.max(240, Math.floor(surfaceWidth || 480));
}

function readViewportHeight(scrollContainer: HTMLDivElement) {
  return Math.max(240, scrollContainer.clientHeight);
}

function readViewportMetrics(scrollContainer: HTMLDivElement): ViewportMetrics {
  return {
    height: readViewportHeight(scrollContainer),
    top: scrollContainer.scrollTop,
  };
}

function resolveScrollContentHeight(viewportState: EditorViewportState, viewportHeight: number) {
  return Math.max(viewportHeight, Math.ceil(viewportState.totalHeight + 24));
}
