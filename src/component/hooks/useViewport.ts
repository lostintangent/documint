import {
  createLayoutCache,
  createEditorLayoutState as buildEditorLayoutState,
  type EditorPoint,
  type EditorLayoutState,
  type EditorState,
} from "@/editor";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { resolvePointerPointInScrollContainer } from "../lib/pointer";
import { useDocumintStore, type DocumintStore } from "../store";
import type { EditorLayoutHandle } from "../store/layout/store";

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
  theme: ResolvedEditorTheme;
};

export type ViewportController = {
  actions: {
    autoScrollDuringDrag: (event: PointerEvent<HTMLElement>) => void;
    getScrollTop: () => number;
    /**
     * Mark the latest layout as stale so the next `state.layout.get()`
     * recomputes. Callers invoke this when an input the layout depends on has
     * changed but isn't covered by `reconcileEditorState` (width, theme,
     * resources, viewport height). Scroll position is invalidated internally.
     */
    invalidateLayout: () => void;
    /**
     * Commit the latest layout as the rendered frame, fire reactive
     * subscribers, and keep the scroll-content height in sync. Called by
     * the render path right before painting the canvas; the returned layout
     * is what the paint functions should draw against.
     */
    commitLayout: () => EditorLayoutState;
    syncScrollContainer: (scrollContainer: HTMLDivElement) => void;
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
    scrollContentHeight: number;
    layout: EditorLayoutHandle;
    viewportWidth: number;
    viewportHeight: number;
    viewportTop: number;
  };
};

export function useViewport({ renderResources, theme }: UseViewportOptions): ViewportController {
  /* Store, refs, and viewport state */

  const store = useDocumintStore();
  const layout = store.layout;
  const layoutCacheRef = useRef(createLayoutCache());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportMetricsRef = useRef<ViewportMetrics>({ height: 240, top: 0 });
  const [measuredViewportWidth, setMeasuredViewportWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(240);
  const [viewportTop, setViewportTopState] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(240);
  const viewportWidth = resolveViewportWidth(measuredViewportWidth);

  /* Layout cache resolver */

  // The store's `get()` needs a way to build a fresh layout when the cache
  // is empty. The resolver closes over hook state (theme, viewport width,
  // viewport metrics, resources) that changes between renders, so we keep
  // the latest closure in a ref. Every render writes the current closure to
  // `resolverRef.current`; the store keeps a single stable wrapper that
  // reads through the ref, so it sees fresh values on every call.
  //
  // Not `useEffectEvent` because layout may be computed during host render
  // (e.g. `resolveLeafAnchor` reads `.get()` synchronously when the cache
  // was invalidated since the last paint); effect events disallow that.
  const resolverRef = useRef<() => EditorLayoutState>(undefined);
  resolverRef.current = (): EditorLayoutState => {
    const currentState = store.editor.getState();
    const metrics = viewportMetricsRef.current;

    return buildEditorLayoutState(
      currentState,
      {
        height: metrics.height,
        paddingX: theme.paddingX,
        paddingY: theme.paddingY,
        top: metrics.top,
        width: viewportWidth,
      },
      layoutCacheRef.current,
      renderResources,
    );
  };

  // Install the resolver once per store. The wrapper reads through the ref,
  // so the resolver doesn't need to be re-registered when its closure
  // updates. Installed during the first render that sees this store so
  // synchronous-during-render readers like `resolveLeafAnchor` work
  // immediately, not after the first effect commit.
  const installedStoreRef = useRef<DocumintStore | null>(null);
  if (installedStoreRef.current !== store) {
    store.layout.setLayoutResolver(() => resolverRef.current!());
    installedStoreRef.current = store;
  }

  /* Layout commit */

  const commitLayout = useEffectEvent((): EditorLayoutState => {
    const layoutState = store.layout.commit();
    setScrollContentHeight((previous) => {
      const nextHeight = resolveScrollContentHeight(layoutState, viewportMetricsRef.current.height);
      return previous === nextHeight ? previous : nextHeight;
    });
    return layoutState;
  });

  /* Scroll position */

  const setViewportTop = useEffectEvent((top: number) => {
    viewportMetricsRef.current = { ...viewportMetricsRef.current, top };
    setViewportTopState((previous) => (previous === top ? previous : top));
    layout.invalidate();
  });

  const syncScrollContainer = useEffectEvent((scrollContainer: HTMLDivElement) => {
    const next = readViewportMetrics(scrollContainer);
    const topChanged = next.top !== viewportMetricsRef.current.top;
    viewportMetricsRef.current = next;
    setViewportTopState((previous) => (previous === next.top ? previous : next.top));
    // Invalidate the lazy layout cache when scroll position changes —
    // otherwise renders triggered by native scroll events would read stale
    // layout state. (Programmatic `scrollTo` already invalidates via
    // `setViewportTop`; this keeps the two paths consistent.)
    if (topChanged) {
      layout.invalidate();
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
    if (appliedTop !== viewportMetricsRef.current.top) {
      setViewportTop(appliedTop);
    }
    return appliedTop;
  });

  const getScrollTop = useEffectEvent(() => {
    return scrollContainerRef.current?.scrollTop ?? viewportMetricsRef.current.top;
  });

  /* Editor-state layout invalidation */

  // Decide whether the cached layout can be reused after an editor state
  // transition. The cache survives:
  //   - state changes that don't touch the document (e.g. selection moves);
  //   - selection-only state changes, because they don't affect layout;
  //   - initial state publication, because there is no previous geometry.
  // Document changes always invalidate immediately so any imperative layout
  // read after the transition resolves against the new structure.
  const reconcileEditorState = useEffectEvent(
    (prevState: EditorState | null, nextState: EditorState) => {
      if (shouldInvalidateLayoutAfterEditorTransition(prevState, nextState)) {
        layout.invalidate();
      }
    },
  );

  // Mark the cached layout as stale. Callers invoke this when an input the
  // layout depends on has changed but isn't covered by `reconcileEditorState`
  // (width, theme, resources, viewport height). The next read of
  // `layout.get()` will recompute against current inputs.
  const invalidateLayout = useEffectEvent(() => {
    layout.invalidate();
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

  const updateViewportSize = useEffectEvent(
    (scrollContainer: HTMLDivElement, observedWidth?: number) => {
      const nextMeasuredViewportWidth = readViewportWidth(scrollContainer, observedWidth);
      const nextViewportHeight = readViewportHeight(scrollContainer);

      viewportMetricsRef.current = {
        ...viewportMetricsRef.current,
        height: nextViewportHeight,
      };
      setMeasuredViewportWidth((previous) =>
        previous === nextMeasuredViewportWidth ? previous : nextMeasuredViewportWidth,
      );
      setViewportHeight((previous) =>
        previous === nextViewportHeight ? previous : nextViewportHeight,
      );
    },
  );

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    updateViewportSize(scrollContainer);
  }, [scrollContainerRef]);

  // Track container size changes. ResizeObserver is the only reliable signal
  // for layout-driven dimension changes. Wheel and touch scroll are handled
  // natively by the browser via `overflow: auto` on the scroll container —
  // we just sync the resulting scroll events through `syncScrollContainer`
  // to keep state in sync.
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      updateViewportSize(scrollContainer, entry.contentRect.width);
    });

    observer.observe(scrollContainer);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  /* Public API */

  return {
    actions: {
      autoScrollDuringDrag,
      commitLayout,
      getScrollTop,
      invalidateLayout,
      reconcileEditorState,
      resolvePoint,
      scrollTo,
      syncScrollContainer,
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
      scrollContentHeight,
      layout,
      viewportWidth,
      viewportHeight,
      viewportTop,
    },
  };
}

function resolveViewportWidth(measuredViewportWidth: number) {
  return Math.floor(measuredViewportWidth || 480);
}

function readViewportWidth(scrollContainer: HTMLDivElement, observedWidth?: number) {
  return Math.max(0, Math.floor(observedWidth ?? scrollContainer.clientWidth));
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

function resolveScrollContentHeight(layoutState: EditorLayoutState, viewportHeight: number) {
  return Math.max(viewportHeight, Math.ceil(layoutState.totalHeight + 24));
}

export function shouldInvalidateLayoutAfterEditorTransition(
  prevState: EditorState | null,
  nextState: EditorState,
) {
  return prevState !== null && prevState.documentIndex !== nextState.documentIndex;
}
