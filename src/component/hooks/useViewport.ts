import {
  createCanvasRenderCache,
  prepareLayout,
  type EditorPoint,
  type EditorLayoutState,
  type EditorState,
} from "@/editor";
import type { DocumentResources, EditorTheme } from "@/types";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { resolvePointerPointInScrollContainer } from "../lib/pointer";
import { useDocumintStore } from "../store";
import type { ViewportLayoutHandle } from "../store/viewport/store";

type ViewportMetrics = {
  height: number;
  top: number;
};

// Distance from the viewport edge at which drag autoscroll activates.
const DRAG_AUTO_SCROLL_EDGE_THRESHOLD = 28;

// Pixels scrolled per pointer-move event while autoscrolling.
const DRAG_AUTO_SCROLL_INCREMENT = 18;

type UseViewportOptions = {
  renderResources: DocumentResources | null;
  theme: EditorTheme;
};

export type ViewportController = {
  actions: {
    autoScrollDuringDrag: (event: PointerEvent<HTMLElement>) => void;
    getScrollTop: () => number;
    /**
     * Mark the cached viewport as stale so the next `state.viewportLayout.get()`
     * recomputes. Callers invoke this when an input the layout depends on has
     * changed but isn't covered by `reconcileEditorState` (width, theme,
     * resources, viewport height). Scroll position is invalidated internally.
     */
    invalidateViewport: () => void;
    observeViewport: (viewportState: EditorLayoutState) => void;
    observeScrollContainer: (scrollContainer: HTMLDivElement) => void;
    /**
     * Notify the viewport that the editor state has transitioned. The viewport
     * decides whether the cached layout is still valid for the new state and
     * invalidates if not — callers don't touch the cache directly.
     */
    reconcileEditorState: (prevState: EditorState | null, nextState: EditorState) => void;
    resolvePoint: (
      event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>,
    ) => EditorPoint | null;
    scrollTo: (top: number) => number;
  };
  props: {
    scrollContent: {
      style: CSSProperties;
    };
  };
  refs: {
    scrollContainer: RefObject<HTMLDivElement | null>;
  };
  state: {
    layoutWidth: number;
    scrollContentHeight: number;
    viewportLayout: ViewportLayoutHandle;
    viewportHeight: number;
    viewportTop: number;
  };
};

/**
 * Owns all scroll behavior and viewport metrics for the editor.
 *
 * What this hook owns:
 *   - The scroll container DOM ref (created internally, exposed to the host
 *     via `refs.scrollContainer`).
 *   - Viewport metrics (width, height, scroll position, content height),
 *     tracked via `ResizeObserver` and the scroll event.
 *   - The lazily-prepared editor viewport state — the heavy "what to paint
 *     where" structure used by hit testing and rendering.
 *   - Autoscroll while dragging a selection beyond the visible edge.
 *   - Coordinate translation: pointer/mouse event → document point.
 *
 * Contract with the host:
 *   - Apply `refs.scrollContainer` as the `ref` of the scroll container
 *     element, and wire its `onScroll` to a handler that calls
 *     `actions.observeScrollContainer(event.currentTarget)` (typically
 *     followed by a render schedule).
 *   - Spread `props.scrollContent.style` onto the inner scroll content wrapper
 *     so it sizes to the virtualized content height.
 *   - Call `actions.scrollTo(top)` for content reconciliation and focus
 *     visibility scroll-into-view.
 *   - Call `actions.observeViewport(state)` from the render pipeline
 *     so the scroll content height stays in sync with editor content.
 *   - Call `actions.reconcileEditorState(prev, next)` whenever the editor
 *     state transitions; the viewport decides whether the cached layout is
 *     still usable for the new state.
 *   - Call `actions.invalidateViewport()` when an input the layout
 *     depends on changes outside of doc/scroll (width, theme, resources,
 *     viewport height) before scheduling a render.
 *   - Read `state.viewportLayout.get()` from the viewport-render path
 *     (recomputes if invalidated, returns cached otherwise). Lighter paint
 *     paths (content-only, overlay-only) read the cached layout via
 *     `state.viewportLayout.peek()`.
 *   - Read `state.viewportLayout` (the store-backed viewport handle) and share
 *     it with the other hooks (usePointer, useInput, useSelection).
 *   - Wire `actions.resolvePoint` and `actions.autoScrollDuringDrag` into
 *     the other hooks that need them — this hook is the single owner of
 *     coordinate translation and drag-edge autoscroll.
 */
export function useViewport({ renderResources, theme }: UseViewportOptions): ViewportController {
  /* Internal state */

  const store = useDocumintStore();
  const renderCacheRef = useRef(createCanvasRenderCache());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportMetricsRef = useRef<ViewportMetrics>({ height: 240, top: 0 });
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(240);
  const [viewportTop, setViewportTopState] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(240);
  const layoutWidth = resolveLayoutWidth(surfaceWidth);

  /* Viewport layout cache */

  // Plain closure (not `useEffectEvent`) because layout may be computed during
  // host render when the cache was invalidated since the last paint and a
  // consumer reads `.get()` before the next rAF rebuilds it.
  const createEditorLayoutState = (): EditorLayoutState => {
    const currentState = store.editor.getState();
    const viewport = viewportMetricsRef.current;

    return prepareLayout(
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
  };

  store.viewport.setViewportResolver(createEditorLayoutState);

  const viewportLayout = store.viewport;

  const observeViewport = useEffectEvent((viewportState: EditorLayoutState) => {
    store.viewport.observeViewport(viewportState);
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
    viewportLayout.invalidate();
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
      viewportLayout.invalidate();
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
      const cachedViewportState = viewportLayout.peek();
      const canReuse =
        !documentChanged ||
        !cachedViewportState ||
        cachedViewportState.layout.regionLineIndices.has(nextState.selection.focus.regionId);

      if (!canReuse) {
        viewportLayout.invalidate();
      }
    },
  );

  // Mark the cached layout as stale. Callers invoke this when an input the
  // layout depends on has changed but isn't covered by `reconcileEditorState`
  // (width, theme, resources, viewport height). The next read of
  // `viewportLayout.get()` will recompute against current inputs.
  const invalidateViewport = useEffectEvent(() => {
    viewportLayout.invalidate();
  });

  /* Coordinate translation + drag autoscroll */

  const resolvePoint = useEffectEvent(
    (event: PointerEvent<HTMLElement> | MouseEvent<HTMLElement>): EditorPoint | null => {
      const scrollContainer = scrollContainerRef.current;
      return scrollContainer ? resolvePointerPointInScrollContainer(event, scrollContainer) : null;
    },
  );

  const autoScrollDuringDrag = useEffectEvent((event: PointerEvent<HTMLElement>) => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const bounds = scrollContainer.getBoundingClientRect();

    if (event.clientY < bounds.top + DRAG_AUTO_SCROLL_EDGE_THRESHOLD) {
      scrollContainer.scrollTop = Math.max(
        0,
        scrollContainer.scrollTop - DRAG_AUTO_SCROLL_INCREMENT,
      );
      return;
    }

    if (event.clientY > bounds.bottom - DRAG_AUTO_SCROLL_EDGE_THRESHOLD) {
      scrollContainer.scrollTop += DRAG_AUTO_SCROLL_INCREMENT;
    }
  });

  /* Resize observation */

  // Track container size changes. ResizeObserver is the only reliable signal
  // for layout-driven dimension changes. Wheel and touch scroll are handled
  // natively by the browser via `overflow: auto` on the scroll container —
  // we just observe the resulting scroll events through `observeScrollContainer`
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

  return {
    actions: {
      autoScrollDuringDrag,
      getScrollTop,
      invalidateViewport,
      observeViewport,
      observeScrollContainer,
      reconcileEditorState,
      resolvePoint,
      scrollTo,
    },
    props: {
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
      scrollContentHeight,
      viewportLayout,
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

function resolveScrollContentHeight(viewportState: EditorLayoutState, viewportHeight: number) {
  return Math.max(viewportHeight, Math.ceil(viewportState.totalHeight + 24));
}
