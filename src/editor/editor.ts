// Framework-agnostic editor instance construction. An editor owns per-instance
// render machinery and exposes a small semantic surface to host integrations.
import { findBlockById, type Block, type Document, type Mark } from "@/document";
import {
  appendThreadComment,
  deleteThreadComment,
  editThreadComment,
  updateCommentThreadStatus,
  type CommentThread,
} from "@/comments";
import {
  getCanvasEditablePreviewState,
  type CanvasEditablePreviewState,
} from "./derived-state";
import {
  createCommentThreadForSelection,
  getCommentState,
  type CommentState,
} from "./comments";
import {
  addActiveBlockFlashAnimation,
  addDeletedTextFadeAnimation,
  addListMarkerPopAnimation,
  addPunctuationPulseAnimation,
  createDocumentFromEditorState,
  createEditorState,
  spliceEditorCommentThreads,
  setCanvasSelection,
  type EditorState,
} from "./model/state";
import {
  emptyDocumentResources,
  type DocumentResources,
} from "./resources";
import {
  normalizeCanvasSelection,
  resolveInlineCommandMarks,
  resolveInlineCommandTarget,
  type CanvasSelection,
  type CanvasSelectionPoint,
  type NormalizedCanvasSelection,
} from "./model/document-editor";
import {
  applyTextInputRule,
  dedent as dedentCommand,
  deleteBackward as deleteBackwardCommand,
  deleteTable as deleteTableCommand,
  deleteTableColumn as deleteTableColumnCommand,
  deleteTableRow as deleteTableRowCommand,
  deleteSelectionText,
  indent as indentCommand,
  insertLineBreak as insertLineBreakCommand,
  insertTable as insertTableCommand,
  insertTableColumn as insertTableColumnCommand,
  insertTableRow as insertTableRowCommand,
  insertSelectionText,
  moveListItemDown as moveListItemDownCommand,
  moveListItemUp as moveListItemUpCommand,
  removeInlineLink,
  redo as redoCommand,
  replaceSelectionText,
  toggleSelectionBold as toggleSelectionBoldCommand,
  toggleSelectionInlineCode as toggleSelectionInlineCodeCommand,
  toggleSelectionItalic as toggleSelectionItalicCommand,
  toggleSelectionStrikethrough as toggleSelectionStrikethroughCommand,
  toggleSelectionUnderline as toggleSelectionUnderlineCommand,
  toggleTaskItem,
  undo as undoCommand,
  updateInlineLink,
  type EditorCommand,
  type EditorCommandEffect,
} from "./model/commands";
import {
  extendSelectionToLineBoundary,
  extendSelectionHorizontally,
  moveCaretByViewport as moveCaretByViewportSelection,
  moveCaretHorizontally as moveCaretHorizontallySelection,
  moveCaretToLineBoundary as moveCaretToLineBoundarySelection,
  moveCaretVertically as moveCaretVerticallySelection,
} from "./navigation";
import { createCanvasRenderCache, type CanvasRenderCache } from "./render/cache";
import {
  createDocumentViewport,
  measureCaretTarget,
  resolveCaretVisualLeft,
  resolveDragFocusPointAtLocation as resolvePointerDragFocusPointAtLocation,
  resolveEditorHitAtPoint,
  resolveHoverTargetAtPoint,
  resolveTargetAtSelectionPoint,
  resolveWordSelectionAtPoint,
  type CaretTarget,
  type CanvasViewport,
  type EditorHoverTarget,
  type ViewportLayout,
  type LayoutOptions,
} from "./layout";
import {
  paintCanvasCaretOverlay,
  paintCanvasEditorSurface,
} from "./render/paint";
import type { EditorTheme } from "./render/theme";
import { hasRunningEditorAnimations } from "./render/animations";

export type ContainerLineExtent = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

export type EditorStateChange = {
  animationStarted: boolean;
  documentChanged: boolean;
  state: EditorState;
};
export type { EditorCommand };

export type EditorViewport = {
  height: number;
  top: number;
};

export type PreparedViewport = {
  regionExtents: Map<string, ContainerLineExtent>;
  layout: ViewportLayout;
  paintHeight: number;
  paintTop: number;
  totalHeight: number;
  viewport: EditorViewport;
  blockMap: Map<string, Block>;
};

export type EditorPoint = {
  x: number;
  y: number;
};

export type SelectionHit = {
  regionId: string;
  offset: number;
};

export type EditorSelectionPoint = CanvasSelectionPoint;
export type { EditorHoverTarget };

export type Editor = {
  getDocument(state: EditorState): Document;
  createState(document: Document): EditorState;
  createCommentThread(
    state: EditorState,
    selection: {
      endOffset: number;
      regionId: string;
      startOffset: number;
    },
    body: string,
  ): EditorStateChange | null;
  spliceCommentThreads(
    state: EditorState,
    index: number,
    count: number,
    threads: CommentThread[],
  ): EditorStateChange;
  deleteCommentThread(state: EditorState, threadIndex: number): EditorStateChange | null;
  deleteComment(
    state: EditorState,
    threadIndex: number,
    commentIndex: number,
  ): EditorStateChange | null;
  editComment(
    state: EditorState,
    threadIndex: number,
    commentIndex: number,
    body: string,
  ): EditorStateChange | null;
  replyToCommentThread(
    state: EditorState,
    threadIndex: number,
    body: string,
  ): EditorStateChange | null;
  setCommentThreadResolved(
    state: EditorState,
    threadIndex: number,
    resolved: boolean,
  ): EditorStateChange | null;
  getPreviewState(state: EditorState): CanvasEditablePreviewState;
  getCommentState(state: EditorState): CommentState;
  getSelectionMarks(state: EditorState): Mark[];
  hasRunningAnimations(state: EditorState, now?: number): boolean;
  normalizeSelection(state: EditorState): NormalizedCanvasSelection;
  insertText(state: EditorState, text: string): EditorStateChange | null;
  insertLineBreak(state: EditorState): EditorStateChange | null;
  deleteBackward(state: EditorState): EditorStateChange | null;
  deleteForward(state: EditorState): EditorStateChange | null;
  deleteSelection(state: EditorState): EditorStateChange;
  dedent(state: EditorState): EditorStateChange | null;
  indent(state: EditorState): EditorStateChange | null;
  replaceSelection(state: EditorState, text: string): EditorStateChange;
  setSelection(
    state: EditorState,
    selection: CanvasSelection | CanvasSelectionPoint,
  ): EditorStateChange;
  moveListItemDown(state: EditorState): EditorStateChange | null;
  moveListItemUp(state: EditorState): EditorStateChange | null;
  redo(state: EditorState): EditorStateChange | null;
  toggleTaskItem(state: EditorState, listItemId: string): EditorStateChange | null;
  toggleSelectionBold(state: EditorState): EditorStateChange | null;
  toggleSelectionInlineCode(state: EditorState): EditorStateChange | null;
  toggleSelectionItalic(state: EditorState): EditorStateChange | null;
  toggleSelectionStrikethrough(state: EditorState): EditorStateChange | null;
  toggleSelectionUnderline(state: EditorState): EditorStateChange | null;
  undo(state: EditorState): EditorStateChange | null;
  insertTable(state: EditorState, columnCount: number): EditorStateChange | null;
  insertTableColumn(state: EditorState, direction: "left" | "right"): EditorStateChange | null;
  deleteTableColumn(state: EditorState): EditorStateChange | null;
  insertTableRow(state: EditorState, direction: "above" | "below"): EditorStateChange | null;
  deleteTableRow(state: EditorState): EditorStateChange | null;
  deleteTable(state: EditorState): EditorStateChange | null;
  updateLink(
    state: EditorState,
    regionId: string,
    startOffset: number,
    endOffset: number,
    url: string,
  ): EditorStateChange | null;
  removeLink(
    state: EditorState,
    regionId: string,
    startOffset: number,
    endOffset: number,
  ): EditorStateChange | null;
  moveCaretByViewport(
    state: EditorState,
    layout: ViewportLayout,
    direction: -1 | 1,
  ): EditorStateChange;
  moveCaretHorizontally(
    state: EditorState,
    direction: -1 | 1,
    extendSelection?: boolean,
  ): EditorStateChange;
  moveCaretToLineBoundary(
    state: EditorState,
    layout: ViewportLayout,
    boundary: "Home" | "End",
    extendSelection?: boolean,
  ): EditorStateChange;
  moveCaretVertically(
    state: EditorState,
    layout: ViewportLayout,
    direction: -1 | 1,
  ): EditorStateChange;
  prepareViewport(
    state: EditorState,
    options: Partial<LayoutOptions> &
      Pick<LayoutOptions, "width"> &
      EditorViewport,
    resources?: DocumentResources,
  ): PreparedViewport;
  resolveSelectionHit(
    state: EditorState,
    viewport: PreparedViewport,
    point: EditorPoint,
  ): SelectionHit | null;
  resolveDragFocus(
    state: EditorState,
    viewport: PreparedViewport,
    point: EditorPoint,
    anchor: CanvasSelectionPoint,
  ): SelectionHit | null;
  resolveWordSelection(
    state: EditorState,
    viewport: PreparedViewport,
    point: EditorPoint,
  ): CanvasSelection | null;
  resolveHoverTarget(
    state: EditorState,
    viewport: PreparedViewport,
    point: EditorPoint,
    liveCommentRanges: CommentState["liveRanges"],
  ): EditorHoverTarget | null;
  resolveTargetAtSelection(
    state: EditorState,
    viewport: PreparedViewport,
    selectionPoint: CanvasSelectionPoint,
    liveCommentRanges: CommentState["liveRanges"],
  ): EditorHoverTarget | null;
  measureCaretTarget(
    state: EditorState,
    viewport: PreparedViewport,
    point: CanvasSelectionPoint,
  ): CaretTarget | null;
  measureVisualCaretTarget(
    state: EditorState,
    viewport: PreparedViewport,
    point: CanvasSelectionPoint,
  ): CaretTarget | null;
  paintContent(
    state: EditorState,
    viewport: PreparedViewport,
    context: CanvasRenderingContext2D,
    options: {
      activeBlockId: string | null;
      activeRegionId: string | null;
      activeThreadIndex: number | null;
      devicePixelRatio: number;
      height: number;
      liveCommentRanges: CommentState["liveRanges"];
      normalizedSelection: NormalizedCanvasSelection;
      now?: number;
      resources?: DocumentResources;
      theme: EditorTheme;
      width: number;
    },
  ): void;
  paintOverlay(
    state: EditorState,
    viewport: PreparedViewport,
    context: CanvasRenderingContext2D,
    options: {
      devicePixelRatio: number;
      height: number;
      normalizedSelection: NormalizedCanvasSelection;
      showCaret: boolean;
      theme: EditorTheme;
      width: number;
    },
  ): void;
};

export function createEditor(): Editor {
  return createEditorWithCache(createCanvasRenderCache());
}

function createEditorWithCache(renderCache: CanvasRenderCache): Editor {
  const editor: Editor = {
    getDocument(state) {
      return createDocumentFromEditorState(state);
    },
    createState(document) {
      return createEditorState(document);
    },
    createCommentThread(state, selection, body) {
      const thread = createCommentThreadForSelection(
        state.documentEditor,
        selection,
        body,
      );

      if (!thread) {
        return null;
      }

      return createTransitionEditorStateChange(
        state,
        spliceEditorCommentThreads(
          state,
          state.documentEditor.document.comments.length,
          0,
          [thread],
        ),
        true,
      );
    },
    spliceCommentThreads(state, index, count, threads) {
      return createTransitionEditorStateChange(
        state,
        spliceEditorCommentThreads(state, index, count, threads),
        true,
      );
    },
    deleteCommentThread(state, threadIndex) {
      return updateCommentThreadStateChange(state, threadIndex, () => null);
    },
    deleteComment(state, threadIndex, commentIndex) {
      return updateCommentThreadStateChange(
        state,
        threadIndex,
        (thread) => deleteThreadComment(thread, commentIndex),
      );
    },
    editComment(state, threadIndex, commentIndex, body) {
      return updateCommentThreadStateChange(
        state,
        threadIndex,
        (thread) => editThreadComment(thread, commentIndex, body),
      );
    },
    replyToCommentThread(state, threadIndex, body) {
      return updateCommentThreadStateChange(
        state,
        threadIndex,
        (thread) =>
          appendThreadComment(thread, {
            body: body.trim(),
          }),
      );
    },
    setCommentThreadResolved(state, threadIndex, resolved) {
      return updateCommentThreadStateChange(
        state,
        threadIndex,
        (thread) => updateCommentThreadStatus(thread, resolved ? "resolved" : "open"),
      );
    },
    getPreviewState(state) {
      return getCanvasEditablePreviewState(state);
    },
    getCommentState(state) {
      return getCommentState(state.documentEditor);
    },
    getSelectionMarks(state) {
      const selection = normalizeCanvasSelection(state.documentEditor, state.selection);

      if (
        selection.start.regionId !== selection.end.regionId ||
        selection.start.offset === selection.end.offset
      ) {
        return [];
      }

      const region = state.documentEditor.regionIndex.get(selection.start.regionId);

      if (!region) {
        return [];
      }

      const block = findBlockById(state.documentEditor.document.blocks, region.blockId);

      if (!block) {
        return [];
      }

      const target = resolveInlineCommandTarget(block, region.path, region.semanticRegionId);

      return target
        ? resolveInlineCommandMarks(target, selection.start.offset, selection.end.offset)
        : [];
    },
    hasRunningAnimations(state, now) {
      return hasRunningEditorAnimations(state, now);
    },
    normalizeSelection(state) {
      return normalizeCanvasSelection(state.documentEditor, state.selection);
    },
    insertText(state, text) {
      const nextState = applyTextInputRule(state, text);
      const nextStateWithPunctuationPulse =
        nextState && text === "." ? addPunctuationPulseAnimation(nextState) : nextState;

      return createNullableTransitionEditorStateChange(
        state,
        nextStateWithPunctuationPulse,
        true,
      );
    },
    insertLineBreak(state) {
      const commandResult = insertLineBreakCommand(state);
      const animatedState = commandResult
        ? applyCommandEffects(commandResult.state, commandResult.effects)
        : null;

      return createNullableTransitionEditorStateChange(
        state,
        animatedState,
        true,
      );
    },
    deleteBackward(state) {
      if (hasSingleContainerExpandedSelection(state)) {
        return createTransitionEditorStateChange(state, deleteSelectionText(state), true);
      }

      const nextState =
        deleteCharacterBackward(state) ??
        deleteBackwardCommand(state) ??
        null;

      return createNullableTransitionEditorStateChange(
        state,
        nextState,
        true,
      );
    },
    deleteForward(state) {
      if (hasSingleContainerExpandedSelection(state)) {
        return createTransitionEditorStateChange(state, deleteSelectionText(state), true);
      }

      const nextState = deleteCharacterForward(state);

      return createNullableTransitionEditorStateChange(
        state,
        nextState,
        true,
      );
    },
    deleteSelection(state) {
      return createTransitionEditorStateChange(state, deleteSelectionText(state), true);
    },
    replaceSelection(state, text) {
      const nextState = insertSelectionText(state, text);

      return createTransitionEditorStateChange(
        state,
        nextState,
        true,
      );
    },
    setSelection(state, selection) {
      return createTransitionEditorStateChange(
        state,
        setCanvasSelection(state, selection),
        false,
      );
    },
    toggleTaskItem(state, listItemId) {
      return createNullableTransitionEditorStateChange(
        state,
        toggleTaskItem(state, listItemId),
        true,
      );
    },
    insertTable(state, columnCount) {
      return createNullableTransitionEditorStateChange(
        state,
        insertTableCommand(state, columnCount),
        true,
      );
    },
    insertTableColumn(state, direction) {
      return createNullableTransitionEditorStateChange(
        state,
        insertTableColumnCommand(state, direction),
        true,
      );
    },
    deleteTableColumn(state) {
      return createNullableTransitionEditorStateChange(
        state,
        deleteTableColumnCommand(state),
        true,
      );
    },
    insertTableRow(state, direction) {
      return createNullableTransitionEditorStateChange(
        state,
        insertTableRowCommand(state, direction),
        true,
      );
    },
    deleteTableRow(state) {
      return createNullableTransitionEditorStateChange(
        state,
        deleteTableRowCommand(state),
        true,
      );
    },
    deleteTable(state) {
      return createNullableTransitionEditorStateChange(
        state,
        deleteTableCommand(state),
        true,
      );
    },
    updateLink(state, regionId, startOffset, endOffset, url) {
      return createNullableTransitionEditorStateChange(
        state,
        updateInlineLink(state, regionId, startOffset, endOffset, url),
        true,
      );
    },
    removeLink(state, regionId, startOffset, endOffset) {
      return createNullableTransitionEditorStateChange(
        state,
        removeInlineLink(state, regionId, startOffset, endOffset),
        true,
      );
    },
    indent(state) {
      return createNullableTransitionEditorStateChange(state, indentCommand(state), true);
    },
    dedent(state) {
      return createNullableTransitionEditorStateChange(state, dedentCommand(state), true);
    },
    moveListItemUp(state) {
      return createNullableTransitionEditorStateChange(state, moveListItemUpCommand(state), true);
    },
    moveListItemDown(state) {
      return createNullableTransitionEditorStateChange(state, moveListItemDownCommand(state), true);
    },
    toggleSelectionBold(state) {
      return createNullableTransitionEditorStateChange(state, toggleSelectionBoldCommand(state), true);
    },
    toggleSelectionItalic(state) {
      return createNullableTransitionEditorStateChange(state, toggleSelectionItalicCommand(state), true);
    },
    toggleSelectionStrikethrough(state) {
      return createNullableTransitionEditorStateChange(state, toggleSelectionStrikethroughCommand(state), true);
    },
    toggleSelectionUnderline(state) {
      return createNullableTransitionEditorStateChange(state, toggleSelectionUnderlineCommand(state), true);
    },
    toggleSelectionInlineCode(state) {
      return createNullableTransitionEditorStateChange(state, toggleSelectionInlineCodeCommand(state), true);
    },
    undo(state) {
      return createNullableTransitionEditorStateChange(state, undoCommand(state), true);
    },
    redo(state) {
      return createNullableTransitionEditorStateChange(state, redoCommand(state), true);
    },
    moveCaretByViewport(state, layout, direction) {
      return createTransitionEditorStateChange(
        state,
        moveCaretByViewportSelection(state, layout, direction),
        false,
      );
    },
    moveCaretHorizontally(state, direction, extendSelection = false) {
      return createTransitionEditorStateChange(
        state,
        extendSelection
          ? extendSelectionHorizontally(state, direction)
          : moveCaretHorizontallySelection(state, direction),
        false,
      );
    },
    moveCaretToLineBoundary(state, layout, boundary, extendSelection = false) {
      return createTransitionEditorStateChange(
        state,
        extendSelection
          ? extendSelectionToLineBoundary(state, layout, boundary)
          : moveCaretToLineBoundarySelection(state, layout, boundary),
        false,
      );
    },
    moveCaretVertically(state, layout, direction) {
      return createTransitionEditorStateChange(
        state,
        moveCaretVerticallySelection(state, layout, direction),
        false,
      );
    },
    prepareViewport(state, options, resources = emptyDocumentResources) {
      const viewport: CanvasViewport = {
        height: options.height,
        overscan: Math.max(160, options.height),
        top: options.top,
      };
      const viewportLayout = createDocumentViewport(
        state.documentEditor,
        options,
        viewport,
        [
          state.selection.anchor.regionId,
          state.selection.focus.regionId,
        ],
        renderCache,
        resources,
      );

      return {
        blockMap: createBlockMap(state.documentEditor.document.blocks),
        regionExtents: createContainerExtents(viewportLayout.layout),
        layout: viewportLayout.layout,
        paintHeight: Math.max(240, viewport.height + viewport.overscan * 2),
        paintTop: Math.max(0, viewport.top - viewport.overscan),
        totalHeight: viewportLayout.totalHeight,
        viewport: {
          height: viewport.height,
          top: viewport.top,
        },
      };
    },
    resolveSelectionHit(state, viewport, point) {
      return resolveEditorHitAtPoint(viewport.layout, state, point);
    },
    resolveDragFocus(state, viewport, point, anchor) {
      return resolvePointerDragFocusPointAtLocation(viewport.layout, state, point, anchor);
    },
    resolveWordSelection(state, viewport, point) {
      return resolveWordSelectionAtPoint(viewport.layout, state, point);
    },
    resolveHoverTarget(state, viewport, point, liveCommentRanges) {
      return resolveHoverTargetAtPoint(viewport.layout, state, point, liveCommentRanges);
    },
    resolveTargetAtSelection(state, viewport, selectionPoint, liveCommentRanges) {
      return resolveTargetAtSelectionPoint(
        viewport.layout,
        state,
        selectionPoint,
        liveCommentRanges,
      );
    },
    measureCaretTarget(state, viewport, point) {
      return measureCaretTarget(viewport.layout, state.documentEditor, point);
    },
    measureVisualCaretTarget(state, viewport, point) {
      const caret = measureCaretTarget(viewport.layout, state.documentEditor, point);

      if (!caret) {
        return null;
      }

      return {
        ...caret,
        left: resolveCaretVisualLeft(state, viewport.layout, caret),
      };
    },
    paintContent(state, viewport, context, options) {
      paintCanvasEditorSurface({
        activeBlockId: options.activeBlockId,
        activeRegionId: options.activeRegionId,
        activeThreadIndex: options.activeThreadIndex,
        containerLineExtents: viewport.regionExtents,
        context,
        devicePixelRatio: options.devicePixelRatio,
        editorState: state,
        height: options.height,
        layout: viewport.layout,
        liveCommentRanges: options.liveCommentRanges,
        normalizedSelection: options.normalizedSelection,
        now: options.now,
        resources: options.resources ?? emptyDocumentResources,
        runtimeBlockMap: viewport.blockMap,
        theme: options.theme,
        viewportTop: viewport.paintTop,
        width: options.width,
      });
    },
    paintOverlay(state, viewport, context, options) {
      paintCanvasCaretOverlay({
        context,
        devicePixelRatio: options.devicePixelRatio,
        editorState: state,
        height: options.height,
        layout: viewport.layout,
        normalizedSelection: options.normalizedSelection,
        showCaret: options.showCaret,
        theme: options.theme,
        viewportTop: viewport.paintTop,
        width: options.width,
      });
    },
  };

  return editor;
}

function createBlockMap(blocks: Block[]) {
  const entries = new Map<string, Block>();

  const visit = (candidateBlocks: Block[]) => {
    for (const block of candidateBlocks) {
      entries.set(block.id, block);

      if (
        block.type === "blockquote" ||
        block.type === "list" ||
        block.type === "listItem"
      ) {
        visit(block.children);
      }
    }
  };

  visit(blocks);

  return entries;
}

function createContainerExtents(layout: ViewportLayout) {
  return new Map(layout.regionExtents);
}

function createEditorStateChange(
  state: EditorState,
  documentChanged: boolean,
  animationStarted = false,
): EditorStateChange {
  return {
    animationStarted,
    documentChanged,
    state,
  };
}

function createTransitionEditorStateChange(
  previousState: EditorState,
  nextState: EditorState,
  documentChanged: boolean,
) {
  let animatedState = maybeAnimateActiveBlockChange(previousState, nextState);

  return createEditorStateChange(
    animatedState,
    documentChanged,
    startedNewAnimation(previousState, animatedState),
  );
}

function createNullableTransitionEditorStateChange(
  previousState: EditorState,
  nextState: EditorState | null,
  documentChanged: boolean,
) {
  if (!nextState) {
    return null;
  }

  return createTransitionEditorStateChange(previousState, nextState, documentChanged);
}

function startedNewAnimation(
  previousState: EditorState,
  nextState: EditorState | null,
) {
  if (!nextState) {
    return false;
  }

  const previousLatestStart = Math.max(
    -Infinity,
    ...previousState.animations.map((animation) => animation.startedAt),
  );

  return nextState.animations.some(
    (animation) => animation.startedAt > previousLatestStart,
  );
}

function maybeAnimateActiveBlockChange(
  previousState: EditorState,
  nextState: EditorState,
) {
  const previousTarget = resolveFocusedFlashTarget(previousState);
  const nextTarget = resolveFocusedFlashTarget(nextState);

  return nextTarget && nextTarget.compareKey !== previousTarget?.compareKey
    ? addActiveBlockFlashAnimation(nextState, nextTarget.animationBlockPath)
    : nextState;
}

function applyCommandEffects(
  state: EditorState,
  effects: EditorCommandEffect[],
) {
  let nextState = state;

  for (const effect of effects) {
    switch (effect.kind) {
      case "list-item-inserted":
        nextState = addListMarkerPopAnimation(nextState, effect.blockPath);
        break;
    }
  }

  return nextState;
}

function resolveFocusedFlashTarget(state: EditorState) {
  const focusedRegion = state.documentEditor.regionIndex.get(state.selection.focus.regionId);
  const focusedBlock = focusedRegion
    ? state.documentEditor.blockIndex.get(focusedRegion.blockId) ?? null
    : null;

  if (!focusedRegion || !focusedBlock?.path) {
    return null;
  }

  return {
    animationBlockPath: focusedBlock.path,
    compareKey:
      focusedBlock.type === "table"
        ? `cell:${focusedRegion.path}`
        : `block:${focusedBlock.path}`,
  };
}

function updateCommentThreadStateChange(
  state: EditorState,
  threadIndex: number,
  updater: (thread: CommentThread) => CommentThread | null,
) {
  const threads = getCommentState(state.documentEditor).threads;
  const currentThread = threads[threadIndex];

  if (!currentThread) {
    return null;
  }

  const nextThread = updater(currentThread);

  if (nextThread === currentThread) {
    return null;
  }

  return createTransitionEditorStateChange(
    state,
    spliceEditorCommentThreads(
      state,
      threadIndex,
      1,
      nextThread ? [nextThread] : [],
    ),
    true,
  );
}

function hasSingleContainerExpandedSelection(state: EditorState) {
  const normalized = normalizeCanvasSelection(state.documentEditor, state.selection);

  return (
    normalized.start.regionId === normalized.end.regionId &&
    normalized.start.offset !== normalized.end.offset
  );
}

function deleteCharacterBackward(state: EditorState) {
  if (
    state.selection.anchor.regionId !== state.selection.focus.regionId ||
    state.selection.anchor.offset !== state.selection.focus.offset
  ) {
    return null;
  }

  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.focus.regionId,
  );

  if (!container || state.selection.focus.offset <= 0) {
    return null;
  }

  const previousOffset = previousGraphemeOffset(container.text, state.selection.focus.offset);
  const nextState = replaceSelectionText(
    setCanvasSelection(state, {
      anchor: {
        regionId: container.id,
        offset: previousOffset,
      },
      focus: {
        regionId: container.id,
        offset: state.selection.focus.offset,
      },
    }),
    "",
  );

  return maybeAddDeletedTextFadeAnimation(
    state,
    nextState,
    previousOffset,
    state.selection.focus.offset,
  );
}

function deleteCharacterForward(state: EditorState) {
  if (
    state.selection.anchor.regionId !== state.selection.focus.regionId ||
    state.selection.anchor.offset !== state.selection.focus.offset
  ) {
    return null;
  }

  const container = state.documentEditor.regions.find(
    (entry) => entry.id === state.selection.focus.regionId,
  );

  if (!container || state.selection.focus.offset >= container.text.length) {
    return null;
  }

  const nextOffset = nextGraphemeOffset(container.text, state.selection.focus.offset);
  const nextState = replaceSelectionText(
    setCanvasSelection(state, {
      anchor: {
        regionId: container.id,
        offset: state.selection.focus.offset,
      },
      focus: {
        regionId: container.id,
        offset: nextOffset,
      },
    }),
    "",
  );

  return maybeAddDeletedTextFadeAnimation(
    state,
    nextState,
    state.selection.focus.offset,
    nextOffset,
  );
}

function maybeAddDeletedTextFadeAnimation(
  previousState: EditorState,
  nextState: EditorState,
  startOffset: number,
  endOffset: number,
) {
  const deletedTextFade = resolveDeletedTextFadeAnimation(
    previousState,
    startOffset,
    endOffset,
  );

  return deletedTextFade
    ? addDeletedTextFadeAnimation(nextState, deletedTextFade)
    : nextState;
}

function resolveDeletedTextFadeAnimation(
  state: EditorState,
  startOffset: number,
  endOffset: number,
) {
  const region = state.documentEditor.regionIndex.get(state.selection.focus.regionId);

  if (!region) {
    return null;
  }

  const deletedText = region.text.slice(startOffset, endOffset);

  if (deletedText.length === 0) {
    return null;
  }

  const deletedRun = region.runs.find(
    (run) =>
      run.start <= startOffset &&
      run.end >= endOffset &&
      run.kind === "text" &&
      run.link === null &&
      run.marks.length === 0,
  );

  if (!deletedRun) {
    return null;
  }

  return {
    regionPath: region.path,
    startOffset,
    text: deletedText,
  };
}

function previousGraphemeOffset(text: string, offset: number) {
  const slice = Array.from(text.slice(0, offset));

  if (slice.length === 0) {
    return 0;
  }

  return offset - slice.at(-1)!.length;
}

function nextGraphemeOffset(text: string, offset: number) {
  const next = Array.from(text.slice(offset))[0];

  return next ? offset + next.length : text.length;
}
