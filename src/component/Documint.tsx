/**
 * Public React host for the canvas editor. The component owns content-format
 * bridging, DOM lifecycle, viewport coordination, and hidden-input plumbing.
 */
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  countResolvedCommentThreads,
  isResolvedCommentThread,
  type Comment,
  type CommentThread,
  type Document,
} from "@/document";
import {
  addComment,
  createEditorState,
  deleteComment,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  deleteThread,
  editComment,
  getCommentState,
  getDocument,
  getSelectionContext,
  hasNewAnimation,
  insertTable,
  insertTableColumn,
  insertTableRow,
  insertText,
  normalizeSelection,
  paintContent,
  paintOverlay,
  removeLink,
  replyToThread,
  resolveThread,
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleUnderline,
  updateLink,
  type EditorState,
} from "@/editor";
import type { DocumentPresence, DocumentUser, DocumintStorage, EditorTheme } from "@/types";
import { PresenceOverlay } from "./overlays/PresenceOverlay";
import { parseMarkdown, serializeMarkdown } from "@/markdown";
import { OverlayPortalProvider } from "./overlays/OverlayPortal";
import { AnnotationLeaf } from "./overlays/leaves/AnnotationLeaf";
import type { CompletionSource } from "./overlays/leaves/core/LeafInput";
import { InsertionLeaf } from "./overlays/leaves/InsertionLeaf";
import { LeafAnchor } from "./overlays/leaves/core/LeafAnchor";
import { LinkLeaf } from "./overlays/leaves/LinkLeaf";
import { TableLeaf } from "./overlays/leaves/TableLeaf";
import { useCursor } from "./hooks/useCursor";
import { useImageHandles } from "./hooks/useImageHandles";
import { useImages } from "./hooks/useImages";
import { usePointer } from "./hooks/usePointer";
import { useInput } from "./hooks/useInput";
import { usePresence } from "./hooks/usePresence";
import { useRenderScheduler } from "./hooks/useRenderScheduler";
import { useSelection } from "./hooks/useSelection";
import { useTheme } from "./hooks/useTheme";
import { useViewport } from "./hooks/useViewport";
import { areStatesEqual, prepareCanvasLayer } from "./lib/canvas";
import { emitDiagnostic } from "./lib/diagnostics";
import { type EditorKeybinding } from "./lib/keybindings";
import { extractMentionedUserIds } from "./lib/mentions";
import { joinUsersAndPresence } from "./lib/presence";
import { normalizeSelectionAbsolutePositions } from "./lib/selection";
import { reconcileExternalContentChange } from "./lib/reconciliation";
import { DocumintSsr } from "./Ssr";
import { DOCUMINT_EDITOR_STYLES } from "./styles";

export type DocumintProps = {
  content: string;
  className?: string;

  theme?: DocumintTheme;
  keybindings?: EditorKeybinding[];
  presence?: DocumentPresence[];
  storage?: DocumintStorage;
  users?: DocumentUser[];

  onContentChanged?: (content: string, document: Document) => void;
  onStateChanged?: (state: DocumintState) => void;
  onCommentChanged?: (change: CommentChange) => void;
};

// Describes a single comment add, edit, or delete. Adds and edits carry the
// resulting comment plus the IDs of any users it mentions (resolved against
// the `users` roster). Deletes carry the comment as it existed just before
// removal, and the thread it was attached to — useful when the deletion was
// the last comment in the thread (the thread itself is gone from the
// post-delete document).
export type CommentChange =
  | {
      kind: "added";
      comment: Comment;
      mentionedUserIds: string[];
      thread: CommentThread;
      threadIndex: number;
    }
  | {
      kind: "edited";
      comment: Comment;
      previousBody: string;
      mentionedUserIds: string[];
      thread: CommentThread;
      threadIndex: number;
    }
  | {
      kind: "deleted";
      comment: Comment;
      thread: CommentThread;
      threadIndex: number;
    };

export type DocumintTheme = EditorTheme | { dark: EditorTheme; light: EditorTheme };

export type DocumintState = {
  activeBlockType: string | null;
  activeCommentThreadIndex: number | null;
  activeSpanKind: string | null;
  canonicalContent: string;
  characterCount: number;
  commentThreadCount: number;
  layoutWidth: number;

  resolvedCommentCount: number;
  selectionFrom: number;
  selectionTo: number;
};

const selectionLeafVerticalOffset = 2;

const defaultDocumintState: DocumintState = {
  activeBlockType: null,
  activeCommentThreadIndex: null,
  activeSpanKind: null,
  canonicalContent: "",
  characterCount: 0,
  commentThreadCount: 0,
  layoutWidth: 0,
  resolvedCommentCount: 0,
  selectionFrom: 0,
  selectionTo: 0,
};

export function Documint({
  className,
  content,
  keybindings,
  onCommentChanged,
  onContentChanged,
  onStateChanged,
  presence,
  storage,
  theme,
  users,
}: DocumintProps) {
  const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const editorStateRef = useRef<EditorState | null>(null);
  const lastEmittedContentRef = useRef(content);
  const canonicalContentRef = useRef("");
  const componentStateRef = useRef(defaultDocumintState);

  const [hasMountedCanvases, setHasMountedCanvases] = useState(false);
  const { theme: preferredTheme, themeStyles } = useTheme(theme);
  const [componentState, setComponentState] = useState(defaultDocumintState);

  const contentDocument = useMemo(() => parseMarkdown(content), [content]);
  const canonicalContent = useMemo(() => serializeMarkdown(contentDocument), [contentDocument]);

  const [editorState, setEditorState] = useState(() => createEditorState(contentDocument));
  const images = useImages(editorState.documentIndex.imageUrls, storage);
  const renderResources = images.resources;

  const hasLoadingImages = useMemo(
    () => [...(renderResources?.images.values() ?? [])].some((image) => image.status === "loading"),
    [renderResources],
  );

  editorStateRef.current = editorState;
  canonicalContentRef.current ||= canonicalContent;

  const viewport = useViewport({
    editorState,
    editorStateRef,
    renderResources,
    theme: preferredTheme,
  });

  const {
    actions: viewportActions,
    props: viewportProps,
    refs: viewportRefs,
    state: viewportState,
  } = viewport;

  const {
    autoScrollDuringDrag,
    getScrollTop,
    observePreparedViewport,
    observeScrollContainer,
    prepareNextPaint,
    reconcileEditorState,
    resolvePoint,
    scrollTo,
  } = viewportActions;

  const {
    layoutWidth,
    preparedViewport,
    scrollContentHeight,
    surfaceWidth,
    viewportHeight,
    viewportTop,
  } = viewportState;

  const { scrollContainer: scrollContainerRef } = viewportRefs;

  const selectionContext = useMemo(() => getSelectionContext(editorState), [editorState]);

  const commentState = useMemo(() => getCommentState(editorState), [editorState]);
  const normalizedSel = useMemo(() => normalizeSelection(editorState), [editorState]);
  // Mention completion is driven entirely off the user roster — independent of
  // who is actively present in the document.
  const mentionSources = useMemo<CompletionSource[] | undefined>(() => {
    if (!users?.length) return undefined;
    return [
      {
        trigger: "@",
        items: users.map((user) => ({ label: user.fullName ?? user.username, id: user.id })),
      },
    ];
  }, [users]);
  const userPresence = useMemo(() => joinUsersAndPresence(users, presence), [users, presence]);
  const activeCommentThreadIndex = useMemo(
    () => resolveActiveCommentThreadIndex(editorState, commentState.liveRanges),
    [commentState.liveRanges, editorState],
  );
  const canEditComments = Boolean(onContentChanged);
  const readCurrentState = () => editorStateRef.current ?? editorState;

  const publishState = useEffectEvent((state: typeof editorState, canonicalContent: string) => {
    const nextSelectionContext = getSelectionContext(state);
    const nextCommentState = getCommentState(state);
    const nextAbsoluteSelection = normalizeSelectionAbsolutePositions(state);
    const nextState: DocumintState = {
      activeBlockType: nextSelectionContext.block?.nodeType ?? null,
      activeCommentThreadIndex: resolveActiveCommentThreadIndex(state, nextCommentState.liveRanges),
      activeSpanKind:
        nextSelectionContext.span.kind === "none" ? null : nextSelectionContext.span.kind,
      canonicalContent,
      characterCount: canonicalContent.length,
      commentThreadCount: nextCommentState.threads.length,
      layoutWidth,
      resolvedCommentCount: countResolvedCommentThreads(nextCommentState.threads),
      selectionFrom: nextAbsoluteSelection.start,
      selectionTo: nextAbsoluteSelection.end,
    };

    setComponentState((previous) => (areStatesEqual(previous, nextState) ? previous : nextState));

    if (!areStatesEqual(componentStateRef.current, nextState)) {
      componentStateRef.current = nextState;
      onStateChanged?.(nextState);
    }
  });

  const applyNextState = useEffectEvent((nextState: EditorState | null) => {
    if (!nextState) {
      return;
    }

    const previousState = editorStateRef.current ?? editorState;
    const documentChanged = previousState.documentIndex !== nextState.documentIndex;
    const animationStarted = hasNewAnimation(previousState, nextState);

    editorStateRef.current = nextState;
    setEditorState(nextState);

    reconcileEditorState(previousState, nextState);

    if (animationStarted) {
      // All editor animations are content-layer effects (block flash,
      // inserted/deleted text fade, list marker pop, punctuation pulse).
      // None affect layout or overlay, so a content paint is sufficient.
      scheduleContentPaint();
    }

    if (!documentChanged) {
      return;
    }

    const nextDocument = getDocument(nextState);
    const nextContent = serializeMarkdown(nextDocument);

    canonicalContentRef.current = nextContent;
    lastEmittedContentRef.current = nextContent;
    onContentChanged?.(nextContent, nextDocument);
  });

  // Comment-changed emitters. Adds and edits read the freshly-applied state
  // for their thread/comment payload; deletes are passed pre-state snapshots
  // by their callers, since the comment is gone from post-state. The thread
  // is never persisted across the call — each callsite either re-reads or
  // captures it for the same reason. All three funnel through
  // `emitCommentChanged` so the diagnostic and host-callback dispatch live
  // in one place.
  const emitCommentChanged = (change: CommentChange) => {
    if (process.env.NODE_ENV !== "production") {
      emitDiagnostic("commentChanged", { ...change });
    }
    onCommentChanged?.(change);
  };

  const emitCommentAdded = (threadIndex: number) => {
    const thread = getDocument(readCurrentState()).comments[threadIndex];
    const comment = thread?.comments.at(-1);
    if (!thread || !comment) return;
    emitCommentChanged({
      kind: "added",
      comment,
      mentionedUserIds: extractMentionedUserIds(comment.body, mentionSources),
      thread,
      threadIndex,
    });
  };

  const emitCommentEdited = (
    threadIndex: number,
    commentIndex: number,
    previousBody: string,
  ) => {
    const thread = getDocument(readCurrentState()).comments[threadIndex];
    const comment = thread?.comments[commentIndex];
    if (!thread || !comment) return;
    emitCommentChanged({
      kind: "edited",
      comment,
      previousBody,
      mentionedUserIds: extractMentionedUserIds(comment.body, mentionSources),
      thread,
      threadIndex,
    });
  };

  const emitCommentDeleted = (
    threadIndex: number,
    thread: CommentThread,
    comment: Comment,
  ) => {
    emitCommentChanged({ kind: "deleted", comment, thread, threadIndex });
  };

  /* Paint callbacks */
  //
  // The render scheduler dispatches into one of these per mode:
  //   - `renderContent` / `renderOverlay` read the cached layout via
  //     `preparedViewport.peek()` — they paint with whatever layout is
  //     currently cached, no recompute.
  //   - `renderViewport` calls `prepareNextPaint()` first, which invalidates
  //     and recomputes the layout, then paints both layers with the fresh
  //     state. This is why "viewport" mode is heavier — the layout cost is
  //     paid only on this path.

  const renderContent = useEffectEvent((viewportState = preparedViewport.peek()) => {
    if (!viewportState) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(contentCanvasRef.current, {
      paintHeight: viewportState.paintHeight,
      paintTop: viewportState.paintTop,
      width: layoutWidth,
    });

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    paintContent(editorState, viewportState, context, {
      activeBlockId: selectionContext.block?.blockId ?? null,
      activeRegionId: editorState.selection.focus.regionId,
      activeThreadIndex: hoveredCommentThreadIndex ?? activeCommentThreadIndex,
      devicePixelRatio,
      height,
      liveCommentRanges: commentState.liveRanges,
      normalizedSelection: normalizedSel,
      now: performance.now(),
      resources: renderResources,
      theme: preferredTheme,
      width,
    });
  });

  const renderOverlay = useEffectEvent((viewportState = preparedViewport.peek()) => {
    if (!viewportState) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(overlayCanvasRef.current, {
      paintHeight: viewportState.paintHeight,
      paintTop: viewportState.paintTop,
      width: layoutWidth,
    });

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    paintOverlay(editorState, viewportState, context, {
      devicePixelRatio,
      height,
      normalizedSelection: normalizedSel,
      presence: presenceController.presence,
      showCaret:
        normalizedSel.start.regionId !== normalizedSel.end.regionId ||
        normalizedSel.start.offset !== normalizedSel.end.offset ||
        cursor.isVisible(),
      theme: preferredTheme,
      width,
    });
  });

  const renderViewport = useEffectEvent(() => {
    const viewportState = prepareNextPaint();

    observePreparedViewport(viewportState);
    presenceController.refreshPresence(viewportState);
    renderContent(viewportState);
    renderOverlay(viewportState);
  });

  const {
    scheduleContentPaint,
    scheduleFullPaint,
    scheduleFullRender,
    scheduleOverlayPaint,
  } = useRenderScheduler({
    editorStateRef,
    renderContent,
    renderOverlay,
    renderViewport,
  });

  const scrollContainerProps = viewportProps.getScrollContainer({
    onScroll: () => scheduleFullRender(),
  });

  const cursor = useCursor({
    canShowInsertionLeaf: Boolean(onContentChanged),
    canShowTableLeaf: Boolean(onContentChanged),
    commentState,
    editorState,
    editorViewportState: preparedViewport,
    getScrollTop,
    layoutWidth,
    onVisibilityChange: scheduleOverlayPaint,
    resources: renderResources,
    scrollContentHeight,
    scrollTo,
    viewportHeight,
  });

  const imageHandle = useImageHandles(cursor.imageAtCursor, editorState, applyNextState);

  const input = useInput({
    applyNextState,
    editorState,
    editorStateRef,
    editorViewportState: preparedViewport,
    inputRef,
    keybindings,
    onActivity: cursor.markActivity,
    onImagePaste: images.persistImage,
  });

  const pointer = usePointer({
    applyNextState,
    autoScrollDuringDrag,
    canvasRef: contentCanvasRef,
    commentState,
    editorStateRef,
    editorViewportState: preparedViewport,
    focusInput: input.focus,
    onActivity: cursor.markActivity,
    readCurrentState,
    resolvePoint,
  });
  const hoveredCommentThreadIndex =
    pointer.leaf?.kind === "comment" ? pointer.leaf.threadIndex : null;

  const handleViewportScroll = useEffectEvent((scrollContainer: HTMLDivElement) => {
    observeScrollContainer(scrollContainer);
    scheduleFullRender();
  });

  const presenceController = usePresence({
    editorState,
    editorStateRef,
    editorViewportState: preparedViewport,
    onViewportScroll: handleViewportScroll,
    scrollContainerRef,
    scheduleOverlayRender: scheduleOverlayPaint,
    userPresence,
  });

  const selection = useSelection({
    applyNextState,
    autoScrollDuringDrag,
    canShowSelectionLeaf: canEditComments,
    editorState,
    editorStateRef,
    editorViewportState: preparedViewport,
    focusInput: input.focus,
    onActivity: cursor.markActivity,
    resolvePoint,
    threads: commentState.threads,
  });

  /* Render loop */

  const activeHandle = selection.handle ?? imageHandle;

  // State changes are translated into render or paint requests on the
  // scheduler, which coalesces them into per-frame work. The four intents
  // map cleanly to the layers each kind of change actually affects:
  //
  //   - `scheduleFullRender()` — recompute layout, paint content + overlay.
  //     For layout-structure changes (document, dimensions, theme).
  //   - `scheduleFullPaint()` — paint content + overlay (cached layout).
  //     For state changes that move the caret AND change content (selection).
  //   - `scheduleContentPaint()` — paint only the content layer.
  //     For changes that only restyle content (comment highlights, animations).
  //   - `scheduleOverlayPaint()` — paint only the overlay layer.
  //     For cursor blink and presence updates. Wired inline to
  //     `useCursor.onVisibilityChange` and `usePresence.scheduleOverlayRender`.
  //
  // Other render triggers in the host live where they're naturally wired:
  //   - `scrollContainerProps.onScroll` → `scheduleFullRender()` on scroll
  //   - `applyNextState` → `scheduleContentPaint()` when an animation starts

  // Layout-affecting changes — fresh layout for paint.
  useEffect(() => {
    scheduleFullRender();
  }, [
    editorState.documentIndex,
    layoutWidth,
    preferredTheme,
    renderResources,
    scheduleFullRender,
    viewportHeight,
  ]);

  // Selection changes — caret moves on overlay, range highlight on content.
  //
  // Future: the selection range highlight (and comment-highlight markers
  // below) sit on the content layer today, which means selection moves and
  // hover-thread changes must repaint content. Conceptually they're user-
  // interaction state — they belong on the overlay alongside the caret.
  // If/when we move them, this effect becomes `scheduleOverlayPaint()`
  // (and the comment effect likewise) and content stays untouched on the
  // hot interaction paths (drag-select, hover). Parked because the move
  // requires reworking the painters to keep selection backgrounds visually
  // under text.
  useEffect(() => {
    scheduleFullPaint();
  }, [
    normalizedSel.end.offset,
    normalizedSel.end.regionId,
    normalizedSel.start.offset,
    normalizedSel.start.regionId,
    scheduleFullPaint,
    selectionContext.block?.blockId,
  ]);

  // Comment-highlight changes — content layer only, no overlay impact.
  // (See note on the selection effect above for the future overlay move.)
  useEffect(() => {
    scheduleContentPaint();
  }, [
    activeCommentThreadIndex,
    commentState.liveRanges,
    hoveredCommentThreadIndex,
    scheduleContentPaint,
  ]);

  // While images are still loading, keep rendering so dimensions update
  // once each image resolves. Loops via rAF until all images settle.
  useEffect(() => {
    if (!hasLoadingImages) {
      return;
    }

    let frameId: number | null = null;
    const windowObject = window;

    const paintLoadingFrame = () => {
      scheduleFullRender();
      frameId = windowObject.requestAnimationFrame(paintLoadingFrame);
    };

    frameId = windowObject.requestAnimationFrame(paintLoadingFrame);

    return () => {
      if (frameId !== null) {
        windowObject.cancelAnimationFrame(frameId);
      }
    };
  }, [hasLoadingImages, scheduleFullRender]);

  /* Leaf presentation */

  // Composes leaf outputs from `usePointer` (hover), `useSelection`
  // (comment-create / thread), and `useCursor` (insertion / table /
  // contextual) into one visible leaf, arbitrating priority and rendering
  // the appropriate leaf component.

  const resolveVisibleLeafPresentation = () => {
    const hoveredLeaf = pointer.leaf;
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
            isSelection: isSelectionLeafVisible,
            left: (scrollContainerBounds?.left ?? 0) + visibleLeaf.left,
            onPointerEnter: hoveredLeaf ? pointer.leafHandlers.onPointerEnter : undefined,
            onPointerLeave: hoveredLeaf ? pointer.leafHandlers.onPointerLeave : undefined,
            top:
              (scrollContainerBounds?.top ?? 0) +
              visibleLeaf.top -
              viewportTop +
              (isSelectionLeafVisible ? selectionLeafVerticalOffset : 0),
          } satisfies LeafAnchor)
        : undefined,
      visibleLeafStatus,
    };
  };
  const { annotationThreadLeaf, visibleLeaf, visibleLeafAnchor, visibleLeafStatus } =
    resolveVisibleLeafPresentation();
  const resolveVisibleLeafContent = () => {
    if (!visibleLeaf) {
      return null;
    }

    switch (visibleLeaf.kind) {
      case "insertion":
        return (
          <InsertionLeaf
            onInsert={(text) => {
              applyNextState(insertText(readCurrentState(), text));
            }}
            onInsertTable={(columnCount) => {
              applyNextState(insertTable(readCurrentState(), columnCount));
            }}
          />
        );
      case "table":
        return (
          <TableLeaf
            canDeleteColumn={visibleLeaf.columnCount > 1}
            canDeleteRow={visibleLeaf.rowCount > 1}
            onDeleteColumn={() => {
              applyNextState(deleteTableColumn(readCurrentState()));
            }}
            onDeleteRow={() => {
              applyNextState(deleteTableRow(readCurrentState()));
            }}
            onDeleteTable={() => {
              applyNextState(deleteTable(readCurrentState()));
            }}
            onInsertColumn={(direction) => {
              applyNextState(insertTableColumn(readCurrentState(), direction));
            }}
            onInsertRow={(direction) => {
              applyNextState(insertTableRow(readCurrentState(), direction));
            }}
          />
        );
      case "link":
        return (
          <LinkLeaf
            canEdit={canEditComments}
            onDelete={() => {
              const stateUpdate = removeLink(
                readCurrentState(),
                visibleLeaf.regionId,
                visibleLeaf.startOffset,
                visibleLeaf.endOffset,
              );

              if (stateUpdate) {
                applyNextState(stateUpdate);
              }
            }}
            onSave={(url) => {
              const stateUpdate = updateLink(
                readCurrentState(),
                visibleLeaf.regionId,
                visibleLeaf.startOffset,
                visibleLeaf.endOffset,
                url,
              );

              if (stateUpdate) {
                applyNextState(stateUpdate);
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
            mentionSources={mentionSources}
            onCreateThread={(body) => {
              const currentState = readCurrentState();
              const threadIndex = getDocument(currentState).comments.length;
              const stateUpdate = addComment(
                currentState,
                visibleLeaf.selection,
                body.trim(),
              );

              if (!stateUpdate) {
                return;
              }

              applyNextState(stateUpdate);
              selection.promoteLeafToThread(threadIndex, true);
              emitCommentAdded(threadIndex);
            }}
            onToggleBold={() => {
              applyNextState(toggleBold(readCurrentState()));
            }}
            onToggleItalic={() => {
              applyNextState(toggleItalic(readCurrentState()));
            }}
            onToggleStrikethrough={() => {
              applyNextState(toggleStrikethrough(readCurrentState()));
            }}
            onToggleUnderline={() => {
              applyNextState(toggleUnderline(readCurrentState()));
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
            mentionSources={mentionSources}
            onDeleteComment={(commentIndex) => {
              const { threadIndex } = annotationThreadLeaf;
              const previousState = readCurrentState();
              const thread = getDocument(previousState).comments[threadIndex];
              const comment = thread?.comments[commentIndex];
              const stateUpdate = deleteComment(previousState, threadIndex, commentIndex);
              if (!stateUpdate) return;
              applyNextState(stateUpdate);
              if (thread && comment) {
                emitCommentDeleted(threadIndex, thread, comment);
              }
            }}
            onDeleteThread={() => {
              const { threadIndex } = annotationThreadLeaf;
              const previousState = readCurrentState();
              const thread = getDocument(previousState).comments[threadIndex];
              const stateUpdate = deleteThread(previousState, threadIndex);
              if (!stateUpdate) return;
              applyNextState(stateUpdate);
              if (thread) {
                for (const comment of thread.comments) {
                  emitCommentDeleted(threadIndex, thread, comment);
                }
              }
            }}
            onEditComment={(commentIndex, body) => {
              const { threadIndex } = annotationThreadLeaf;
              const previousState = readCurrentState();
              const previousBody =
                getDocument(previousState).comments[threadIndex]?.comments[commentIndex]?.body;
              const stateUpdate = editComment(previousState, threadIndex, commentIndex, body);
              if (!stateUpdate) return;
              applyNextState(stateUpdate);
              if (previousBody !== undefined) {
                emitCommentEdited(threadIndex, commentIndex, previousBody);
              }
            }}
            onReply={(body) => {
              const { threadIndex } = annotationThreadLeaf;
              const stateUpdate = replyToThread(readCurrentState(), threadIndex, body);
              if (!stateUpdate) return;
              applyNextState(stateUpdate);
              emitCommentAdded(threadIndex);
            }}
            onToggleResolved={() => {
              applyNextState(
                resolveThread(
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

  /* State machine */

  // Effects that observe editor state changes for purposes other than
  // rendering — emitting state to the host and signaling first paint.

  // Signal first paint so the SSR fallback can yield to the client canvas.
  useEffect(() => {
    setHasMountedCanvases(true);
  }, []);

  // Publish the derived `DocumintState` to host props on every state change.
  useEffect(() => {
    publishState(editorState, canonicalContentRef.current || canonicalContent);
  }, [canonicalContent, editorState, publishState, surfaceWidth]);

  /* Reconciliation */

  // External `content` prop changes — recreate state from the new content
  // while attempting to preserve scroll position and selection.

  useLayoutEffect(() => {
    if (content === lastEmittedContentRef.current) {
      return;
    }

    const previousState = editorStateRef.current;
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createEditorState(contentDocument),
    );
    const nextState = reconciliation.state;
    const nextViewportTop = reconciliation.didReconcile ? getScrollTop() : 0;

    editorStateRef.current = nextState;
    setEditorState(nextState);
    lastEmittedContentRef.current = content;
    canonicalContentRef.current = canonicalContent;
    // The prepared viewport is tied to the previous editor state. Clear it so
    // pre-paint overlay effects measure against the reconciled model instead of
    // briefly hiding handles/leaves when old geometry cannot resolve the new
    // selection. Longer term, the viewport cache should carry enough input
    // metadata to validate itself before reuse.
    scrollTo(nextViewportTop);
  }, [canonicalContent, content, contentDocument, getScrollTop, scrollTo]);

  /* Render */

  const sectionClassName = className ? `documint ${className}` : "documint";

  return (
    <OverlayPortalProvider themeStyles={themeStyles}>
      <section
        className={sectionClassName}
        data-active-block={componentState.activeBlockType ?? ""}
        data-active-comment-thread={componentState.activeCommentThreadIndex ?? ""}
        data-active-span={componentState.activeSpanKind ?? ""}
        style={{ ...themeStyles, height: "100%", minHeight: 0 }}
      >
        <style>{DOCUMINT_EDITOR_STYLES}</style>
        <div
          {...scrollContainerProps}
          className="documint-scroll-container"
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

          <PresenceOverlay
            insetX={preferredTheme.paddingX}
            insetY={preferredTheme.paddingY}
            onSelect={presenceController.scrollToPresence}
            presence={presenceController.presence}
          />

          {/* Scroll content wrapper (this forces a virtualized scroll height for the document, that is only partially rendered) */}
          <div {...viewportProps.scrollContent} className="documint-scroll-content">
            {/* Main content canvas (used for rendering the document viewport) */}
            <canvas
              {...input.canvasHandlers}
              {...pointer.canvasHandlers}
              aria-label="Documint editor"
              className="documint-content-canvas"
              style={{
                cursor: pointer.cursor,
              }}
              ref={contentCanvasRef}
              tabIndex={0}
            />

            {/* Overlay canvas (urrently used for rendering the blinking cursor) */}
            <canvas aria-hidden="true" className="documint-overlay-canvas" ref={overlayCanvasRef} />

            {/* Resize handles — selection and image handles via a unified declarative system */}
            {activeHandle && <>
              <div aria-hidden="true" className="documint-resize-handle" style={{ left: `${activeHandle.start.left}px`, top: `${activeHandle.start.top}px` }} {...activeHandle.start.props}><span className="documint-resize-handle-knob" /></div>
              <div aria-hidden="true" className="documint-resize-handle" style={{ left: `${activeHandle.end.left}px`, top: `${activeHandle.end.top}px` }} {...activeHandle.end.props}><span className="documint-resize-handle-knob" /></div>
            </>}

            {/* Leaf overlay */}
            {visibleLeaf && visibleLeafAnchor ? (
              <LeafAnchor anchor={visibleLeafAnchor} status={visibleLeafStatus}>
                {visibleLeafContent}
              </LeafAnchor>
            ) : null}
          </div>

          {/* SSR fallback */}
          {!hasMountedCanvases ? (
            <div className="documint-fallback">
              <DocumintSsr blocks={contentDocument.blocks} />
            </div>
          ) : null}
        </div>
      </section>
    </OverlayPortalProvider>
  );
}

function resolveActiveCommentThreadIndex(
  state: {
    documentIndex: {
      regions: Array<{
        id: string;
      }>;
    };
    selection: {
      anchor: {
        offset: number;
        regionId: string;
      };
      focus: {
        offset: number;
        regionId: string;
      };
    };
  },
  liveRanges: Array<{
    endOffset: number;
    regionId: string;
    startOffset: number;
    threadIndex: number;
  }>,
) {
  const regionOrderIndex = new Map(
    state.documentIndex.regions.map((region, index) => [region.id, index]),
  );
  const anchorOrder = resolveSelectionPointOrder(
    regionOrderIndex,
    state.selection.anchor.regionId,
    state.selection.anchor.offset,
  );
  const focusOrder = resolveSelectionPointOrder(
    regionOrderIndex,
    state.selection.focus.regionId,
    state.selection.focus.offset,
  );
  const [selectionStart, selectionEnd] =
    anchorOrder <= focusOrder ? [anchorOrder, focusOrder] : [focusOrder, anchorOrder];
  const isCollapsed = anchorOrder === focusOrder;

  for (const range of liveRanges) {
    const rangeStart = resolveSelectionPointOrder(
      regionOrderIndex,
      range.regionId,
      range.startOffset,
    );
    const rangeEnd = resolveSelectionPointOrder(regionOrderIndex, range.regionId, range.endOffset);

    if (isCollapsed) {
      if (selectionStart >= rangeStart && selectionStart <= rangeEnd) {
        return range.threadIndex;
      }

      continue;
    }

    if (Math.max(selectionStart, rangeStart) < Math.min(selectionEnd, rangeEnd)) {
      return range.threadIndex;
    }
  }

  return null;
}

function resolveSelectionPointOrder(
  regionOrderIndex: Map<string, number>,
  regionId: string,
  offset: number,
) {
  return (regionOrderIndex.get(regionId) ?? -1) * 1_000_000 + offset;
}
