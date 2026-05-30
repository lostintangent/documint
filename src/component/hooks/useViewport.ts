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
    scrollContentHeight: number;
    layout: EditorLayoutHandle;
    viewportWidth: number;
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
 *   - The lazily-prepared editor layout state — the heavy "what to paint
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
 *   - Call `actions.commitLayout()` from the render path to retrieve the
 *     layout to paint with — that same call marks the layout as the
 *     rendered frame so reactive overlays stay in lockstep with the canvas.
 *   - Call `actions.reconcileEditorState(prev, next)` whenever the editor
 *     state transitions; the viewport decides whether the cached layout is
 *     still usable for the new state.
 *   - Call `actions.invalidateLayout()` when an input the layout depends on
 *     changes outside of doc/scroll (width, theme, resources, viewport
 *     height) before scheduling a render.
 *   - Read `state.layout.get()` from hit-test paths (recomputes if
 *     invalidated, returns cached otherwise). Lighter paint paths
 *     (content-only, overlay-only) read the latest layout via
 *     `state.layout.peekLatest()` and skip if it's `null`.
 *   - Read `state.layout` (the store-backed layout handle) and share it with
 *     the other hooks (usePointer, useInput, useSelection).
 *   - Wire `actions.resolvePoint` and `actions.autoScrollDuringDrag` into
 *     the other hooks that need them — this hook is the single owner of
 *     coordinate translation and drag-edge autoscroll.
 */
export function useViewport({ renderResources, theme }: UseViewportOptions): ViewportController {
  /* Internal state */

  const store = useDocumintStore();
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
  // (e.g. `resolveDocumentLeafAnchor` reads `.get()` synchronously when the cache
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
  // synchronous-during-render readers like `resolveDocumentLeafAnchor` work
  // immediately, not after the first effect commit.
  const installedStoreRef = useRef<DocumintStore | null>(null);
  if (installedStoreRef.current !== store) {
    store.layout.setLayoutResolver(() => resolverRef.current!());
    installedStoreRef.current = store;
  }

  const layout = store.layout;

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

  const observeScrollContainer = useEffectEvent((scrollContainer: HTMLDivElement) => {
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

  /* Cache reuse policy */

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
  // we just observe the resulting scroll events through `observeScrollContainer`
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
