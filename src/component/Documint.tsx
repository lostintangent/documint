/**
 * Public React host for the canvas editor. The component owns content-format
 * bridging, DOM lifecycle, viewport coordination, and hidden-input plumbing.
 */
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, type UIEvent } from "react";
import {
  extractPlainTextFromFragment,
  type Comment,
  type CommentThread,
  type Document,
} from "@/document";
import {
  addComment,
  copySelection,
  createEditorState,
  deleteComment,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  deleteThread,
  editComment,
  getDocument,
  hasActiveCommentHighlightsInViewport,
  hasAnimatedDecorationsInViewport,
  insertTable,
  insertTableColumn,
  insertTableRow,
  insertText,
  measureVisualCaretTarget,
  removeLink,
  replyToThread,
  resolveThread,
  setSelection,
  updateLink,
  type EditorPresence,
  type TextRangeTarget,
} from "@/editor";
import { paintContent, paintOverlay } from "@/renderer";
import type { LucideIcon } from "lucide-react";
import type { DocumentPresence, DocumentUser, DocumintStorage, EditorTheme } from "@/types";
import { PresenceOverlay } from "./overlays/PresenceOverlay";
import { parseDocument, serializeDocument } from "@/markdown";
import { OverlayPortalProvider } from "./overlays/OverlayPortal";
import { AnnotationLeaf } from "./overlays/leaves/AnnotationLeaf";
import { CompletionLeaf } from "./overlays/leaves/CompletionLeaf";
import type { CompletionSource } from "./completions/completions";
import { createMentionCompletionSource, emojiCompletionSource } from "./completions/sources";
import { InsertionLeaf } from "./overlays/leaves/InsertionLeaf";
import { LeafAnchor } from "./overlays/leaves/core/LeafAnchor";
import type { LeafResolution } from "./overlays/leaves/core/shared";
import { LinkLeaf } from "./overlays/leaves/LinkLeaf";
import { TableLeaf } from "./overlays/leaves/TableLeaf";
import { useIdle } from "./hooks/useIdle";
import { useCursor } from "./hooks/useCursor";
import { useDocumentCompletions } from "./completions/useDocumentCompletions";
import { useImageHandles } from "./hooks/useImageHandles";
import { useImages } from "./hooks/useImages";
import { usePointer } from "./hooks/usePointer";
import { usePresence } from "./hooks/usePresence";
import { useInput } from "./hooks/useInput";
import { useRenderScheduler } from "./hooks/useRenderScheduler";
import { useSelection } from "./hooks/useSelection";
import { useTheme } from "./hooks/useTheme";
import { useViewport } from "./hooks/useViewport";
import { prepareCanvasLayer } from "./lib/canvas";
import { emitDiagnostic } from "./lib/diagnostics";
import { type EditorInputKeybinding } from "./lib/keybindings";
import { extractMentionedUserIds } from "./lib/mentions";
import { DocumentStorage } from "./lib/storage";
import { reconcileExternalContentChange } from "./lib/reconciliation";
import { resolveMarkdownLineDiff } from "./lib/markdown-line-diff";
import { useDecorations, type DocumintDecoration } from "./hooks/useDecorations";
import {
  activeCommentIndexSprig,
  commentStateSprig,
  createStore,
  DocumintStoreProvider,
  editorStateSprig,
  normalizedSelectionSprig,
  selectionContextSprig,
  type DocumintStore,
  type EditorStateTransition,
  useDocumintStore,
  useEditorCommand,
  useSprig,
} from "./store";
import { DOCUMINT_EDITOR_STYLES } from "./styles";

export type { DocumintDecoration } from "./hooks/useDecorations";

export type DocumintProps = {
  content: string;
  className?: string;

  actions?: DocumintActions;
  theme?: DocumintTheme;
  keybindings?: EditorInputKeybinding[];
  decorations?: readonly DocumintDecoration[];
  presence?: DocumentPresence[];
  storage?: DocumintStorage;
  users?: DocumentUser[];

  onContentChanged?: (content: string, document: Document) => void;
  onCommentChanged?: (change: CommentChange) => void;
  onUserMentioned?: (event: UserMentionEvent) => void;
};

export type DocumintAction<T> = {
  icon: LucideIcon;
  label: string;
  onClick: (arg: T) => void;
};

export type DocumintActions = {
  selection?: DocumintAction<string> | readonly DocumintAction<string>[];
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
      threadId: string;
    }
  | {
      kind: "edited";
      comment: Comment;
      previousBody: string;
      mentionedUserIds: string[];
      thread: CommentThread;
      threadId: string;
    }
  | {
      kind: "deleted";
      comment: Comment;
      thread: CommentThread;
      threadId: string;
    };

export type UserMentionEvent = {
  lineMarkdown: string;
  lineNumber: number;
  userId: string;
};

export type DocumintTheme = EditorTheme | { dark: EditorTheme; light: EditorTheme };

export function Documint({ content, ...props }: DocumintProps) {
  const storeRef = useRef<DocumintStore | null>(null);
  const contentDocument = useMemo(() => parseDocument(content), [content]);

  if (!storeRef.current) {
    storeRef.current = createStore(contentDocument);
  }

  return (
    <DocumintStoreProvider store={storeRef.current}>
      <DocumintHost content={content} {...props} contentDocument={contentDocument} />
    </DocumintStoreProvider>
  );
}

function DocumintHost({
  actions,
  className,
  content,
  keybindings,
  decorations,
  onCommentChanged,
  onContentChanged,
  onUserMentioned,
  presence,
  storage,
  theme,
  users,
  contentDocument,
}: DocumintProps & { contentDocument: Document }) {
  const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastEmittedContentRef = useRef(content);
  const canonicalContentRef = useRef("");
  const store = useDocumintStore();
  const editorState = useSprig(editorStateSprig);

  const { theme: preferredTheme, themeStyles } = useTheme(theme);

  const canonicalContent = useMemo(() => serializeDocument(contentDocument), [contentDocument]);

  const documentStorage = useMemo(() => new DocumentStorage(storage, window), [storage]);
  const images = useImages(documentStorage);
  const renderResources = images.resources;

  const hasLoadingImages = useMemo(
    () => [...(renderResources?.images.values() ?? [])].some((image) => image.status === "loading"),
    [renderResources],
  );

  canonicalContentRef.current ||= canonicalContent;

  const viewport = useViewport({
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
    commitLayout,
    getScrollTop,
    invalidateLayout,
    observeScrollContainer,
    reconcileEditorState,
    resolvePoint,
    scrollTo,
  } = viewportActions;

  const { layoutWidth, layout, viewportHeight, viewportTop } = viewportState;

  const { scrollContainer: scrollContainerRef } = viewportRefs;

  const selectionContext = useSprig(selectionContextSprig);
  const commentState = useSprig(commentStateSprig);
  const normalizedSel = useSprig(normalizedSelectionSprig);
  const isEditable = Boolean(onContentChanged);
  // Completion sources are pure derivations of the host-provided `users`
  // prop — no reactive editor input — so they live as a hook-local memo
  // rather than a sprig. Reference stability relies on `users` itself
  // being reference-stable across renders (an existing host contract).
  const completionSources = useMemo<CompletionSource[]>(() => {
    const mentionSource = createMentionCompletionSource(users);
    return mentionSource ? [mentionSource, emojiCompletionSource] : [emojiCompletionSource];
  }, [users]);
  const documentCompletionSources = useMemo<CompletionSource[] | undefined>(() => {
    return isEditable ? completionSources : undefined;
  }, [completionSources, isEditable]);
  const emitUserMentioned = useEffectEvent(
    ({
      target,
      transition,
      userId,
    }: {
      target: TextRangeTarget;
      transition: EditorStateTransition;
      userId: string;
    }) => {
      // TODO: replace this hook-specific payload plumbing with a general
      // command-effect channel once editor commands can report semantic effects.
      const lineDiff = resolveMarkdownLineDiff(transition, target);

      if (!lineDiff) {
        return;
      }

      const event: UserMentionEvent = {
        ...lineDiff,
        userId,
      };

      if (process.env.NODE_ENV !== "production") {
        emitDiagnostic("userMentioned", { ...event });
      }
      onUserMentioned?.(event);
    },
  );
  const documentCompletions = useDocumentCompletions({
    completionSources: documentCompletionSources,
    enabled: isEditable,
    onMentionAccepted: emitUserMentioned,
  });
  const { commentPresence, resolvedPresence } = usePresence({ presence, users });
  const activeCommentIndex = useSprig(activeCommentIndexSprig);
  const readCurrentState = () => store.editor.getState();
  const { scheduleDecorationsForTransition, textDecorations } = useDecorations({
    contentDocument,
    decorations,
    store,
  });
  const selectionActions = normalizeDocumintActions(actions?.selection);
  const resolveSelectedText = () => {
    const fragment = copySelection(store.editor.getState());

    return fragment ? extractPlainTextFromFragment(fragment) : "";
  };

  const commitEditorCommandTransition = useEffectEvent(
    (transition: EditorStateTransition | null) => {
      if (!transition) {
        return;
      }

      if (transition.source === "external") {
        return;
      }

      reconcileEditorState(transition.previous, transition.next);

      if (transition.hasNewAnimations) {
        // All editor animations are content-layer effects (block flash,
        // text highlight/fade/pulse, block pulse).
        // None affect layout or overlay, so a content paint is sufficient.
        scheduleContentPaint();
      }

      if (!transition.documentChanged) {
        return;
      }

      scheduleDecorationsForTransition(transition);

      const nextDocument = getDocument(transition.next);
      const nextContent = serializeDocument(nextDocument);

      canonicalContentRef.current = nextContent;
      lastEmittedContentRef.current = nextContent;
      onContentChanged?.(nextContent, nextDocument);
    },
  );

  useLayoutEffect(() => {
    return store.editor.subscribe(commitEditorCommandTransition);
  }, [store]);

  const insertTextCommand = useEditorCommand(insertText);
  const insertTableCommand = useEditorCommand(insertTable);
  const deleteTableColumnCommand = useEditorCommand(deleteTableColumn);
  const deleteTableRowCommand = useEditorCommand(deleteTableRow);
  const deleteTableCommand = useEditorCommand(deleteTable);
  const insertTableColumnCommand = useEditorCommand(insertTableColumn);
  const insertTableRowCommand = useEditorCommand(insertTableRow);
  const removeLinkCommand = useEditorCommand(removeLink);
  const updateLinkCommand = useEditorCommand(updateLink);
  const addCommentCommand = useEditorCommand(addComment);
  const deleteCommentCommand = useEditorCommand(deleteComment);
  const deleteThreadCommand = useEditorCommand(deleteThread);
  const editCommentCommand = useEditorCommand(editComment);
  const replyToThreadCommand = useEditorCommand(replyToThread);
  const resolveThreadCommand = useEditorCommand(resolveThread);
  const setSelectionCommand = useEditorCommand(setSelection);

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
      mentionedUserIds: extractMentionedUserIds(comment.body, completionSources),
      thread,
      threadId: thread.id,
    });
  };

  const emitCommentEdited = (threadIndex: number, commentIndex: number, previousBody: string) => {
    const thread = getDocument(readCurrentState()).comments[threadIndex];
    const comment = thread?.comments[commentIndex];
    if (!thread || !comment) return;
    emitCommentChanged({
      kind: "edited",
      comment,
      previousBody,
      mentionedUserIds: extractMentionedUserIds(comment.body, completionSources),
      thread,
      threadId: thread.id,
    });
  };

  const emitCommentDeleted = (thread: CommentThread, comment: Comment) => {
    emitCommentChanged({ kind: "deleted", comment, thread, threadId: thread.id });
  };

  const idle = useIdle({
    onIdle: () => {
      scheduleContentPaint();
    },
  });

  /* Paint callbacks */
  //
  // The render scheduler dispatches into one of these per mode:
  //   - `renderContent` / `renderOverlay` read the latest layout via
  //     `layout.peekLatest()` — they paint with whatever is currently
  //     latest, no recompute. If nothing's latest (just invalidated),
  //     they skip and wait for a full render.
  //   - `renderViewport` calls `commitLayout()`, which resolves the latest
  //     layout (recomputing if invalidated), commits it as the rendered
  //     frame, and fires reactive subscribers. The layout cost is paid
  //     here, not on the lighter paint paths.

  const renderContent = useEffectEvent((layoutState = layout.peekLatest()) => {
    if (!layoutState) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(contentCanvasRef.current, {
      paintHeight: layoutState.paintHeight,
      paintTop: layoutState.paintTop,
      width: layoutWidth,
    });

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    const now = performance.now();

    paintContent(editorState, layoutState, context, {
      activeBlockId: selectionContext.block?.blockId ?? null,
      activeRegionId: editorState.selection.focus.regionId,
      activeThreadIndex: hoveredCommentThreadIndex ?? activeCommentIndex,
      ambientAnimationTime: idle.resolveAnimationTime(now),
      devicePixelRatio,
      height,
      commentRanges: commentState.ranges,
      normalizedSelection: normalizedSel,
      commentPresence,
      now,
      resources: renderResources,
      textDecorations,
      theme: preferredTheme,
      width,
    });
  });

  const renderOverlay = useEffectEvent((layoutState = layout.peekLatest()) => {
    if (!layoutState) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(overlayCanvasRef.current, {
      paintHeight: layoutState.paintHeight,
      paintTop: layoutState.paintTop,
      width: layoutWidth,
    });

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    paintOverlay(editorState, layoutState, context, {
      devicePixelRatio,
      height,
      normalizedSelection: normalizedSel,
      presence: resolvedPresence,
      showCaret:
        normalizedSel.start.regionId !== normalizedSel.end.regionId ||
        normalizedSel.start.offset !== normalizedSel.end.offset ||
        cursor.isVisible(),
      theme: preferredTheme,
      width,
    });
  });

  const renderViewport = useEffectEvent(() => {
    const layoutState = commitLayout();
    renderContent(layoutState);
    renderOverlay(layoutState);
  });

  const { scheduleContentPaint, scheduleFullPaint, scheduleFullRender, scheduleOverlayPaint } =
    useRenderScheduler({
      hasRunningOptionalContentAnimations: () => {
        const layoutState = layout.peekLatest();
        return layoutState
          ? hasAnimatedDecorationsInViewport(editorState, layoutState, textDecorations) ||
              hasActiveCommentHighlightsInViewport(
                layoutState,
                commentState.ranges,
                commentPresence,
              )
          : false;
      },
      isActive: idle.isActive,
      renderContent,
      renderOverlay,
      renderViewport,
    });

  // Sync `useViewport`'s scroll metrics and schedule a render after any
  // scroll position change — whether driven by the user (native scroll event)
  // or programmatically (e.g. offscreen presence navigation). Stable identity
  // via `useEffectEvent` so the listener doesn't re-attach on every render.
  const handleViewportScroll = useEffectEvent((scrollContainer: HTMLDivElement) => {
    observeScrollContainer(scrollContainer);
    scheduleFullRender();
  });
  const handleScrollEvent = useEffectEvent((event: UIEvent<HTMLDivElement>) => {
    handleViewportScroll(event.currentTarget);
  });

  const cursor = useCursor({
    activeAt: idle.activeAt,
    getScrollTop,
    isEditable,
    layoutWidth,
    onVisibilityChange: scheduleOverlayPaint,
    scrollTo,
    viewportHeight,
  });

  const imageHandle = useImageHandles(renderResources);

  const input = useInput({
    enableTouchKeyDown: documentCompletions.leaf !== null,
    inputRef,
    keybindings,
    onActivity: idle.markActive,
    onBeforeInput: documentCompletions.handleBeforeInput,
    onKeyDown: documentCompletions.handleKeyDown,
    onImagePaste: images.persistImage,
  });

  const pointer = usePointer({
    autoScrollDuringDrag,
    canvasRef: contentCanvasRef,
    focusInput: input.focus,
    isEditable,
    onActivity: idle.markActive,
    resolvePoint,
    storage: documentStorage,
  });
  const hoveredCommentThreadIndex =
    pointer.leaf?.kind === "thread" ? pointer.leaf.threadIndex : null;

  const scrollToPresence = useEffectEvent((target: EditorPresence) => {
    if (!target.viewport || target.viewport.status === "unresolved") {
      return;
    }

    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTop = target.viewport.scrollTop;
    handleViewportScroll(scrollContainer);

    // If the presence is comment-attached, then move the end
    // users cursor to the comment in order to activate the thread.
    if (target.commentThreadIndex != null) {
      const range = commentState.ranges.find((r) => r.threadIndex === target.commentThreadIndex);

      if (range) {
        input.focus();
        setSelectionCommand({ regionId: range.regionId, offset: range.startOffset });
      }
    }
  });

  const selection = useSelection({
    autoScrollDuringDrag,
    focusInput: input.focus,
    isEditable,
    onActivity: idle.markActive,
    resolvePoint,
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
  //     For changes that only restyle content (decorations, comment highlights, animations).
  //   - `scheduleOverlayPaint()` — paint only the overlay layer.
  //     For cursor blink and text-cursor presence updates. Wired inline to
  //     `useCursor.onVisibilityChange` and reactive resolved presence changes.
  //
  // Other render triggers in the host live where they're naturally wired:
  //   - `handleViewportScroll` → `scheduleFullRender()` on scroll (native or
  //      programmatic). Inside the resulting `renderViewport` pass,
  //      the viewport store publishes the fresh viewport for reactive consumers.
  //   - editor command transitions → `scheduleContentPaint()` when an
  //     animation starts

  // Layout-affecting changes — invalidate the cache, then schedule a fresh
  // paint. Doc-index changes are reconciled by the store transition bridge;
  // we always invalidate here so the rAF that follows builds against the new
  // state.
  useEffect(() => {
    invalidateLayout();
    scheduleFullRender();
  }, [editorState.documentIndex, layoutWidth, preferredTheme, renderResources, viewportHeight]);

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

  // Decorations and comment-highlight changes — content layer only, no overlay impact.
  // (See note on the selection effect above for the future overlay move.)
  useEffect(() => {
    scheduleContentPaint();
  }, [
    activeCommentIndex,
    commentState.ranges,
    hoveredCommentThreadIndex,
    commentPresence,
    textDecorations,
  ]);

  // Resolved presence affects the overlay canvas and DOM overlay. Comment-thread
  // presence is also handled by the content-layer effect above because it paints
  // comment rules.
  useEffect(() => {
    scheduleOverlayPaint();
  }, [resolvedPresence]);

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

  // Four sources produce candidate leaves (`selection > documentCompletions >
  // pointer > cursor`); the host arbitrates priority, resolves the anchor,
  // and renders one through the portaled `LeafAnchor`. See "Leaf overlay
  // coordination" in component/AGENTS.md.

  const activeLeaf = selection.leaf ?? documentCompletions.leaf ?? pointer.leaf ?? cursor.leaf;

  // Resolve the active leaf's anchor target into pixel geometry against
  // the prepared layout. Returns null when no leaf is active or its
  // anchor falls outside the editor's visible window — the same gate the
  // canvas painter applies to the caret.
  const resolveLeafAnchor = (): LeafResolution | null => {
    if (!activeLeaf) {
      return null;
    }

    const measured = measureVisualCaretTarget(editorState, layout.get(), activeLeaf.anchor);
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
    const hostScrollX = window.scrollX;
    const hostScrollY = window.scrollY;
    // Reference equality picks out the hover case when pointer arbitration
    // leaves it active.
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
      top: (scrollContainerBounds?.top ?? 0) + hostScrollY + anchorBottom - viewportTop,
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
              insertTextCommand(text);
            }}
            onInsertTable={(columnCount) => {
              insertTableCommand(columnCount);
            }}
          />
        );
      case "table":
        return (
          <TableLeaf
            canDeleteColumn={activeLeaf.columnCount > 1}
            canDeleteRow={activeLeaf.rowCount > 1}
            onDeleteColumn={() => {
              deleteTableColumnCommand();
            }}
            onDeleteRow={() => {
              deleteTableRowCommand();
            }}
            onDeleteTable={() => {
              deleteTableCommand();
            }}
            onInsertColumn={(direction) => {
              insertTableColumnCommand(direction);
            }}
            onInsertRow={(direction) => {
              insertTableRowCommand(direction);
            }}
          />
        );
      case "link":
        return (
          <LinkLeaf
            canEdit={isEditable}
            onDelete={() => {
              removeLinkCommand(activeLeaf);
            }}
            onSave={(url) => {
              updateLinkCommand(activeLeaf, url);
            }}
            title={activeLeaf.title}
            url={activeLeaf.url}
          />
        );
      case "annotation": {
        const annotationActions =
          selectionActions.length > 0
            ? selectionActions.map((action) => ({
                icon: action.icon,
                label: action.label,
                onClick: () => {
                  action.onClick(resolveSelectedText());
                },
              }))
            : undefined;

        return (
          <AnnotationLeaf
            canEdit={isEditable}
            formatting={activeLeaf.formatting}
            link={null}
            mode="create"
            completionSources={completionSources}
            onCreateThread={(body) => {
              const currentState = readCurrentState();
              const threadIndex = getDocument(currentState).comments.length;
              const transition = addCommentCommand(activeLeaf.selection, body.trim());

              if (!transition) {
                return;
              }

              selection.promoteLeafToThread(threadIndex, true);
              emitCommentAdded(threadIndex);
            }}
            actions={annotationActions}
          />
        );
      }
      case "thread":
        return (
          <AnnotationLeaf
            animateInitialComment={activeLeaf.animateInitialComment}
            canEdit={isEditable}
            link={activeLeaf.link}
            mode="thread"
            completionSources={completionSources}
            onDeleteComment={(commentIndex) => {
              const { threadIndex } = activeLeaf;
              const previousState = readCurrentState();
              const thread = getDocument(previousState).comments[threadIndex];
              const comment = thread?.comments[commentIndex];
              const transition = deleteCommentCommand(threadIndex, commentIndex);
              if (!transition) return;
              if (thread && comment) {
                emitCommentDeleted(thread, comment);
              }
            }}
            onDeleteThread={() => {
              const { threadIndex } = activeLeaf;
              const previousState = readCurrentState();
              const thread = getDocument(previousState).comments[threadIndex];
              const transition = deleteThreadCommand(threadIndex);
              if (!transition) return;
              if (thread) {
                for (const comment of thread.comments) {
                  emitCommentDeleted(thread, comment);
                }
              }
            }}
            onEditComment={(commentIndex, body) => {
              const { threadIndex } = activeLeaf;
              const previousState = readCurrentState();
              const previousBody =
                getDocument(previousState).comments[threadIndex]?.comments[commentIndex]?.body;
              const transition = editCommentCommand(threadIndex, commentIndex, body);
              if (!transition) return;
              if (previousBody !== undefined) {
                emitCommentEdited(threadIndex, commentIndex, previousBody);
              }
            }}
            onReply={(body) => {
              const { threadIndex } = activeLeaf;
              const transition = replyToThreadCommand(threadIndex, body);
              if (!transition) return;
              emitCommentAdded(threadIndex);
            }}
            onToggleResolved={() => {
              resolveThreadCommand(activeLeaf.threadIndex, !activeLeaf.resolved);
            }}
            presence={commentPresence.get(activeLeaf.threadIndex) ?? null}
            thread={activeLeaf.thread}
          />
        );
      case "completion":
        return <CompletionLeaf {...activeLeaf} />;
    }
  };

  // Skip building the leaf's React tree when no leaf is going to render.
  // Each branch of `resolveLeafContent` allocates several inline callbacks,
  // so this avoids per-frame churn during scrolls that move the cursor
  // leaf's anchor in and out of the viewport.
  const leafContent = leafAnchor ? resolveLeafContent() : null;

  /* State machine */

  // Effects that observe editor state changes for purposes other than rendering.

  /* Reconciliation */

  // External `content` prop changes — recreate state from the new content
  // while attempting to preserve scroll position and selection.

  useLayoutEffect(() => {
    if (content === lastEmittedContentRef.current) {
      return;
    }

    const previousState = store.editor.getState();
    const reconciliation = reconcileExternalContentChange(
      previousState,
      createEditorState(contentDocument),
    );
    const nextState = reconciliation.state;
    const nextViewportTop = reconciliation.didReconcile ? getScrollTop() : 0;
    store.editor.replace(nextState);

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
            onSelect={scrollToPresence}
            presence={resolvedPresence}
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
            {activeHandle && (
              <>
                <div
                  aria-hidden="true"
                  className="documint-resize-handle"
                  style={{
                    left: `${activeHandle.start.left}px`,
                    top: `${activeHandle.start.top}px`,
                  }}
                  {...activeHandle.start.props}
                >
                  <span className="documint-resize-handle-knob" />
                </div>
                <div
                  aria-hidden="true"
                  className="documint-resize-handle"
                  style={{ left: `${activeHandle.end.left}px`, top: `${activeHandle.end.top}px` }}
                  {...activeHandle.end.props}
                >
                  <span className="documint-resize-handle-knob" />
                </div>
              </>
            )}

            {/* Leaf overlay */}
            {leafAnchor ? <LeafAnchor anchor={leafAnchor}>{leafContent}</LeafAnchor> : null}
          </div>
        </div>
      </section>
    </OverlayPortalProvider>
  );
}

function normalizeDocumintActions<T>(
  actions: DocumintAction<T> | readonly DocumintAction<T>[] | undefined,
): readonly DocumintAction<T>[] {
  if (!actions) {
    return [];
  }

  return "onClick" in actions ? [actions] : actions;
}
