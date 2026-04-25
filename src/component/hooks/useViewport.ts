// Owns host viewport state for the canvas editor: container sizing, scroll
// metrics, virtual scroll height, and prepared viewport caching.
import {
  createCanvasRenderCache,
  prepareViewport,
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
import { type LazyRef, useLazyRef } from "./useLazyRef";
import { resolvePointerPointInScrollContainer } from "../lib/pointer";

type ViewportMetrics = {
  height: number;
  top: number;
};

type UseViewportOptions = {
  editorState: EditorState;
  editorStateRef: RefObject<EditorState | null>;
  renderResources: DocumentResources | null;
  theme: EditorTheme;
};

export type ViewportController = {
  actions: {
    getScrollTop: () => number;
    observePreparedViewport: (viewportState: EditorViewportState) => void;
    observeScrollContainer: (scrollContainer: HTMLDivElement) => void;
    resolvePointerPoint: (
      event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>,
    ) => { x: number; y: number } | null;
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
    preparedViewport: LazyRef<EditorViewportState>;
    scrollContentHeight: number;
    surfaceWidth: number;
    viewportHeight: number;
    viewportTop: number;
  };
};

export function useViewport({
  editorState,
  editorStateRef,
  renderResources,
  theme,
}: UseViewportOptions): ViewportController {
  const renderCacheRef = useRef(createCanvasRenderCache());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const viewportMetricsRef = useRef<ViewportMetrics>({
    height: 240,
    top: 0,
  });
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(240);
  const [viewportTop, setViewportTopState] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(240);
  const layoutWidth = resolveLayoutWidth(surfaceWidth);

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

  const observeScrollContainer = useEffectEvent((scrollContainer: HTMLDivElement) => {
    const nextViewportMetrics = readViewportMetrics(scrollContainer);

    viewportMetricsRef.current = nextViewportMetrics;
    setViewportTopState((previous) =>
      previous === nextViewportMetrics.top ? previous : nextViewportMetrics.top,
    );
  });

  const setViewportTop = useEffectEvent((top: number) => {
    viewportMetricsRef.current = {
      ...viewportMetricsRef.current,
      top,
    };
    setViewportTopState((previous) => (previous === top ? previous : top));
    preparedViewport.invalidate();
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

  const resolvePointerPoint = useEffectEvent(
    (event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>) => {
      const scrollContainer = scrollContainerRef.current;

      return scrollContainer ? resolvePointerPointInScrollContainer(event, scrollContainer) : null;
    },
  );

  const getScrollContainer: ViewportController["props"]["getScrollContainer"] = (options) => ({
    onScroll: (event) => {
      observeScrollContainer(event.currentTarget);
      options?.onScroll?.(event);
    },
    ref: scrollContainerRef,
  });

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) {
        return;
      }

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

    return () => {
      observer.disconnect();
    };
  }, [scrollContainerRef]);

  return {
    actions: {
      getScrollTop,
      observePreparedViewport,
      observeScrollContainer,
      resolvePointerPoint,
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
