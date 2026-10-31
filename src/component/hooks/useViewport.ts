import {
  createLayoutCache,
  createEditorLayoutState as buildEditorLayoutState,
  type EditorPoint,
  type EditorLayoutState,
  type DocumentResources,
} from "@/editor";
import type { ResolvedEditorTheme } from "@/renderer";
import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { resolvePointerPointInScrollContainer } from "../lib/pointer";
import { useDocumintStore } from "../store";

type ViewportMetrics = {
  height: number;
  top: number;
};

// Distance from the viewport edge at which drag autoscroll activates.
const DRAG_AUTO_SCROLL_EDGE_THRESHOLD = 28;

// Pixels scrolled per pointer-move event while autoscrolling.
const DRAG_AUTO_SCROLL_INCREMENT = 18;

type UseViewportOptions = {
  metadataExpanded: boolean;
  renderResources: DocumentResources | null;
  theme: ResolvedEditorTheme;
};

export function useViewport({ metadataExpanded, renderResources, theme }: UseViewportOptions) {
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

  // Builds a fresh layout when the store's cache is empty. Reads the latest
  // committed theme, width, metadata, and resources without making the
  // store re-register a new resolver on every render.
  const resolveLayout = useEffectEvent((): EditorLayoutState => {
    const currentState = store.editor.getState();
    const metrics = viewportMetricsRef.current;

    return buildEditorLayoutState(
      currentState,
      {
        fontSize: theme.fontSize,
        height: metrics.height,
        metadataExpanded,
        paddingX: theme.paddingX,
        paddingY: theme.paddingY,
        top: metrics.top,
        width: viewportWidth,
      },
      layoutCacheRef.current,
      renderResources,
    );
  });

  // The store throws on `get()` until this runs. Child layout effects commit
  // first, so they must not read the layout handle.
  useLayoutEffect(() => {
    store.layout.setLayoutResolver(() => resolveLayout());
  }, [store]);

  /* Layout commit */

  // Commit the latest layout as the rendered frame, fire reactive subscribers,
  // and keep the scroll-content height in sync. The render scheduler calls this
  // right before painting, and the painters then read the committed layout via
  // `layout.peekLatest()`.
  const commitLayout = useEffectEvent(() => {
    const layoutState = store.layout.commit();
    setScrollContentHeight((previous) => {
      const nextHeight = resolveScrollContentHeight(layoutState, viewportMetricsRef.current.height);
      return previous === nextHeight ? previous : nextHeight;
    });
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

  /* Layout invalidation */

  // Mark the cached layout as stale. Callers invoke this when an input the
  // layout depends on has changed (document transitions, width, theme,
  // resources, viewport height). Scroll position is invalidated internally.
  // The next read of `layout.get()` will recompute against current inputs.
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
    autoScrollDuringDrag,
    commitLayout,
    getScrollTop,
    invalidateLayout,
    layout,
    resolvePoint,
    scrollContainerRef,
    scrollContentHeight,
    scrollTo,
    syncScrollContainer,
    viewportHeight,
    viewportTop,
    viewportWidth,
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
