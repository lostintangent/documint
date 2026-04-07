/**
 * Public React host for the canvas editor. The component owns content-format
 * bridging, DOM lifecycle, viewport coordination, and hidden-input plumbing.
 */
import {
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  countResolvedCommentThreads,
  isResolvedCommentThread,
} from "@/comments";
import type { Document } from "@/document";
import {
  type PreparedViewport,
  type EditorStateChange,
  type EditorSelectionPoint as SelectionPoint,
} from "@/editor";
import { darkEditorTheme, lightEditorTheme, type EditorTheme } from "@/editor";
import { parseMarkdown, serializeMarkdown } from "@/markdown";
import { AnnotationLeaf } from "./leaves/AnnotationLeaf";
import { InsertionLeaf } from "./leaves/InsertionLeaf";
import { LeafPortal, type LeafPortalAnchor } from "./leaves/LeafPortal";
import { LinkLeaf } from "./leaves/LinkLeaf";
import { TableLeaf } from "./leaves/TableLeaf";
import { useCursor } from "./hooks/useCursor";
import { useDocumentImages } from "./hooks/useDocumentImages";
import { useEditor } from "./hooks/useEditor";
import { useHover } from "./hooks/useHover";
import { useNativeInput } from "./hooks/useNativeInput";
import { useRenderScheduler } from "./hooks/useRenderScheduler";
import { useSelection } from "./hooks/useSelection";
import { areStatesEqual, prepareCanvasLayer } from "./lib/canvas";
import {
  autoScrollSelectionContainer,
  normalizeSelectionAbsolutePositions,
} from "./lib/selection";
import { resolvePointerPointInScrollContainer } from "./lib/pointer";
import { DocumintSsr } from "./Ssr";
import { DOCUMINT_EDITOR_STYLES } from "./styles";

export type DocumintState = {
  activeBlockType: string | null;
  activeCommentThreadIndex: number | null;
  activeSpanKind: string | null;
  canonicalContent: string;
  characterCount: number;
  commentThreadCount: number;
  docChangeCount: number;
  lastTransactionMs: number;
  layoutWidth: number;
  lineCount: number;
  resolvedCommentCount: number;
  selectionFrom: number;
  selectionTo: number;
  transactionCount: number;
};

export type DocumintProps = {
  className?: string;
  content: string;
  onContentChange?: (content: string, document: Document) => void;
  onStateChange?: (state: DocumintState) => void;
  theme?: EditorTheme;
};

type PerfMetrics = {
  docChangeCount: number;
  lastTransactionMs: number;
  transactionCount: number;
};

type ViewportMetrics = {
  height: number;
  top: number;
};

type FocusVisibilityRequest = {
  layoutWidth: number;
  offset: number;
  regionId: string;
  viewportHeight: number;
};

const defaultPerfMetrics: PerfMetrics = {
  docChangeCount: 0,
  lastTransactionMs: 0,
  transactionCount: 0,
};
const selectionLeafVerticalOffset = 2;

const defaultDocumintState: DocumintState = {
  activeBlockType: null,
  activeCommentThreadIndex: null,
  activeSpanKind: null,
  canonicalContent: "",
  characterCount: 0,
  commentThreadCount: 0,
  docChangeCount: 0,
  lastTransactionMs: 0,
  layoutWidth: 0,
  lineCount: 0,
  resolvedCommentCount: 0,
  selectionFrom: 0,
  selectionTo: 0,
  transactionCount: 0,
};

export function Documint({
  className,
  content,
  onContentChange,
  onStateChange,
  theme,
}: DocumintProps) {
  const editor = useEditor();
  const hostRef = useRef<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const editorStateRef = useRef<ReturnType<typeof editor.createState> | null>(null);
  const perfMetricsRef = useRef<PerfMetrics>(defaultPerfMetrics);
  const surfaceWidthRef = useRef(0);
  const viewportMetricsRef = useRef<ViewportMetrics>({
    height: 240,
    top: 0,
  });
  const viewportRenderDataRef = useRef<PreparedViewport | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<SelectionPoint | null>(null);
  const pendingTaskToggleRef = useRef<string | null>(null);
  const handledTaskToggleClickRef = useRef(false);
  const lastEmittedContentRef = useRef(content);
  const canonicalContentRef = useRef("");
  const componentStateRef = useRef(defaultDocumintState);
  const lastFocusVisibilityRequestRef = useRef<FocusVisibilityRequest | null>(null);
  const [hasMountedCanvases, setHasMountedCanvases] = useState(false);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(240);
  const [viewportTop, setViewportTop] = useState(0);
  const [scrollContentHeight, setScrollContentHeight] = useState(240);
  const [preferredTheme, setPreferredTheme] = useState<EditorTheme>(lightEditorTheme);
  const [componentState, setComponentState] = useState(defaultDocumintState);
  const ssrDocument = useMemo(() => parseMarkdown(content), [content]);
  const canonicalSsrContent = useMemo(
    () => serializeMarkdown(ssrDocument),
    [ssrDocument],
  );
  const [editorState, setEditorState] = useState(() => editor.createState(ssrDocument));
  const renderResources = useDocumentImages(editorState.documentEditor.document);
  const hasLoadingImages = useMemo(
    () => [...renderResources.images.values()].some((image) => image.status === "loading"),
    [renderResources],
  );

  editorStateRef.current = editorState;
  canonicalContentRef.current ||= canonicalSsrContent;

  const renderTheme = useMemo(() => theme ?? preferredTheme, [preferredTheme, theme]);
  const layoutWidth = resolveLayoutWidth(surfaceWidth);
  const previewState = useMemo(() => editor.getPreviewState(editorState), [editor, editorState]);
  const commentState = useMemo(() => editor.getCommentState(editorState), [editor, editorState]);
  const normalizedSelection = useMemo(
    () => editor.normalizeSelection(editorState),
    [editor, editorState],
  );
  const absoluteSelection = useMemo(
    () => normalizeSelectionAbsolutePositions(editorState),
    [editorState],
  );
  const activeCommentThreadIndex = useMemo(
    () =>
      resolveActiveCommentThreadIndex(
        absoluteSelection.start,
        absoluteSelection.end,
        commentState.liveRanges,
      ),
    [absoluteSelection.end, absoluteSelection.start, commentState.liveRanges],
  );
  const canEditComments = Boolean(onContentChange);
  const readCurrentState = () => editorStateRef.current ?? editorState;

  const publishState = useEffectEvent((state: typeof editorState, canonicalContent: string) => {
    const nextPreviewState = editor.getPreviewState(state);
    const nextCommentState = editor.getCommentState(state);
    const nextAbsoluteSelection = normalizeSelectionAbsolutePositions(state);
    const nextState: DocumintState = {
      activeBlockType: nextPreviewState.activeBlock?.nodeType ?? null,
      activeCommentThreadIndex: resolveActiveCommentThreadIndex(
        nextAbsoluteSelection.start,
        nextAbsoluteSelection.end,
        nextCommentState.liveRanges,
      ),
      activeSpanKind:
        nextPreviewState.activeSpan.kind === "none" ? null : nextPreviewState.activeSpan.kind,
      canonicalContent,
      characterCount: canonicalContent.length,
      commentThreadCount: nextCommentState.threads.length,
      docChangeCount: perfMetricsRef.current.docChangeCount,
      lastTransactionMs: perfMetricsRef.current.lastTransactionMs,
      layoutWidth: resolveLayoutWidth(surfaceWidthRef.current),
      lineCount: countLines(canonicalContent),
      resolvedCommentCount: countResolvedCommentThreads(nextCommentState.threads),
      selectionFrom: nextAbsoluteSelection.start,
      selectionTo: nextAbsoluteSelection.end,
      transactionCount: perfMetricsRef.current.transactionCount,
    };

    setComponentState((previous) => (areStatesEqual(previous, nextState) ? previous : nextState));

    if (!areStatesEqual(componentStateRef.current, nextState)) {
      componentStateRef.current = nextState;
      onStateChange?.(nextState);
    }
  });

  const applyEditorStateChange = useEffectEvent((stateChange: EditorStateChange | null) => {
    if (!stateChange) {
      return;
    }

    const startedAt = performance.now();
    editorStateRef.current = stateChange.state;
    setEditorState(stateChange.state);
    perfMetricsRef.current = {
      docChangeCount:
        perfMetricsRef.current.docChangeCount + (stateChange.documentChanged ? 1 : 0),
      lastTransactionMs: performance.now() - startedAt,
      transactionCount: perfMetricsRef.current.transactionCount + 1,
    };

    if (stateChange.animationStarted) {
      scheduleRender("viewport");
    }

    if (!stateChange.documentChanged) {
      return;
    }

    const nextDocument = editor.getDocument(stateChange.state);
    const nextContent = serializeMarkdown(nextDocument);

    canonicalContentRef.current = nextContent;
    lastEmittedContentRef.current = nextContent;
    onContentChange?.(nextContent, nextDocument);
  });

  const createViewportRenderData = useEffectEvent((): PreparedViewport => {
    const currentState = editorStateRef.current ?? editorState;
    const viewport = viewportMetricsRef.current;

    return editor.prepareViewport(currentState, {
      height: viewport.height,
      paddingX: renderTheme.paddingX,
      paddingY: renderTheme.paddingY,
      top: viewport.top,
      width: layoutWidth,
    }, renderResources);
  });

  const renderContent = useEffectEvent((renderData = viewportRenderDataRef.current) => {
    if (!renderData) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(contentCanvasRef.current, {
      paintHeight: renderData.paintHeight,
      paintTop: renderData.paintTop,
      width: layoutWidth,
    });

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    editor.paintContent(editorState, renderData, context, {
      activeBlockId: previewState.activeBlock?.blockId ?? null,
      activeRegionId: editorState.selection.focus.regionId,
      activeThreadIndex: hoveredCommentThreadIndex ?? activeCommentThreadIndex,
      devicePixelRatio,
      height,
      liveCommentRanges: commentState.liveRanges,
      normalizedSelection,
      now: performance.now(),
      resources: renderResources,
      theme: renderTheme,
      width,
    });
  });

  const renderOverlay = useEffectEvent((renderData = viewportRenderDataRef.current) => {
    if (!renderData) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(overlayCanvasRef.current, {
      paintHeight: renderData.paintHeight,
      paintTop: renderData.paintTop,
      width: layoutWidth,
    });

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    editor.paintOverlay(editorState, renderData, context, {
      devicePixelRatio,
      height,
      normalizedSelection,
      showCaret:
        normalizedSelection.start.regionId !== normalizedSelection.end.regionId ||
        normalizedSelection.start.offset !== normalizedSelection.end.offset ||
        cursor.isVisible(),
      theme: renderTheme,
      width,
    });
  });

  const renderViewport = useEffectEvent(() => {
    const renderData = createViewportRenderData();

    viewportRenderDataRef.current = renderData;
    setScrollContentHeight((previous) => {
      const nextHeight = Math.max(
        viewportMetricsRef.current.height,
        Math.ceil(renderData.totalHeight + 24),
      );

      return previous === nextHeight ? previous : nextHeight;
    });
    renderContent(renderData);
    renderOverlay(renderData);
  });

  const { scheduleRender } = useRenderScheduler({
    hasRunningAnimations: () =>
      editor.hasRunningAnimations(editorStateRef.current ?? editorState, performance.now()),
    renderContent,
    renderOverlay,
    renderViewport,
  });

  const getViewportRenderData = useEffectEvent(() => {
    const existing = viewportRenderDataRef.current;

    if (existing) {
      return existing;
    }

    const next = createViewportRenderData();

    viewportRenderDataRef.current = next;

    return next;
  });
  const resolvePointerPoint = useEffectEvent(
    (event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>) => {
      const scrollContainer = scrollContainerRef.current;

      return scrollContainer
        ? resolvePointerPointInScrollContainer(event, scrollContainer)
        : null;
    },
  );

  const cursor = useCursor({
    canShowInsertionLeaf: Boolean(onContentChange),
    canShowTableLeaf: Boolean(onContentChange),
    commentState,
    editor,
    editorState,
    onVisibilityChange: () => scheduleRender("overlay"),
    viewport: viewportRenderDataRef.current,
  });
  const hover = useHover({
    commentState,
    editor,
    editorStateRef,
    getViewportRenderData,
    resolveDocumentPoint: resolvePointerPoint,
  });
  const hoveredCommentThreadIndex = hover.leaf?.kind === "comment" ? hover.leaf.threadIndex : null;

  const handleViewportScroll = useEffectEvent((scrollContainer: HTMLDivElement) => {
    const nextViewportMetrics = readViewportMetrics(scrollContainer);

    viewportMetricsRef.current = nextViewportMetrics;
    setViewportTop((previous) =>
      previous === nextViewportMetrics.top ? previous : nextViewportMetrics.top,
    );
    scheduleRender("viewport");
  });

  const handleViewportWheel = useEffectEvent((scrollContainer: HTMLDivElement, event: WheelEvent) => {
    if (scrollContainer.scrollHeight <= scrollContainer.clientHeight || event.deltaY === 0) {
      return;
    }

    const lineHeight = 24;
    const deltaMultiplier =
      event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? scrollContainer.clientHeight : 1;
    const nextTop = Math.max(
      0,
      Math.min(
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
        scrollContainer.scrollTop + event.deltaY * deltaMultiplier,
      ),
    );

    if (nextTop === scrollContainer.scrollTop) {
      return;
    }

    event.preventDefault();
    scrollContainer.scrollTop = nextTop;
    handleViewportScroll(scrollContainer);
  });

  const input = useNativeInput({
    editor,
    editorState,
    editorStateRef,
    getViewportRenderData,
    inputRef,
    onActivity: cursor.markActivity,
    onEditorStateChange: applyEditorStateChange,
  });
  const selection = useSelection({
    autoScrollContainer: (event) => {
      autoScrollSelectionContainer(scrollContainerRef.current, event);
    },
    canShowSelectionLeaf: canEditComments,
    canvasRef: contentCanvasRef,
    threads: commentState.threads,
    editor,
    editorState,
    editorStateRef,
    scrollContainerRef,
    getViewportRenderData,
    onActivity: cursor.markActivity,
    onEditorStateChange: applyEditorStateChange,
  });
  const focusCanvas = useEffectEvent(() => {
    contentCanvasRef.current?.focus({
      preventScroll: true,
    });
  });
  const releaseCanvasPointer = useEffectEvent((pointerId: number) => {
    const canvas = contentCanvasRef.current;

    if (canvas && dragPointerIdRef.current === pointerId) {
      canvas.releasePointerCapture(pointerId);
    }
  });
  const clearCanvasDrag = useEffectEvent(() => {
    dragPointerIdRef.current = null;
    dragAnchorRef.current = null;
  });
  const handleCanvasPointerCancel = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    releaseCanvasPointer(event.pointerId);
    clearCanvasDrag();
    pendingTaskToggleRef.current = null;
    handledTaskToggleClickRef.current = false;
  });
  const handleCanvasPointerDown = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = contentCanvasRef.current;
    const currentState = readCurrentState();
    const point = resolvePointerPoint(event);

    if (!point) {
      return;
    }

    const target = hover.resolveTarget(event);

    if (target?.kind === "task-toggle") {
      event.preventDefault();
      event.stopPropagation();
      pendingTaskToggleRef.current = target.listItemId;
      cursor.markActivity();
      focusCanvas();
      return;
    }

    const hit = editor.resolveSelectionHit(currentState, getViewportRenderData(), point);

    if (!canvas || !hit) {
      return;
    }

    dragPointerIdRef.current = event.pointerId;
    dragAnchorRef.current = {
      offset: hit.offset,
      regionId: hit.regionId,
    };
    cursor.markActivity();
    canvas.setPointerCapture(event.pointerId);
    focusCanvas();
    applyEditorStateChange(
      editor.setSelection(currentState, {
        offset: hit.offset,
        regionId: hit.regionId,
      }),
    );
    input.focusInput();
  });
  const handleCanvasPointerLeave = useEffectEvent(() => {
    hover.canvasHandlers.onPointerLeave();
    handledTaskToggleClickRef.current = false;
  });
  const handleCanvasPointerMove = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    const anchor = dragAnchorRef.current;
    const currentState = readCurrentState();
    const point = resolvePointerPoint(event);

    if (!point) {
      return;
    }

    hover.canvasHandlers.onPointerMove(event);

    if (dragPointerIdRef.current !== event.pointerId || !anchor) {
      return;
    }

    const nextFocus = editor.resolveDragFocus(
      currentState,
      getViewportRenderData(),
      point,
      anchor,
    );

    if (!nextFocus) {
      return;
    }

    cursor.markActivity();
    autoScrollSelectionContainer(scrollContainerRef.current, event);
    applyEditorStateChange(
      editor.setSelection(currentState, {
        anchor,
        focus: nextFocus,
      }),
    );
  });
  const handleCanvasPointerUp = useEffectEvent((event: PointerEvent<HTMLCanvasElement>) => {
    const currentState = readCurrentState();

    releaseCanvasPointer(event.pointerId);

    if (pendingTaskToggleRef.current) {
      const toggled = editor.toggleTaskItem(currentState, pendingTaskToggleRef.current);

      pendingTaskToggleRef.current = null;

      if (toggled) {
        handledTaskToggleClickRef.current = true;
        event.preventDefault();
        event.stopPropagation();
        cursor.markActivity();
        applyEditorStateChange(toggled);
      }
    }

    clearCanvasDrag();
  });
  const handleCanvasClick = useEffectEvent((event: MouseEvent<HTMLCanvasElement>) => {
    if (handledTaskToggleClickRef.current) {
      handledTaskToggleClickRef.current = false;
      pendingTaskToggleRef.current = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (hover.canvasHandlers.onClick(event)) {
      return;
    }

    pendingTaskToggleRef.current = null;
    input.focusInput();
  });
  const handleCanvasDoubleClick = useEffectEvent((event: MouseEvent<HTMLCanvasElement>) => {
    const currentState = readCurrentState();
    const point = resolvePointerPoint(event);
    const target = hover.resolveTarget(event);

    if (!point || target?.kind === "task-toggle") {
      return;
    }

    const selection = editor.resolveWordSelection(currentState, getViewportRenderData(), point);

    if (!selection) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    cursor.markActivity();
    applyEditorStateChange(editor.setSelection(currentState, selection));
    input.focusInput();
  });

  useEffect(() => {
    if (theme) {
      return;
    }

    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      setPreferredTheme(mediaQuery.matches ? darkEditorTheme : lightEditorTheme);
    };

    updateTheme();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateTheme);

      return () => {
        mediaQuery.removeEventListener("change", updateTheme);
      };
    }

    mediaQuery.addListener(updateTheme);

    return () => {
      mediaQuery.removeListener(updateTheme);
    };
  }, [theme]);

  useEffect(() => {
    setHasMountedCanvases(true);
  }, []);

  // Keep viewport sizing inputs in sync with the visible scroll container so
  // layout and paint react to the current editor viewport geometry.
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

      surfaceWidthRef.current = nextSurfaceWidth;
      viewportMetricsRef.current = {
        ...viewportMetricsRef.current,
        height: nextViewportHeight,
      };
      setSurfaceWidth((previous) => (previous === nextSurfaceWidth ? previous : nextSurfaceWidth));
      setViewportHeight((previous) => (previous === nextViewportHeight ? previous : nextViewportHeight));
    });

    observer.observe(scrollContainer);

    return () => {
      observer.disconnect();
    };
  }, [scrollContainerRef, setSurfaceWidth, setViewportHeight, surfaceWidthRef, viewportMetricsRef]);

  useEffect(() => {
    if (content === lastEmittedContentRef.current) {
      return;
    }

    viewportMetricsRef.current = {
      ...viewportMetricsRef.current,
      top: 0,
    };
    const scrollContainer = scrollContainerRef.current;

    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }

    const nextState = editor.createState(ssrDocument);

    editorStateRef.current = nextState;
    setEditorState(nextState);
    lastEmittedContentRef.current = content;
    canonicalContentRef.current = canonicalSsrContent;
  }, [canonicalSsrContent, content, editor, ssrDocument]);

  useEffect(() => {
    publishState(editorState, canonicalContentRef.current || canonicalSsrContent);
  }, [canonicalSsrContent, editorState, publishState, surfaceWidth]);

  // Keep the active selection focus visible when navigation or host resizing
  // moves it out of view, without reacting to unrelated document edits that
  // preserve the current focus.
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const focus = editorState.selection.focus;

    if (!scrollContainer) {
      return;
    }

    const focusVisibilityRequest = {
      layoutWidth,
      offset: focus.offset,
      regionId: focus.regionId,
      viewportHeight,
    };

    if (areFocusVisibilityRequestsEqual(lastFocusVisibilityRequestRef.current, focusVisibilityRequest)) {
      return;
    }

    const padding = 24;
    const caret = editor.measureCaretTarget(editorState, getViewportRenderData(), focus);

    if (!caret) {
      return;
    }

    lastFocusVisibilityRequestRef.current = focusVisibilityRequest;

    const visibleHeight = viewportHeight;
    const visibleTop = scrollContainer.scrollTop + padding;
    const visibleBottom = scrollContainer.scrollTop + visibleHeight - padding;

    if (caret.top < visibleTop) {
      scrollContainer.scrollTop = Math.max(0, caret.top - padding);
      return;
    }

    if (caret.top + caret.height > visibleBottom) {
      scrollContainer.scrollTop = Math.max(0, caret.top + caret.height - visibleHeight + padding);
    }
  }, [
    editor,
    editorState,
    editorState.selection.focus.offset,
    editorState.selection.focus.regionId,
    getViewportRenderData,
    layoutWidth,
    viewportHeight,
  ]);

  useEffect(() => {
    scheduleRender("viewport");
  }, [
    commentState.liveRanges,
    editorState,
    layoutWidth,
    normalizedSelection.end.regionId,
    normalizedSelection.end.offset,
    normalizedSelection.start.regionId,
    normalizedSelection.start.offset,
    previewState.activeBlock?.blockId,
    renderTheme,
    renderResources,
    activeCommentThreadIndex,
    scheduleRender,
    viewportHeight,
  ]);

  useEffect(() => {
    if (!hasLoadingImages) {
      return;
    }

    let frameId: number | null = null;
    const windowObject = window;

    const paintLoadingFrame = () => {
      scheduleRender("viewport");
      frameId = windowObject.requestAnimationFrame(paintLoadingFrame);
    };

    frameId = windowObject.requestAnimationFrame(paintLoadingFrame);

    return () => {
      if (frameId !== null) {
        windowObject.cancelAnimationFrame(frameId);
      }
    };
  }, [hasLoadingImages, scheduleRender]);

  // Hovered comment thread changes only restyle content-layer comment highlights,
  // so they can reuse the prepared viewport and let the scheduler coalesce with
  // any concurrent viewport render.
  useEffect(() => {
    scheduleRender("content");
  }, [hoveredCommentThreadIndex, scheduleRender]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    const nativeHandleWheel = (event: WheelEvent) => {
      handleViewportWheel(scrollContainer, event);
    };

    scrollContainer.addEventListener("wheel", nativeHandleWheel, {
      passive: false,
    });

    return () => {
      scrollContainer.removeEventListener("wheel", nativeHandleWheel);
    };
  }, [handleViewportWheel]);

  const sectionClassName = className
    ? `documint ${className}`
    : "documint";
  const resolveVisibleLeafPresentation = () => {
    const hoveredLeaf = hover.leaf;
    const visibleLeaf = hoveredLeaf ?? selection.leaf ?? cursor.leaf;
    const isSelectionLeafVisible = !hoveredLeaf && Boolean(selection.leaf);
    const scrollContainerBounds = scrollContainerRef.current?.getBoundingClientRect() ?? null;
    const visibleThreadLeaf =
      visibleLeaf?.kind === "thread"
        ? {
            ...visibleLeaf,
            thread: commentState.threads[visibleLeaf.threadIndex] ?? null,
          }
        : null;
    const annotationThreadLeaf =
      visibleLeaf?.kind === "comment"
        ? {
            animateInitialComment: false,
            link: visibleLeaf.link,
            thread: visibleLeaf.thread,
            threadIndex: visibleLeaf.threadIndex,
          }
        : visibleThreadLeaf?.thread
        ? {
            animateInitialComment: visibleThreadLeaf.animateInitialComment ?? false,
            link: null,
            thread: visibleThreadLeaf.thread,
            threadIndex: visibleThreadLeaf.threadIndex,
          }
        : null;
    const visibleLeafStatus: "default" | "resolved" =
      annotationThreadLeaf?.thread && isResolvedCommentThread(annotationThreadLeaf.thread)
        ? "resolved"
        : "default";

    return {
      annotationThreadLeaf,
      visibleLeaf,
      visibleLeafAnchor: visibleLeaf
        ? ({
            container: hostRef.current,
            isSelection: isSelectionLeafVisible,
            left: (scrollContainerBounds?.left ?? 0) + visibleLeaf.left,
            onPointerEnter: hoveredLeaf ? hover.leafHandlers.onPointerEnter : undefined,
            onPointerLeave: hoveredLeaf ? hover.leafHandlers.onPointerLeave : undefined,
            top:
              (scrollContainerBounds?.top ?? 0) +
              visibleLeaf.top -
              viewportTop +
              (isSelectionLeafVisible ? selectionLeafVerticalOffset : 0),
          } satisfies LeafPortalAnchor)
        : undefined,
      visibleLeafClassName: visibleLeaf?.kind === "link" ? "documint-link-leaf" : undefined,
      visibleLeafStatus,
    };
  };
  const {
    annotationThreadLeaf,
    visibleLeaf,
    visibleLeafAnchor,
    visibleLeafClassName,
    visibleLeafStatus,
  } = resolveVisibleLeafPresentation();
  const resolveVisibleLeafContent = () => {
    if (!visibleLeaf) {
      return null;
    }

    switch (visibleLeaf.kind) {
      case "insertion":
        return (
          <InsertionLeaf
            onInsert={(text) => {
              applyEditorStateChange(editor.insertText(readCurrentState(), text));
            }}
            onInsertTable={(columnCount) => {
              applyEditorStateChange(editor.insertTable(readCurrentState(), columnCount));
            }}
          />
        );
      case "table":
        return (
          <TableLeaf
            canDeleteColumn={visibleLeaf.columnCount > 1}
            canDeleteRow={visibleLeaf.rowCount > 1}
            onDeleteColumn={() => {
              applyEditorStateChange(editor.deleteTableColumn(readCurrentState()));
            }}
            onDeleteRow={() => {
              applyEditorStateChange(editor.deleteTableRow(readCurrentState()));
            }}
            onDeleteTable={() => {
              applyEditorStateChange(editor.deleteTable(readCurrentState()));
            }}
            onInsertColumn={(direction) => {
              applyEditorStateChange(editor.insertTableColumn(readCurrentState(), direction));
            }}
            onInsertRow={(direction) => {
              applyEditorStateChange(editor.insertTableRow(readCurrentState(), direction));
            }}
          />
        );
      case "link":
        return (
          <LinkLeaf
            canEdit={canEditComments}
            onDelete={() => {
              const stateUpdate = editor.removeLink(
                readCurrentState(),
                visibleLeaf.regionId,
                visibleLeaf.startOffset,
                visibleLeaf.endOffset,
              );

              if (stateUpdate) {
                applyEditorStateChange(stateUpdate);
              }
            }}
            onSave={(url) => {
              const stateUpdate = editor.updateLink(
                readCurrentState(),
                visibleLeaf.regionId,
                visibleLeaf.startOffset,
                visibleLeaf.endOffset,
                url,
              );

              if (stateUpdate) {
                applyEditorStateChange(stateUpdate);
              }
            }}
            title={visibleLeaf.title}
            url={visibleLeaf.url}
          />
        );
      case "create":
        return (
          <AnnotationLeaf
            activeMarks={visibleLeaf.activeMarks}
            canEdit={canEditComments}
            link={null}
            mode="create"
            onCreateThread={(body) => {
              const currentState = readCurrentState();
              const threadIndex = editor.getDocument(currentState).comments.length;
              const stateUpdate = editor.createCommentThread(
                currentState,
                visibleLeaf.selection,
                body.trim(),
              );

              if (!stateUpdate) {
                return;
              }

              applyEditorStateChange(stateUpdate);
              selection.promoteLeafToThread(threadIndex, true);
            }}
            onToggleBold={() => {
              applyEditorStateChange(editor.dispatchCommand(readCurrentState(), "toggleSelectionBold"));
            }}
            onToggleItalic={() => {
              applyEditorStateChange(editor.dispatchCommand(readCurrentState(), "toggleSelectionItalic"));
            }}
            onToggleStrikethrough={() => {
              applyEditorStateChange(
                editor.dispatchCommand(readCurrentState(), "toggleSelectionStrikethrough"),
              );
            }}
            onToggleUnderline={() => {
              applyEditorStateChange(editor.dispatchCommand(readCurrentState(), "toggleSelectionUnderline"));
            }}
          />
        );
      default:
        return annotationThreadLeaf ? (
          <AnnotationLeaf
            animateInitialComment={annotationThreadLeaf.animateInitialComment}
            canEdit={canEditComments}
            link={annotationThreadLeaf.link}
            mode="thread"
            onDeleteComment={(commentIndex) => {
              applyEditorStateChange(
                editor.deleteComment(readCurrentState(), annotationThreadLeaf.threadIndex, commentIndex),
              );
            }}
            onDeleteThread={() => {
              applyEditorStateChange(
                editor.deleteCommentThread(readCurrentState(), annotationThreadLeaf.threadIndex),
              );
            }}
            onEditComment={(commentIndex, body) => {
              applyEditorStateChange(
                editor.editComment(readCurrentState(), annotationThreadLeaf.threadIndex, commentIndex, body),
              );
            }}
            onReply={(body) => {
              applyEditorStateChange(
                editor.replyToCommentThread(readCurrentState(), annotationThreadLeaf.threadIndex, body),
              );
            }}
            onToggleResolved={() => {
              applyEditorStateChange(
                editor.setCommentThreadResolved(
                  readCurrentState(),
                  annotationThreadLeaf.threadIndex,
                  !isResolvedCommentThread(annotationThreadLeaf.thread),
                ),
              );
            }}
            thread={annotationThreadLeaf.thread}
          />
        ) : null;
    }
  };
  const visibleLeafContent = resolveVisibleLeafContent();

  return (
    <section
      className={sectionClassName}
      data-active-block={componentState.activeBlockType ?? ""}
      data-active-comment-thread={componentState.activeCommentThreadIndex ?? ""}
      data-active-span={componentState.activeSpanKind ?? ""}
      ref={hostRef}
      style={{
        "--documint-leaf-button-bg": renderTheme.leafButtonBackground,
        "--documint-leaf-button-border": renderTheme.leafButtonBorder,
        "--documint-leaf-button-text": renderTheme.leafButtonText,
        "--documint-leaf-accent": renderTheme.leafAccent,
        "--documint-leaf-bg": renderTheme.leafBackground,
        "--documint-leaf-border": renderTheme.leafBorder,
        "--documint-leaf-shadow": renderTheme.leafShadow ?? undefined,
        "--documint-leaf-secondary-text": renderTheme.leafSecondaryText,
        "--documint-leaf-resolved-bg": renderTheme.leafResolvedBackground,
        "--documint-leaf-resolved-border": renderTheme.leafResolvedBorder,
        "--documint-leaf-text": renderTheme.leafText,
        "--documint-selection-handle-bg": renderTheme.selectionHandleBackground,
        "--documint-selection-handle-border": renderTheme.selectionHandleBorder,
        height: "100%",
        minHeight: 0,
      } as CSSProperties}
    >
      <style>{DOCUMINT_EDITOR_STYLES}</style>
      <div
        className="documint-scroll-container"
        onScroll={(event) => {
          handleViewportScroll(event.currentTarget);
        }}
        ref={scrollContainerRef}
        style={{
          height: "100%",
          minHeight: 0,
        }}
      >

        <textarea
          {...input.inputHandlers}
          ref={inputRef}
          autoCapitalize="sentences"
          className="documint-input"
          spellCheck={false}
          tabIndex={-1}
        />

        {/* Scroll content wrapper (this forces a virtualized scroll height for the document, that is only partially rendered) */}
        <div
          className="documint-scroll-content"
          style={{
            height: `${scrollContentHeight}px`,
          }}
        >
          {/* Main content canvas (used for rendering the document viewport) */}
          <canvas
            {...input.canvasHandlers}
            aria-label="Documint editor"
            className="documint-content-canvas"
            style={{
              cursor: hover.cursor,
            }}
            onPointerCancel={handleCanvasPointerCancel}
            onPointerDown={handleCanvasPointerDown}
            onPointerLeave={handleCanvasPointerLeave}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            ref={contentCanvasRef}
            tabIndex={0}
          />

          {/* Overlay canvas (urrently used for rendering the blinking cursor) */}
          <canvas
            aria-hidden="true"
            className="documint-overlay-canvas"
            ref={overlayCanvasRef}
          />

          {/* Selection handles (which we render as DOM rather than in-canvas) */}
          {selection.handles ? (
            <>
              <div
                aria-hidden="true"
                className="documint-selection-handle documint-selection-handle-start"
                style={{
                  left: `${selection.handles.start.left}px`,
                  top: `${selection.handles.start.top}px`,
                }}
                {...selection.startHandleProps}
              >
                <span className="documint-selection-handle-knob" />
              </div>
              <div
                aria-hidden="true"
                className="documint-selection-handle documint-selection-handle-end"
                style={{
                  left: `${selection.handles.end.left}px`,
                  top: `${selection.handles.end.top}px`,
                }}
                {...selection.endHandleProps}
              >
                <span className="documint-selection-handle-knob" />
              </div>
            </>
          ) : null}

          {/* Leaf menu */}
          {visibleLeaf && visibleLeafAnchor ? (
            <LeafPortal
              anchor={visibleLeafAnchor}
              className={visibleLeafClassName}
              status={visibleLeafStatus}
            >
              {visibleLeafContent}
            </LeafPortal>
          ) : null}

        </div>

        {/* SSR fallback */}
        {!hasMountedCanvases ? (
          <div className="documint-fallback">
            <DocumintSsr blocks={ssrDocument.blocks} />
          </div>
        ) : null}

      </div>
    </section>
  );
}

function countLines(content: string) {
  return content.length === 0 ? 0 : content.split("\n").length;
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

function areFocusVisibilityRequestsEqual(
  previous: FocusVisibilityRequest | null,
  next: FocusVisibilityRequest,
) {
  return (
    previous?.layoutWidth === next.layoutWidth &&
    previous.regionId === next.regionId &&
    previous.offset === next.offset &&
    previous.viewportHeight === next.viewportHeight
  );
}

function resolveActiveCommentThreadIndex(
  selectionStart: number,
  selectionEnd: number,
  liveRanges: { end: number; start: number; threadIndex: number }[],
) {
  for (const range of liveRanges) {
    if (selectionStart === selectionEnd) {
      if (selectionStart >= range.start && selectionStart <= range.end) {
        return range.threadIndex;
      }

      continue;
    }

    if (Math.max(selectionStart, range.start) < Math.min(selectionEnd, range.end)) {
      return range.threadIndex;
    }
  }

  return null;
}
