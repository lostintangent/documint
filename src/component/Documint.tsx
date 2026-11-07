/**
 * Public React host for the canvas editor. The component owns content-format
 * bridging, DOM lifecycle, viewport coordination, and hidden-input plumbing.
 */
import { compileEditorStyles } from "@macros/editor-styles" with { type: "macro" };
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import {
  extractPlainTextFromFragment,
  isResolvedCommentThread,
  type Comment,
  type CommentThread,
} from "@/document";
import {
  addComment,
  copySelection,
  deleteComment,
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  deleteThread,
  editComment,
  getCommentState,
  hasActiveCommentHighlightsInViewport,
  hasActiveResourcesInViewport,
  hasAnimatedDecorationsInViewport,
  insertTableColumn,
  insertTableRow,
  isMetadataPath,
  moveCaretToDocumentBoundary,
  removeLink,
  replyToThread,
  resolveThread,
  setSelection,
  updateLink,
  type EditorPresence,
  type DocumentPresence,
  type DocumentResourceReference,
  type DocumentUser,
} from "@/editor";
import {
  createDocumentFrame,
  createOverlayFrame,
  paintDocumentFrame,
  paintOverlayFrame,
  type RendererEffect,
  type DocumintEffects,
  type EditorTheme,
} from "@/renderer";
import type { LucideIcon } from "lucide-react";
import type { CodeGrammarRule } from "./decorations/grammars";
import type { DocumintDecoration } from "./decorations/shared";
import type { MarkdownOptions } from "@/markdown";
import { OverlayPortalProvider } from "./overlays/OverlayPortal";
import { AnnotationLeaf } from "./overlays/leaves/AnnotationLeaf";
import { CompletionLeaf } from "./overlays/leaves/CompletionLeaf";
import type { CompletionSource } from "./completions/completions";
import { createMentionCompletionSource, emojiCompletionSource } from "./completions/sources";
import { InsertionLeaf } from "./overlays/leaves/InsertionLeaf";
import { DocumentLeafAnchor } from "./overlays/anchors/DocumentLeafAnchor";
import { ViewportAnchor } from "./overlays/anchors/ViewportAnchor";
import { LinkLeaf } from "./overlays/leaves/LinkLeaf";
import { SearchLeaf } from "./overlays/leaves/SearchLeaf";
import { TableLeaf } from "./overlays/leaves/TableLeaf";
import { useIdle } from "./hooks/useIdle";
import { useCursor } from "./hooks/useCursor";
import { useDocumentCompletions } from "./completions/useDocumentCompletions";
import { useImages } from "./hooks/useImages";
import { usePointer } from "./hooks/usePointer";
import { usePresence } from "./hooks/usePresence";
import {
  useResourceProtocols,
  useResources,
  createActiveResourceKey,
  resourceProtocolNamesFromKey,
  type ActiveResourceSet,
  type ResolvedResourceProtocols,
  type ResourceProtocolRecord,
} from "./hooks/useResources";
import { useInput } from "./hooks/useInput";
import { useRender } from "./hooks/useRender";
import { useSelection } from "./hooks/useSelection";
import { useSearch } from "./hooks/useSearch";
import { useScrollbar } from "./hooks/useScrollbar";
import { useTheme } from "./hooks/useTheme";
import { useViewport } from "./hooks/useViewport";
import { prepareCanvasLayer } from "./lib/canvas";
import { emitDiagnostic, emitRenderFrame } from "./lib/diagnostics";
import { type EditorInputKeybinding } from "./lib/keybindings";
import { extractMentionedUserIds } from "./lib/mentions";
import { DocumentStorage, type DocumintStorage } from "./lib/storage";
import { useDecorations } from "./decorations/useDecorations";
import { builtinGrammars } from "./decorations/grammars";
import { useDocumentSync, useDocumentView, type DocumentView, type UserMentionEvent } from "./sync";
import {
  activeCommentIndexSprig,
  commentRangesSprig,
  createStore,
  DocumintStoreProvider,
  editorStateSprig,
  normalizedSelectionSprig,
  selectionContextSprig,
  type EditorStateTransition,
  useDocumintStore,
  useEditorCommand,
  useSprig,
} from "./store";

const editorCss = process.env.NODE_ENV === "test" ? "" : compileEditorStyles();
export type { ActiveResourceSet, ResourceProtocolRecord } from "./hooks/useResources";
export type { UserMentionEvent } from "./sync";

export type ResizeHandle = {
  end: {
    left: number;
    props: HTMLAttributes<HTMLDivElement>;
    top: number;
  };
  start: {
    left: number;
    props: HTMLAttributes<HTMLDivElement>;
    top: number;
  };
};

export type DocumintProps = {
  content: string;
  previousContent?: string;
  className?: string;

  actions?: DocumintActions;
  theme?: EditorTheme;
  keybindings?: EditorInputKeybinding[];
  decorations?: readonly DocumintDecoration[];
  // Extra/override code grammars, merged over the built-ins (markdown, JS/TS);
  // `null` disables code highlighting. Re-tokenization keys on grammar content
  // and theme colors (not object identity), but pass a memoized reference to
  // avoid recomputing that key every render.
  grammars?: Record<string, readonly CodeGrammarRule[]> | null;
  effects?: DocumintEffects;
  presence?: DocumentPresence[];
  protocols?: ResourceProtocolRecord;
  resources?: ActiveResourceSet;
  readOnly?: boolean;
  showDiffs?: boolean;
  storage?: DocumintStorage;
  users?: DocumentUser[];

  onContentChanged?: (content: string) => void;
  onCommentChanged?: (change: CommentChange) => void;
  onResourceOpened?: (resource: DocumentResourceReference) => void;
  onResourcesRequested?: (resources: readonly DocumentResourceReference[]) => void;
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
// resulting comment plus the IDs of the users it visibly mentions: bare
// `@Name` text resolved against the `users` roster or explicit `@[Name](id)`
// mentions, never text inside code. Deletes carry the comment as it existed
// just before removal, and the thread it was attached to — useful when the
// deletion was the last comment in the thread (the thread itself is gone from
// the post-delete document).
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

export function Documint({ content, previousContent, ...props }: DocumintProps) {
  const resourceProtocols = useResourceProtocols(props.protocols);
  const markdownOptions = useMemo<MarkdownOptions>(
    () => ({ resourceProtocols: resourceProtocolNamesFromKey(resourceProtocols.key) }),
    // The canonical key is the semantic parser input. Depending on the map
    // would reparse content when a host recreates an equivalent registry.
    [resourceProtocols.key],
  );
  const documentView = useDocumentView({
    canChangeContent: Boolean(props.onContentChanged),
    content,
    markdownOptions,
    previousContent,
    readOnly: props.readOnly ?? false,
    showDiffs: props.showDiffs ?? true,
  });

  const [store] = useState(() => createStore(documentView.document));

  return (
    <DocumintStoreProvider store={store}>
      <DocumintHost
        content={content}
        {...props}
        documentView={documentView}
        markdownOptions={markdownOptions}
        resourceProtocols={resourceProtocols}
      />
    </DocumintStoreProvider>
  );
}

function DocumintHost({
  actions,
  className,
  content,
  keybindings,
  decorations,
  grammars,
  effects,
  onCommentChanged,
  onContentChanged,
  onResourceOpened,
  onResourcesRequested,
  onUserMentioned,
  presence,
  resources,
  storage,
  theme,
  users,
  documentView,
  markdownOptions,
  resourceProtocols,
}: DocumintProps & {
  documentView: DocumentView;
  markdownOptions: MarkdownOptions;
  resourceProtocols: ResolvedResourceProtocols;
}) {
  const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const store = useDocumintStore();
  const editorState = useSprig(editorStateSprig);

  const { theme: resolvedTheme, themeStyles } = useTheme(theme);
  const { canMutateComments, readOnly, showActiveBlockHighlight, showReviewChrome } = documentView;

  const documentStorage = useMemo(() => new DocumentStorage(storage, window), [storage]);
  const resourceRegistry = useResources({
    onResourcesRequested,
    resourceProtocols,
    resources,
  });
  const { hasLoadingImages, imageHandle, persistImage, renderResources } = useImages(
    readOnly,
    documentStorage,
    resourceRegistry,
  );
  const activeResourceKey = createActiveResourceKey(resourceRegistry.active);

  const {
    autoScrollDuringDrag,
    commitLayout,
    getScrollTop,
    layout,
    resolvePoint,
    scrollContainerRef,
    scrollContentHeight,
    scrollTo,
    syncScrollContainer,
    viewportHeight,
    viewportTop,
    viewportWidth,
  } = useViewport({
    metadataExpanded,
    renderResources,
    theme: resolvedTheme,
  });

  const selectionContext = useSprig(selectionContextSprig);
  const commentRanges = useSprig(commentRangesSprig);
  const normalizedSel = useSprig(normalizedSelectionSprig);

  // Completion sources are pure derivations of the host-provided `users`
  // prop — no reactive editor input — so they live as a hook-local memo
  // rather than a sprig. Reference stability relies on `users` itself
  // being reference-stable across renders (an existing host contract).
  const completionSources = useMemo<CompletionSource[]>(() => {
    const mentionSource = createMentionCompletionSource(users);
    return mentionSource ? [mentionSource, emojiCompletionSource] : [emojiCompletionSource];
  }, [users]);
  const {
    emitContentChanged,
    emitUserMentioned,
    documentChanges,
    effects: syncEffects,
  } = useDocumentSync({
    content,
    documentView,
    editorDocument: editorState.documentIndex.document,
    markdownOptions,
    onContentChanged,
    onUserMentioned,
    store,
  });
  const documentCompletions = useDocumentCompletions({
    completionSources,
    enabled: !readOnly,
    onMentionAccepted: emitUserMentioned,
  });
  const { commentPresence, resolvedPresence } = usePresence({ presence, users });
  const activeCommentIndex = useSprig(activeCommentIndexSprig, readOnly);
  const resolvedGrammars = grammars === null ? null : { ...builtinGrammars, ...grammars };
  const { textDecorations } = useDecorations({
    decorations,
    grammars: resolvedGrammars,
    store,
    theme: resolvedTheme,
  });
  const search = useSearch();
  const selectionActions = normalizeDocumintActions(actions?.selection);
  const resolveSelectedText = () => {
    const fragment = copySelection(store.editor.getState());

    return fragment ? extractPlainTextFromFragment(fragment) : "";
  };

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
  const moveCaretToDocumentBoundaryCommand = useEditorCommand(moveCaretToDocumentBoundary);
  const toggleMetadata = useEffectEvent(() => {
    const state = store.editor.getState();

    if (metadataExpanded && isMetadataPath(state.selection.focus.path)) {
      moveCaretToDocumentBoundaryCommand("start");
    }

    setMetadataExpanded((expanded) => !expanded);
  });

  // Comment-changed emitters. Adds and edits read the latest store state for
  // their payload rather than the transition's, since a host's
  // `onContentChanged` can replace content before the command returns.
  // Deletes are passed the thread from the transition's previous state,
  // since the comment is gone afterward. All three funnel through
  // `emitCommentChanged` so the diagnostic and host-callback dispatch live
  // in one place.
  const emitCommentChanged = (change: CommentChange) => {
    if (process.env.NODE_ENV !== "production") {
      emitDiagnostic("commentChanged", { ...change });
    }
    onCommentChanged?.(change);
  };

  const emitCommentAdded = (threadIndex: number) => {
    const thread = getCommentState(store.editor.getState().documentIndex).threads[threadIndex];
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
    const thread = getCommentState(store.editor.getState().documentIndex).threads[threadIndex];
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

  const idle = useIdle();
  const scrollbar = useScrollbar();

  const input = useInput({
    canvasRef: contentCanvasRef,
    enableTouchKeyDown: documentCompletions.leaf !== null || search.leaf !== null,
    inputRef,
    keybindings,
    markdownOptions,
    onActivity: idle.markActive,
    onBeforeInput: documentCompletions.handleBeforeInput,
    onKeyDown: (event) => search.handleKeyDown(event) || documentCompletions.handleKeyDown(event),
    onImagePaste: persistImage,
    readOnly,
  });

  const cursor = useCursor({
    activeAt: idle.activeAt,
    focused: input.focused,
    getScrollTop,
    readOnly,
    scrollTo,
    viewportWidth,
    viewportHeight,
  });

  // Return focus to the editor's input bridge when search closes, so the
  // user can keep typing from the (now collapsed) match position without an
  // intermediate click. Owned by the host because of the hook-ordering
  // cycle between `useSearch` (needs `input.focus`) and `useInput` (needs
  // `search.handleKeyDown`) — the host watches the open→closed transition
  // and refocuses after the fact.
  const restoreEditorFocus = useEffectEvent(() => input.focus());
  const wasSearchOpenRef = useRef(false);
  const isSearchOpen = search.leaf !== null;
  useEffect(() => {
    if (wasSearchOpenRef.current && !isSearchOpen) {
      restoreEditorFocus();
    }
    wasSearchOpenRef.current = isSearchOpen;
  }, [isSearchOpen]);

  const pointer = usePointer({
    autoScrollDuringDrag,
    canvasRef: contentCanvasRef,
    focusInput: input.focus,
    onActivity: idle.markActive,
    onMetadataToggle: toggleMetadata,
    onResourceOpened,
    readOnly,
    resolvePoint,
    storage: documentStorage,
  });

  const hoveredCommentThreadIndex =
    pointer.leaf?.kind === "thread" ? pointer.leaf.threadIndex : null;

  /* Paint callbacks */
  //
  // The render scheduler calls `commitLayout()` first on a full render, which
  // resolves the latest layout (recomputing if invalidated), commits it as the
  // rendered frame, and fires reactive subscribers. The layout cost is paid
  // there, not on the lighter paint paths. Both painters read the latest layout
  // via `layout.peekLatest()` without recomputing. If nothing's latest (just
  // invalidated), they skip and wait for a full render.

  const renderContent = useEffectEvent((rendererEffects: readonly RendererEffect[]) => {
    const layoutState = layout.peekLatest();
    if (!layoutState) {
      return rendererEffects;
    }

    const preparedLayer = prepareCanvasLayer(contentCanvasRef.current, layoutState, viewportWidth);

    if (!preparedLayer) {
      return rendererEffects;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    const now = performance.now();

    const frame = createDocumentFrame(editorState, layoutState, {
      activeBlockPath: showActiveBlockHighlight
        ? (selectionContext.block?.blockPath ?? null)
        : null,
      activePath: editorState.selection.focus.path,
      activeThreadIndex: hoveredCommentThreadIndex ?? activeCommentIndex,
      ambientTime: idle.resolveAnimationTime(now),
      devicePixelRatio,
      effects: rendererEffects,
      documentChanges,
      height,
      commentRanges,
      normalizedSelection: normalizedSel,
      commentPresence,
      customEffects: effects,
      now,
      resources: renderResources,
      textDecorations,
      theme: resolvedTheme,
      width,
    });

    paintDocumentFrame(context, frame);
    if (process.env.NODE_ENV !== "production" && contentCanvasRef.current) {
      emitRenderFrame({
        canvas: contentCanvasRef.current,
        frame,
      });
    }

    return frame.effects;
  });

  const renderOverlay = useEffectEvent(() => {
    const layoutState = layout.peekLatest();
    if (!layoutState) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(overlayCanvasRef.current, layoutState, viewportWidth);

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    const frame = createOverlayFrame(editorState, layoutState, {
      devicePixelRatio,
      height,
      normalizedSelection: normalizedSel,
      presence: resolvedPresence,
      showCaret: cursor.isVisible(),
      theme: resolvedTheme,
      width,
    });
    paintOverlayFrame(context, frame);
  });

  const { scheduleContentPaint, scheduleFullPaint, scheduleFullRender, scheduleOverlayPaint } =
    useRender({
      commitLayout,
      isActive: idle.isActive,
      renderContent,
      renderOverlay,
      hasAmbientAnimationsInViewport: () => {
        // Loading-image shimmer is content-only: keep the shared scheduler
        // ticking, but let resource changes below own layout invalidation.
        if (hasLoadingImages) {
          return true;
        }

        const layoutState = layout.peekLatest();
        if (!layoutState) {
          return false;
        }

        return (
          hasActiveResourcesInViewport(editorState, layoutState, resourceRegistry) ||
          hasAnimatedDecorationsInViewport(layoutState, textDecorations) ||
          hasActiveCommentHighlightsInViewport(layoutState, commentRanges, commentPresence)
        );
      },
    });

  const commitEditorCommandTransition = useEffectEvent((transition: EditorStateTransition) => {
    if (transition.source === "external") {
      return;
    }

    // Selection-only transitions keep the cached layout. Document changes
    // invalidate immediately so any imperative layout read after the
    // transition resolves against the new structure.
    if (transition.documentChanged) {
      layout.invalidate();
    }

    if (transition.effects.length > 0) {
      // All default editor effects are content-layer effects. None affect
      // layout or overlay, so a content paint is sufficient.
      scheduleContentPaint({ effects: transition.effects });
    }

    if (!transition.documentChanged) {
      return;
    }

    emitContentChanged(transition);
  });

  useLayoutEffect(() => {
    return store.editor.subscribe(commitEditorCommandTransition);
  }, [store]);

  // Repaint on the idle transition so ambient animations settle at rest.
  useEffect(() => {
    if (idle.activeAt === null) {
      scheduleContentPaint();
    }
  }, [idle.activeAt, scheduleContentPaint]);

  const { subscribeVisibility } = cursor;
  useEffect(
    () => subscribeVisibility(scheduleOverlayPaint),
    [subscribeVisibility, scheduleOverlayPaint],
  );

  // Sync `useViewport`'s scroll metrics and schedule a render after any
  // scroll position change — whether driven by the user (native scroll event)
  // or programmatically (e.g. offscreen presence navigation). Stable identity
  // via `useEffectEvent` so the listener doesn't re-attach on every render.
  const handleViewportScroll = useEffectEvent((scrollContainer: HTMLDivElement) => {
    scrollbar.sync(scrollContainer);
    syncScrollContainer(scrollContainer);
    scheduleFullRender();
  });

  const scrollToPresence = useEffectEvent((target: EditorPresence) => {
    if (!target.viewport || target.viewport.status === "unresolved") {
      return;
    }

    // Comment-attached presence: move the local caret to the thread anchor
    // (which also activates the thread) and let `useCursor`'s focus-
    // visibility scroll the comment into view.
    // No explicit `scrollTop` set here — the selection move is the single
    // source of intent, and the scroll falls out of it.
    if (target.commentThreadIndex != null) {
      const range = commentRanges.find((r) => r.threadIndex === target.commentThreadIndex);

      if (range) {
        input.focus();
        setSelectionCommand({ path: range.path, offset: range.startOffset });
      }
      return;
    }

    // Text-cursor presence: this is the remote user's caret, not ours.
    // Scrolling brings their position on screen without touching the local
    // selection, so it stays a bespoke `scrollTop` write — no `setSelection`
    // path could carry that intent without corrupting local editing state.
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    scrollContainer.scrollTop = target.viewport.scrollTop;
    handleViewportScroll(scrollContainer);
  });

  const selection = useSelection({
    autoScrollDuringDrag,
    focusInput: input.focus,
    onActivity: idle.markActive,
    resolvePoint,
    showLeaf: showReviewChrome || selectionActions.length > 0,
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
  //     For changes that only restyle content (decorations, comment highlights, semantic effects).
  //   - `scheduleOverlayPaint()` — paint only the overlay layer.
  //     For cursor blink and text-cursor presence updates. Subscribed via
  //     `useCursor.subscribeVisibility` and reactive resolved presence changes.
  //
  // Other render triggers in the host live where they're naturally wired:
  //   - `handleViewportScroll` → `scheduleFullRender()` on scroll (native or
  //      programmatic). The resulting layout commit publishes the fresh
  //      viewport for reactive consumers.
  //   - editor command transitions → `scheduleContentPaint()` when a
  //     semantic effect starts

  // Layout-affecting changes — invalidate the cache, then schedule a fresh
  // paint. Active resource changes are paint-only; protocol metadata affects
  // resource pill measurement, but active state only affects color/effects.
  useEffect(() => {
    layout.invalidate();
    scheduleFullRender();
  }, [
    editorState.documentIndex,
    layout,
    renderResources.images,
    metadataExpanded,
    resolvedTheme,
    resourceProtocols.layoutKey,
    scheduleFullRender,
    viewportWidth,
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
    normalizedSel.end.path,
    normalizedSel.start.offset,
    normalizedSel.start.path,
    scheduleFullPaint,
    selectionContext.block?.blockPath,
  ]);

  // Decoration, comment-highlight, and active-resource changes — content layer
  // only, no overlay impact. (See note on the selection effect above for the
  // future overlay move.)
  useEffect(() => {
    scheduleContentPaint();
  }, [
    activeCommentIndex,
    activeResourceKey,
    commentRanges,
    hoveredCommentThreadIndex,
    commentPresence,
    scheduleContentPaint,
    textDecorations,
  ]);

  useEffect(() => {
    scheduleContentPaint({ effects: syncEffects });
  }, [documentChanges, scheduleContentPaint, syncEffects]);

  // Resolved presence affects the overlay canvas and DOM overlay. Comment-thread
  // presence is also handled by the content-layer effect above because it paints
  // comment rules.
  useEffect(() => {
    scheduleOverlayPaint();
  }, [resolvedPresence, scheduleOverlayPaint]);

  /* Leaf presentation */

  // Search is fixed editor chrome. The remaining leaves are contextual
  // document leaves; the host arbitrates their priority and
  // `DocumentLeafAnchor` places the winner against the rendered layout.

  const activeDocumentLeaf =
    documentCompletions.leaf ?? pointer.leaf ?? selection.leaf ?? cursor.leaf;

  // Reference equality picks out the hover case when pointer arbitration
  // leaves it active.
  const hoverLeafHandlers = activeDocumentLeaf === pointer.leaf ? pointer.leafHandlers : null;

  const resolveDocumentLeafContent = () => {
    if (!activeDocumentLeaf) {
      return null;
    }

    switch (activeDocumentLeaf.kind) {
      case "insertion":
        return <InsertionLeaf />;
      case "table":
        return (
          <TableLeaf
            canDeleteColumn={activeDocumentLeaf.columnCount > 1}
            canDeleteRow={activeDocumentLeaf.rowCount > 1}
            onDeleteColumn={deleteTableColumnCommand}
            onDeleteRow={deleteTableRowCommand}
            onDeleteTable={deleteTableCommand}
            onInsertColumn={insertTableColumnCommand}
            onInsertRow={insertTableRowCommand}
          />
        );
      case "link":
        return (
          <LinkLeaf
            canEdit={!readOnly}
            onDelete={() => {
              removeLinkCommand(activeDocumentLeaf);
            }}
            onSave={(url) => {
              updateLinkCommand(activeDocumentLeaf, url);
            }}
            title={activeDocumentLeaf.title}
            url={activeDocumentLeaf.url}
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
            canMutateComments={canMutateComments}
            formatting={activeDocumentLeaf.formatting}
            link={null}
            markdownOptions={markdownOptions}
            mode="create"
            completionSources={completionSources}
            readOnly={readOnly}
            onCreateThread={(body) => {
              const transition = addCommentCommand(activeDocumentLeaf.selection, body.trim());

              if (!transition) {
                return;
              }

              const threadIndex = transition.previous.documentIndex.document.comments.length;
              selection.promoteLeafToThread(threadIndex);
              emitCommentAdded(threadIndex);
            }}
            actions={annotationActions}
          />
        );
      }
      case "thread":
        return (
          <AnnotationLeaf
            animateInitialComment={activeDocumentLeaf.animateInitialComment}
            canMutateComments={canMutateComments}
            link={activeDocumentLeaf.link}
            mode="thread"
            completionSources={completionSources}
            readOnly={readOnly}
            onDeleteComment={(commentIndex) => {
              const { threadIndex } = activeDocumentLeaf;
              const transition = deleteCommentCommand(threadIndex, commentIndex);
              if (!transition) return;
              const { threads } = getCommentState(transition.previous.documentIndex);
              const thread = threads[threadIndex];
              const comment = thread?.comments[commentIndex];
              if (thread && comment) {
                emitCommentDeleted(thread, comment);
              }
            }}
            onDeleteThread={() => {
              const { threadIndex } = activeDocumentLeaf;
              const transition = deleteThreadCommand(threadIndex);
              if (!transition) return;
              const { threads } = getCommentState(transition.previous.documentIndex);
              const thread = threads[threadIndex];
              if (thread) {
                for (const comment of thread.comments) {
                  emitCommentDeleted(thread, comment);
                }
              }
            }}
            onEditComment={(commentIndex, body) => {
              const { threadIndex } = activeDocumentLeaf;
              const transition = editCommentCommand(threadIndex, commentIndex, body);
              if (!transition) return;
              const { threads } = getCommentState(transition.previous.documentIndex);
              const previousBody = threads[threadIndex]?.comments[commentIndex]?.body;
              if (previousBody !== undefined) {
                emitCommentEdited(threadIndex, commentIndex, previousBody);
              }
            }}
            onReply={(body) => {
              const { threadIndex } = activeDocumentLeaf;
              const transition = replyToThreadCommand(threadIndex, body);
              if (!transition) return;
              emitCommentAdded(threadIndex);
            }}
            onToggleResolved={() => {
              resolveThreadCommand(
                activeDocumentLeaf.threadIndex,
                !isResolvedCommentThread(activeDocumentLeaf.thread),
              );
            }}
            presence={commentPresence.get(activeDocumentLeaf.threadIndex) ?? null}
            thread={activeDocumentLeaf.thread}
          />
        );
      case "completion":
        return <CompletionLeaf {...activeDocumentLeaf} />;
    }
  };

  /* Render */

  const sectionClassName = className ? `documint ${className}` : "documint";

  return (
    <OverlayPortalProvider themeStyles={themeStyles}>
      <section className={sectionClassName} style={{ ...themeStyles, height: "100%" }}>
        <style>{editorCss}</style>
        <div
          ref={scrollContainerRef}
          onScroll={(event) => handleViewportScroll(event.currentTarget)}
          className="documint-scroll-container"
        >
          <textarea
            {...input.inputHandlers}
            ref={inputRef}
            autoCapitalize="sentences"
            className="documint-input"
            readOnly={readOnly}
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

          <ViewportAnchor
            open={search.leaf !== null}
            presence={resolvedPresence}
            onPresenceSelect={scrollToPresence}
            paddingX={resolvedTheme.paddingX}
            paddingY={resolvedTheme.paddingY}
          >
            {search.leaf ? <SearchLeaf {...search.leaf} /> : null}
          </ViewportAnchor>

          {/* Scroll content wrapper (this forces a virtualized scroll height for the document, that is only partially rendered) */}
          <div className="documint-scroll-content" style={{ height: `${scrollContentHeight}px` }}>
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

            {/* Overlay canvas (currently used for rendering the blinking cursor) */}
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
            {activeDocumentLeaf ? (
              <DocumentLeafAnchor
                hover={hoverLeafHandlers}
                scrollContainerRef={scrollContainerRef}
                target={activeDocumentLeaf}
                viewportHeight={viewportHeight}
                viewportTop={viewportTop}
              >
                {resolveDocumentLeafContent()}
              </DocumentLeafAnchor>
            ) : null}
          </div>
        </div>
        <div {...scrollbar.props} />
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
