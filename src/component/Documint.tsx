/**
 * Public React host for the canvas editor. The component owns content-format
 * bridging, DOM lifecycle, viewport coordination, and hidden-input plumbing.
 */
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./style-imports.d.ts" />
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  type HTMLAttributes,
  type UIEvent,
} from "react";
import {
  extractPlainTextFromFragment,
  type Comment,
  type CommentThread,
  type Document,
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
  getDocument,
  hasActiveCommentHighlightsInViewport,
  hasActiveResourcesInViewport,
  hasAnimatedDecorationsInViewport,
  insertTableColumn,
  insertTableRow,
  measureVisualCaretTarget,
  removeLink,
  replyToThread,
  resolveThread,
  setSelection,
  updateLink,
  type EditorPresence,
} from "@/editor";
import {
  createDocumentFrame,
  createOverlayFrame,
  paintDocumentFrame,
  paintOverlayFrame,
  type RendererEffect,
} from "@/renderer";
import type { LucideIcon } from "lucide-react";
import type {
  DocumentPresence,
  DocumentResourceReference,
  DocumentUser,
  CodeGrammarRule,
  DocumintDecoration,
  DocumintEffects,
  DocumintStorage,
  EditorTheme,
} from "@/types";
import { parseDocument, type MarkdownOptions } from "@/markdown";
import { OverlayPortalProvider } from "./overlays/OverlayPortal";
import { AnnotationLeaf } from "./overlays/leaves/AnnotationLeaf";
import { CompletionLeaf } from "./overlays/leaves/CompletionLeaf";
import type { CompletionSource } from "./completions/completions";
import { createMentionCompletionSource, emojiCompletionSource } from "./completions/sources";
import { InsertionLeaf } from "./overlays/leaves/InsertionLeaf";
import { DocumentAnchor } from "./overlays/anchors/DocumentAnchor";
import { ViewportAnchor } from "./overlays/anchors/ViewportAnchor";
import type { DocumentAnchorResolution } from "./overlays/leaves/core/shared";
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
  type ActiveResourceSet,
  type ResolvedResourceProtocols,
  type ResourceProtocolRecord,
} from "./hooks/useResources";
import { useInput } from "./hooks/useInput";
import { useRender } from "./hooks/useRender";
import { useSelection } from "./hooks/useSelection";
import { useSearch } from "./hooks/useSearch";
import { useTheme } from "./hooks/useTheme";
import { useViewport } from "./hooks/useViewport";
import { prepareCanvasLayer } from "./lib/canvas";
import { emitDiagnostic, emitRenderFrame } from "./lib/diagnostics";
import { type EditorInputKeybinding } from "./lib/keybindings";
import { extractMentionedUserIds } from "./lib/mentions";
import { DocumentStorage } from "./lib/storage";
import { useDecorations } from "./decorations/useDecorations";
import { builtinGrammars } from "./decorations/grammars";
import { useSync, type UserMentionEvent } from "./sync";
import {
  activeCommentIndexSprig,
  commentRangesSprig,
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
import editorCss from "./styles.css" with { type: "text" };

export type { DocumintDecoration } from "@/types";
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
  className?: string;

  actions?: DocumintActions;
  theme?: DocumintTheme;
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

export type DocumintTheme = EditorTheme | { dark: EditorTheme; light: EditorTheme };

export function Documint({ content, ...props }: DocumintProps) {
  const storeRef = useRef<DocumintStore | null>(null);
  const resourceProtocols = useResourceProtocols(props.protocols);
  const markdownOptions = useMemo<MarkdownOptions>(
    () => ({ resourceProtocols: [...resourceProtocols.protocols.keys()] }),
    [resourceProtocols.key],
  );
  const contentDocument = useMemo(
    () => parseDocument(content, markdownOptions),
    [content, markdownOptions],
  );

  if (!storeRef.current) {
    storeRef.current = createStore(contentDocument);
  }

  return (
    <DocumintStoreProvider store={storeRef.current}>
      <DocumintHost
        content={content}
        {...props}
        contentDocument={contentDocument}
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
  showDiffs = true,
  storage,
  theme,
  users,
  contentDocument,
  markdownOptions,
  resourceProtocols,
}: DocumintProps & {
  contentDocument: Document;
  markdownOptions: MarkdownOptions;
  resourceProtocols: ResolvedResourceProtocols;
}) {
  const contentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const store = useDocumintStore();
  const editorState = useSprig(editorStateSprig);

  const { theme: preferredTheme, themeStyles } = useTheme(theme);

  const documentStorage = useMemo(() => new DocumentStorage(storage, window), [storage]);
  const resourceRegistry = useResources({
    onResourcesRequested,
    resourceProtocols,
    resources,
  });
  const { hasLoadingImages, imageHandle, images, persistImage } = useImages(
    documentStorage,
    resourceRegistry,
  );
  const activeResourceKey = useMemo(
    () => createActiveResourceKey(resourceRegistry.active),
    [resourceRegistry.active],
  );
  const lastPaintedActiveResourceKeyRef = useRef(activeResourceKey);
  const renderResources = useMemo(
    () => ({
      images,
      resourceRegistry,
    }),
    [images, resourceRegistry],
  );

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
    reconcileEditorState,
    resolvePoint,
    scrollTo,
    syncScrollContainer,
  } = viewportActions;

  const { layout, viewportWidth, viewportHeight, viewportTop } = viewportState;

  const { scrollContainer: scrollContainerRef } = viewportRefs;

  const selectionContext = useSprig(selectionContextSprig);
  const commentRanges = useSprig(commentRangesSprig);
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
  const {
    emitContentChanged,
    emitUserMentioned,
    documentChanges,
    effects: syncEffects,
  } = useSync({
    content,
    contentDocument,
    markdownOptions,
    onContentChanged,
    onUserMentioned,
    resourceProtocolKey: resourceProtocols.key,
    showDiffs,
    store,
  });
  const documentCompletions = useDocumentCompletions({
    completionSources: documentCompletionSources,
    enabled: isEditable,
    onMentionAccepted: emitUserMentioned,
  });
  const { commentPresence, resolvedPresence } = usePresence({ presence, users });
  const activeCommentIndex = useSprig(activeCommentIndexSprig);
  const readCurrentState = () => store.editor.getState();
  const resolvedGrammars = useMemo(
    () => (grammars === null ? null : { ...builtinGrammars, ...grammars }),
    [grammars],
  );
  const { textDecorations } = useDecorations({
    decorations,
    grammars: resolvedGrammars,
    store,
    theme: preferredTheme,
  });
  const search = useSearch();
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

      if (transition.hasNewEffects) {
        // All default editor effects are content-layer effects. None affect
        // layout or overlay, so a content paint is sufficient.
        scheduleContentPaint({ effects: transition.effects });
      }

      if (!transition.documentChanged) {
        return;
      }

      emitContentChanged(transition);
    },
  );

  useLayoutEffect(() => {
    return store.editor.subscribe(commitEditorCommandTransition);
  }, [store]);

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
    onIdle: () => scheduleContentPaint(),
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

  const renderContent = useEffectEvent(
    (rendererEffects: readonly RendererEffect[], layoutState = layout.peekLatest()) => {
      if (!layoutState) {
        return { rendererEffects };
      }

      const preparedLayer = prepareCanvasLayer(contentCanvasRef.current, {
        paintHeight: layoutState.paintHeight,
        paintTop: layoutState.paintTop,
        width: viewportWidth,
      });

      if (!preparedLayer) {
        return { rendererEffects };
      }

      const { context, devicePixelRatio, height, width } = preparedLayer;

      const now = performance.now();

      const frame = createDocumentFrame(editorState, layoutState, {
        activeBlockId: selectionContext.block?.blockId ?? null,
        activeRegionId: editorState.selection.focus.regionId,
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
        theme: preferredTheme,
        width,
      });

      paintDocumentFrame(context, frame);
      if (process.env.NODE_ENV !== "production" && contentCanvasRef.current) {
        emitRenderFrame({
          canvas: contentCanvasRef.current,
          frame,
        });
      }

      return {
        rendererEffects: frame.effects,
      };
    },
  );

  const renderOverlay = useEffectEvent((layoutState = layout.peekLatest()) => {
    if (!layoutState) {
      return;
    }

    const preparedLayer = prepareCanvasLayer(overlayCanvasRef.current, {
      paintHeight: layoutState.paintHeight,
      paintTop: layoutState.paintTop,
      width: viewportWidth,
    });

    if (!preparedLayer) {
      return;
    }

    const { context, devicePixelRatio, height, width } = preparedLayer;

    const frame = createOverlayFrame(editorState, layoutState, {
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
    paintOverlayFrame(context, frame);
  });

  const renderViewport = useEffectEvent((rendererEffects: readonly RendererEffect[]) => {
    const layoutState = commitLayout();
    const contentPaint = renderContent(rendererEffects, layoutState);

    renderOverlay(layoutState);
    return contentPaint;
  });

  const { scheduleContentPaint, scheduleFullPaint, scheduleFullRender, scheduleOverlayPaint } =
    useRender({
      isActive: idle.isActive,
      renderContent,
      renderOverlay,
      renderViewport,
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
          hasAnimatedDecorationsInViewport(editorState, layoutState, textDecorations) ||
          hasActiveCommentHighlightsInViewport(layoutState, commentRanges, commentPresence)
        );
      },
    });

  // Sync `useViewport`'s scroll metrics and schedule a render after any
  // scroll position change — whether driven by the user (native scroll event)
  // or programmatically (e.g. offscreen presence navigation). Stable identity
  // via `useEffectEvent` so the listener doesn't re-attach on every render.
  const handleViewportScroll = useEffectEvent((scrollContainer: HTMLDivElement) => {
    syncScrollContainer(scrollContainer);
    scheduleFullRender();
  });

  const handleScrollEvent = useEffectEvent((event: UIEvent<HTMLDivElement>) => {
    handleViewportScroll(event.currentTarget);
  });

  const cursor = useCursor({
    activeAt: idle.activeAt,
    getScrollTop,
    isEditable,
    onVisibilityChange: scheduleOverlayPaint,
    scrollTo,
    viewportWidth,
    viewportHeight,
  });

  const input = useInput({
    enableTouchKeyDown: documentCompletions.leaf !== null || search.leaf !== null,
    inputRef,
    keybindings,
    markdownOptions,
    onActivity: idle.markActive,
    onBeforeInput: documentCompletions.handleBeforeInput,
    onKeyDown: (event) => search.handleKeyDown(event) || documentCompletions.handleKeyDown(event),
    onImagePaste: persistImage,
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
    isEditable,
    onActivity: idle.markActive,
    onResourceOpened,
    resolvePoint,
    storage: documentStorage,
  });

  const hoveredCommentThreadIndex =
    pointer.leaf?.kind === "thread" ? pointer.leaf.threadIndex : null;

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
        setSelectionCommand({ regionId: range.regionId, offset: range.startOffset });
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
  //     For changes that only restyle content (decorations, comment highlights, semantic effects).
  //   - `scheduleOverlayPaint()` — paint only the overlay layer.
  //     For cursor blink and text-cursor presence updates. Wired inline to
  //     `useCursor.onVisibilityChange` and reactive resolved presence changes.
  //
  // Other render triggers in the host live where they're naturally wired:
  //   - `handleViewportScroll` → `scheduleFullRender()` on scroll (native or
  //      programmatic). Inside the resulting `renderViewport` pass,
  //      the viewport store publishes the fresh viewport for reactive consumers.
  //   - editor command transitions → `scheduleContentPaint()` when a
  //     semantic effect starts

  // Layout-affecting changes — invalidate the cache, then schedule a fresh
  // paint. Active resource changes are paint-only; protocol metadata affects
  // resource pill measurement, but active state only affects color/effects.
  useEffect(() => {
    invalidateLayout();
    scheduleFullRender();
  }, [
    editorState.documentIndex,
    images,
    preferredTheme,
    resourceProtocols.layoutKey,
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
    commentRanges,
    hoveredCommentThreadIndex,
    commentPresence,
    textDecorations,
  ]);

  useEffect(() => {
    scheduleContentPaint({
      effects: syncEffects,
    });
  }, [documentChanges, syncEffects]);

  // Resolved presence affects the overlay canvas and DOM overlay. Comment-thread
  // presence is also handled by the content-layer effect above because it paints
  // comment rules.
  useEffect(() => {
    scheduleOverlayPaint();
  }, [resolvedPresence]);

  useEffect(() => {
    if (activeResourceKey === lastPaintedActiveResourceKeyRef.current) {
      return;
    }

    lastPaintedActiveResourceKeyRef.current = activeResourceKey;
    scheduleContentPaint();
  }, [activeResourceKey]);

  /* Leaf presentation */

  // Search is fixed editor chrome. The remaining leaves are contextual
  // document leaves; the host arbitrates their priority and resolves their
  // anchors against the prepared layout.

  const activeDocumentLeaf =
    documentCompletions.leaf ?? pointer.leaf ?? selection.leaf ?? cursor.leaf;

  // Resolve the active leaf's anchor target into pixel geometry against
  // the prepared layout. Returns null when no leaf is active or its
  // anchor falls outside the editor's visible window — the same gate the
  // canvas painter applies to the caret.
  const resolveDocumentAnchor = (): DocumentAnchorResolution | null => {
    if (!activeDocumentLeaf) {
      return null;
    }

    const measured = measureVisualCaretTarget(editorState, layout.get(), activeDocumentLeaf.anchor);
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
    const isHoverLeaf = activeDocumentLeaf === pointer.leaf;

    return {
      anchorHeight: measured.height,
      // Hover leaves want the bridge for pointer hand-off (see styles.css).
      bridge: isHoverLeaf,
      left:
        (scrollContainerBounds?.left ?? 0) +
        hostScrollX +
        (activeDocumentLeaf.leftOverride ?? measured.left),
      onPointerEnter: isHoverLeaf ? pointer.leafHandlers.onPointerEnter : undefined,
      onPointerLeave: isHoverLeaf ? pointer.leafHandlers.onPointerLeave : undefined,
      paddingY: activeDocumentLeaf.paddingY ?? 0,
      top: (scrollContainerBounds?.top ?? 0) + hostScrollY + anchorBottom - viewportTop,
    };
  };
  const documentAnchor = resolveDocumentAnchor();

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
            canEdit={isEditable}
            formatting={activeDocumentLeaf.formatting}
            link={null}
            markdownOptions={markdownOptions}
            mode="create"
            completionSources={completionSources}
            onCreateThread={(body) => {
              const currentState = readCurrentState();
              const threadIndex = getDocument(currentState).comments.length;
              const transition = addCommentCommand(activeDocumentLeaf.selection, body.trim());

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
            animateInitialComment={activeDocumentLeaf.animateInitialComment}
            canEdit={isEditable}
            link={activeDocumentLeaf.link}
            mode="thread"
            completionSources={completionSources}
            onDeleteComment={(commentIndex) => {
              const { threadIndex } = activeDocumentLeaf;
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
              const { threadIndex } = activeDocumentLeaf;
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
              const { threadIndex } = activeDocumentLeaf;
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
              const { threadIndex } = activeDocumentLeaf;
              const transition = replyToThreadCommand(threadIndex, body);
              if (!transition) return;
              emitCommentAdded(threadIndex);
            }}
            onToggleResolved={() => {
              resolveThreadCommand(activeDocumentLeaf.threadIndex, !activeDocumentLeaf.resolved);
            }}
            presence={commentPresence.get(activeDocumentLeaf.threadIndex) ?? null}
            thread={activeDocumentLeaf.thread}
          />
        );
      case "completion":
        return <CompletionLeaf {...activeDocumentLeaf} />;
    }
  };

  // Skip building the leaf's React tree when no leaf is going to render.
  // Each branch of `resolveDocumentLeafContent` allocates several inline
  // callbacks, so this avoids per-frame churn during scrolls that move the
  // cursor leaf's anchor in and out of the viewport.
  const documentLeafContent = documentAnchor ? resolveDocumentLeafContent() : null;

  /* Render */

  const sectionClassName = className ? `documint ${className}` : "documint";

  return (
    <OverlayPortalProvider themeStyles={themeStyles}>
      <section
        className={sectionClassName}
        style={{ ...themeStyles, height: "100%", minHeight: 0 }}
      >
        <style>{editorCss}</style>
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

          <ViewportAnchor
            open={search.leaf !== null}
            presence={resolvedPresence}
            onPresenceSelect={scrollToPresence}
            paddingX={preferredTheme.paddingX}
            paddingY={preferredTheme.paddingY}
          >
            {search.leaf ? <SearchLeaf {...search.leaf} /> : null}
          </ViewportAnchor>

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
            {documentAnchor ? (
              <DocumentAnchor anchor={documentAnchor}>{documentLeafContent}</DocumentAnchor>
            ) : null}
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
