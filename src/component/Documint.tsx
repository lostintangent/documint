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
  type UIEvent,
} from "react";
import {
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
  measureVisualCaretTarget,
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
import { parseDocument, serializeDocument } from "@/markdown";
import { OverlayPortalProvider } from "./overlays/OverlayPortal";
import { AnnotationLeaf } from "./overlays/leaves/AnnotationLeaf";
import type { CompletionSource } from "./overlays/leaves/core/LeafInput";
import { InsertionLeaf } from "./overlays/leaves/InsertionLeaf";
import { LeafAnchor } from "./overlays/leaves/core/LeafAnchor";
import type { LeafResolution } from "./overlays/leaves/core/shared";
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
import { prepareCanvasLayer } from "./lib/canvas";
import { emitDiagnostic } from "./lib/diagnostics";
import { type EditorKeybinding } from "./lib/keybindings";
import { extractMentionedUserIds } from "./lib/mentions";
import { joinUsersAndPresence } from "./lib/presence";
import { DocumentStorage } from "./lib/storage";
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

export function Documint({
  className,
  content,
  keybindings,
  onCommentChanged,
  onContentChanged,
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

  const [hasMountedCanvases, setHasMountedCanvases] = useState(false);
  const { theme: preferredTheme, themeStyles } = useTheme(theme);

  const contentDocument = useMemo(() => parseDocument(content), [content]);
  const canonicalContent = useMemo(() => serializeDocument(contentDocument), [contentDocument]);

  const [editorState, setEditorState] = useState(() => createEditorState(contentDocument));
  const documentStorage = useMemo(
    () => new DocumentStorage(storage, typeof window !== "undefined" ? window : null),
    [storage],
  );
  const images = useImages(editorState.documentIndex.imageUrls, documentStorage);
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
    invalidatePreparedLayout,
    observePreparedViewport,
    observeScrollContainer,
    reconcileEditorState,
    resolvePoint,
    scrollTo,
  } = viewportActions;

  const {
    layoutWidth,
    preparedViewport,
    scrollContentHeight,
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
    const nextContent = serializeDocument(nextDocument);

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
  //   - `renderViewport` reads via `preparedViewport.get()`, which returns
  //     the cached layout or recomputes if it was invalidated by an
  //     earlier signal (scroll, doc-change reconcile, or the layout-
  //     affecting effect below). The layout cost is paid here, not on
  //     the lighter paint paths.

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
    const viewportState = preparedViewport.get();

    observePreparedViewport(viewportState);
    presenceController.refreshPresence(viewportState);
    cursor.refreshCaretViewportStatus(viewportState);
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

  // Sync `useViewport`'s scroll metrics and schedule a render after any
  // scroll position change — whether driven by the user (native scroll event)
  // or programmatically (e.g. `usePresence.scrollToPresence`). Stable identity
  // via `useEffectEvent` so the listener doesn't re-attach on every render.
  const handleViewportScroll = useEffectEvent((scrollContainer: HTMLDivElement) => {
    observeScrollContainer(scrollContainer);
    scheduleFullRender();
  });
  const handleScrollEvent = useEffectEvent((event: UIEvent<HTMLDivElement>) => {
    handleViewportScroll(event.currentTarget);
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
    storage: documentStorage,
  });
  const hoveredCommentThreadIndex =
    pointer.leaf?.kind === "thread" ? pointer.leaf.threadIndex : null;

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
  //   - `handleViewportScroll` → `scheduleFullRender()` on scroll (native or
  //      programmatic). Inside the resulting `renderViewport` pass,
  //      `presence.refreshPresence` and `cursor.refreshCaretViewportStatus`
  //      both project against the fresh layout and only setState when their
  //      visibility flag flips, so steady-state scrolls stay free.
  //   - `applyNextState` → `scheduleContentPaint()` when an animation starts

  // Layout-affecting changes — invalidate the cache, then schedule a fresh
  // paint. Doc-index changes are reconciled inside `applyNextState` (which
  // can keep the cache when the focus region is still indexed); we always
  // invalidate here so the rAF that follows builds against the new state.
  useEffect(() => {
    invalidatePreparedLayout();
    scheduleFullRender();
  }, [
    editorState.documentIndex,
    layoutWidth,
    preferredTheme,
    renderResources,
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
  }, [hasLoadingImages]);

  /* Leaf presentation */

  // Three hooks produce candidate leaves (`pointer > selection > cursor`);
  // the host arbitrates priority, resolves the anchor, and renders one
  // through the portaled `LeafAnchor`. See "Leaf overlay coordination" in
  // component/AGENTS.md.

  const activeLeaf = pointer.leaf ?? selection.leaf ?? cursor.leaf;

  // Resolve the active leaf's anchor target into pixel geometry against
  // the prepared layout. Returns null when no leaf is active or its
  // anchor falls outside the editor's visible window — the same gate the
  // canvas painter applies to the caret.
  const resolveLeafAnchor = (): LeafResolution | null => {
    if (!activeLeaf) {
      return null;
    }

    const measured = measureVisualCaretTarget(
      editorState,
      preparedViewport.get(),
      activeLeaf.anchor,
    );
    if (!measured) {
      return null;
    }

    const anchorBottom = measured.top + measured.height;
    const viewportBottom = viewportTop + viewportHeight;
    if (anchorBottom <= viewportTop || anchorBottom >= viewportBottom) {
      return null;
    }

    // Doc-absolute coords let the browser handle host-page scrolls
    // (including iOS keyboard auto-scroll) without window listeners. The
    // host-rect read is gated by the early-returns above so it doesn't
    // run on idle paint frames.
    const scrollContainerBounds = scrollContainerRef.current?.getBoundingClientRect();
    const hostScrollX = typeof window !== "undefined" ? window.scrollX : 0;
    const hostScrollY = typeof window !== "undefined" ? window.scrollY : 0;
    // `pointer.leaf` always wins priority, so when it's the active leaf,
    // reference equality picks out the hover case.
    const isHoverLeaf = activeLeaf === pointer.leaf;

    return {
      anchorHeight: measured.height,
      // Hover leaves want the bridge for pointer hand-off (see styles.css).
      bridge: isHoverLeaf,
      left:
        (scrollContainerBounds?.left ?? 0) +
        hostScrollX +
        (activeLeaf.leftOverride ?? measured.left),
      onPointerEnter: isHoverLeaf ? pointer.leafHandlers.onPointerEnter : undefined,
      onPointerLeave: isHoverLeaf ? pointer.leafHandlers.onPointerLeave : undefined,
      paddingY: activeLeaf.paddingY ?? 0,
      top:
        (scrollContainerBounds?.top ?? 0) + hostScrollY + anchorBottom - viewportTop,
    };
  };
  const leafAnchor = resolveLeafAnchor();

  const resolveLeafContent = () => {
    if (!activeLeaf) {
      return null;
    }

    switch (activeLeaf.kind) {
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
            canDeleteColumn={activeLeaf.columnCount > 1}
            canDeleteRow={activeLeaf.rowCount > 1}
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
                activeLeaf.regionId,
                activeLeaf.startOffset,
                activeLeaf.endOffset,
              );

              if (stateUpdate) {
                applyNextState(stateUpdate);
              }
            }}
            onSave={(url) => {
              const stateUpdate = updateLink(
                readCurrentState(),
                activeLeaf.regionId,
                activeLeaf.startOffset,
                activeLeaf.endOffset,
                url,
              );

              if (stateUpdate) {
                applyNextState(stateUpdate);
              }
            }}
            title={activeLeaf.title}
            url={activeLeaf.url}
          />
        );
      case "annotation":
        return (
          <AnnotationLeaf
            activeMarks={activeLeaf.activeMarks}
            canEdit={canEditComments}
            link={null}
            mode="create"
            mentionSources={mentionSources}
            onCreateThread={(body) => {
              const currentState = readCurrentState();
              const threadIndex = getDocument(currentState).comments.length;
              const stateUpdate = addComment(
                currentState,
                activeLeaf.selection,
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
      case "thread":
        return (
          <AnnotationLeaf
            animateInitialComment={activeLeaf.animateInitialComment}
            canEdit={canEditComments}
            link={activeLeaf.link}
            mode="thread"
            mentionSources={mentionSources}
            onDeleteComment={(commentIndex) => {
              const { threadIndex } = activeLeaf;
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
              const { threadIndex } = activeLeaf;
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
              const { threadIndex } = activeLeaf;
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
              const { threadIndex } = activeLeaf;
              const stateUpdate = replyToThread(readCurrentState(), threadIndex, body);
              if (!stateUpdate) return;
              applyNextState(stateUpdate);
              emitCommentAdded(threadIndex);
            }}
            onToggleResolved={() => {
              applyNextState(
                resolveThread(
                  readCurrentState(),
                  activeLeaf.threadIndex,
                  !activeLeaf.resolved,
                ),
              );
            }}
            thread={activeLeaf.thread}
          />
        );
    }
  };
  
  // Skip building the leaf's React tree when no leaf is going to render.
  // Each branch of `resolveLeafContent` allocates several inline callbacks,
  // so this avoids per-frame churn during scrolls that move the cursor
  // leaf's anchor in and out of the viewport.
  const leafContent = leafAnchor ? resolveLeafContent() : null;

  /* State machine */

  // Effects that observe editor state changes for purposes other than
  // rendering — emitting state to the host and signaling first paint.

  // Signal first paint so the SSR fallback can yield to the client canvas.
  useEffect(() => {
    setHasMountedCanvases(true);
  }, []);

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
  }, [canonicalContent, content, contentDocument]);

  /* Render */

  const sectionClassName = className ? `documint ${className}` : "documint";

  return (
    <OverlayPortalProvider themeStyles={themeStyles}>
      <section
        className={sectionClassName}
        style={{ ...themeStyles, height: "100%", minHeight: 0 }}
      >
        <style>{DOCUMINT_EDITOR_STYLES}</style>
        <div
          ref={scrollContainerRef}
          onScroll={handleScrollEvent}
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
            // Disable visual wrapping so the prefix context (up to ~1KB of
            // characters before the caret, kept for dictation/IME) lives on
            // a single line in the textarea's internal layout. With the
            // default soft wrap, a 2px-wide textarea would wrap that prefix
            // into a vertical column of one character per line, and the OS
            // would draw caret-adjacent UI (autocorrect "revert" bubbles,
            // IME windows, dictation indicators) anchored to the corrected
            // word's content-coordinate position — which lands far above
            // the visible caret on screen. With wrap="off", content stays
            // on the caret's line so those overlays sit adjacent to the
            // visible caret like they do for normal inputs.
            wrap="off"
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
            {leafAnchor ? <LeafAnchor anchor={leafAnchor}>{leafContent}</LeafAnchor> : null}
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

