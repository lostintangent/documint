// Editor commands: the public API clients use to produce a new EditorState
// from a semantic operation (insert text, toggle bold, indent, undo, ...).
//
// Every command honors the same contract:
//
//   command: (state: EditorState, ...args) => EditorState | null
//
// `null` means the operation was a no-op for the current state.
//
// The primary mechanism is a three-step pipeline: resolve any context the
// operation needs, build an EditorStateAction describing the edit, then
// dispatch it through the reducer to produce the next state. Some commands
// layer presentation side-effects (animations) on top of the dispatched
// state. A few escape hatches bypass the action pipeline entirely —
// selection-only ops (selectAll) and history ops (undo/redo) — but still
// honor the state-in/state-out contract.
//
// Commands never reach into reducer internals.

import {
  addInsertedTextHighlightAnimation,
  addListMarkerPopAnimation,
  addPlainTextDeletionFadeAnimation,
  addPunctuationPulseAnimation,
} from "./animations";
import {
  type EditorSelection,
  normalizeSelection,
} from "./selection";
import {
  dispatch,
  redoEditorState,
  setSelection,
  setSelectionPoint,
  undoEditorState,
} from "./reducer/state";
import {
  resolveBlockById,
  resolveBlockCommandContext,
  resolveDeleteCommandContext,
  resolveListItemContext,
  resolveTableCellContext,
} from "./context";
import type { EditorState, EditorStateAction } from "./types";
import type { DocumentIndex, EditorInline } from "./index/types";
import { createCommentThreadForSelection, getCommentState } from "../anchors";
import {
  type InlineRegion,
  type InlineRegionReplacement,
  insertInlineNode,
  insertInlineIntoRegion,
  replaceExactInlineLinkRange,
  replaceInlineRange,
  resolveInlineRegion,
  toggleInlineCode,
  toggleInlineMark,
} from "./actions/inlines";
import {
  createImage,
  createLineBreak,
  deleteCommentFromThread,
  editCommentInThread,
  markCommentThreadAsResolved as markThreadResolved,
  replyToCommentThread as appendThreadReply,
  type CommentThread,
} from "@/document";
import { resolveCharacterDelete } from "./actions/deletion/character";
import { resolveTextInsertion } from "./actions/insertion";
import { resolveLineBreakAction } from "./actions/insertion/line-break";
import { applyFragment, extractFragment } from "./fragment";
import { resolveFragmentDestinationContext } from "./fragment/context";
import {
  extractPlainTextFromFragment,
  extractPlainTextFromInlineNodes,
  type Fragment,
} from "@/document";
import {
  resolveListItemDedent,
  resolveListItemIndent,
  resolveListItemMove,
} from "./actions/blocks/list";
import { resolveHeadingDepthShift } from "./actions/blocks";
import { resolveStructuralDelete } from "./actions/deletion";
import {
  resolveTableColumnDeletion,
  resolveTableColumnInsertion,
  resolveTableDeletion,
  resolveTableInsertion,
  resolveTableRowDeletion,
  resolveTableRowInsertion,
  resolveTableSelectionMove,
} from "./actions/blocks/table";

// --- Core editing ---

export const insertText = makeCommand(
  (state, text: string) => resolveTextInsertion(state.documentIndex, state.selection, text),
  {
    animate: (_previousState, nextState, action, text) => {
      if (action.kind !== "splice-text") {
        return;
      }

      if (text === ".") {
        return addPunctuationPulseAnimation(nextState);
      }

      return addInsertedTextHighlightAnimation(nextState, text.length);
    },
  },
);

export const insertLineBreak = makeCommand(
  (state, ctx) => resolveLineBreakAction(state.documentIndex, state.selection, ctx),
  {
    context: resolveBlockCommandContext,
    animate: (_, nextState, action) => {
      if (action.kind !== "replace-block" || !action.listItemInsertedPath) {
        return;
      }

      return addListMarkerPopAnimation(nextState, action.listItemInsertedPath);
    },
  },
);

// Inserts an inline LineBreak at the caret (the Shift+Enter gesture). The
// inline-region path mirrors `insertImage` — both are single-inline inserts
// at the selection — and falls back to a literal `\n` splice for source-
// text regions (code blocks, raw blocks) where no inline tree exists.
export const insertSoftLineBreak = makeCommand(
  (state) =>
    insertInlineNode(state.documentIndex, state.selection, (path) => createLineBreak({ path })) ?? {
      kind: "splice-text",
      selection: state.selection,
      text: "\n",
    },
);

export const replaceSelection = makeCommand(
  (state, text: string): EditorStateAction => ({
    kind: "splice-text",
    selection: state.selection,
    text,
  }),
  {
    animate: (_prevState, nextState, _action, text) => {
      if (text.length > 0) {
        return addInsertedTextHighlightAnimation(nextState, text.length);
      }
    },
  },
);

export const deleteSelection = (state: EditorState) => replaceSelection(state, "");

export const deleteBackward = makePipelineCommand(
  deleteExpandedSelectionStage,
  (state) => deleteCollapsedCharacter(state, "backward"),
  (state) => deleteStructuralStage(state, "backward"),
);

export const deleteForward = makePipelineCommand(
  deleteExpandedSelectionStage,
  (state) => deleteCollapsedCharacter(state, "forward"),
  (state) => deleteStructuralStage(state, "forward"),
);

// --- Clipboard ---

// Capture the current selection as a `Fragment`. The fragment carries the
// structural shape of every wholly-covered block — bullets for whole list
// items, fences for whole code blocks, etc. — and a bare text slice for a
// partial inline range. Returns null when the selection is collapsed
// (nothing to copy). The component layer is responsible for serializing
// the fragment to whatever clipboard format it uses.
export const copySelection = (state: EditorState): Fragment | null =>
  extractFragment(state.documentIndex, state.selection);

// Replace the current selection with a `Fragment`. Routing happens inside
// `applyFragment`, dispatching at the lowest altitude the fragment kind
// allows (text → inline replace, inlines → in-leaf splice, blocks →
// structural seam-merge).
//
// `verbatimFallback` is consulted only when `applyFragment` declines on
// an opaque destination (code block, table cell). For code blocks the
// fallback text inserts as literal source so markdown markers are
// preserved; table cells get the fragment's plain-text projection. The
// caller (component layer) supplies the original clipboard text as
// `verbatimFallback` — the editor doesn't parse it, just inserts it.
//
// Inline-shaped pastes (text, inlines, single-paragraph blocks) flash an
// inserted-text highlight so the visual feedback matches typing.
// Multi-block pastes lean on the active-block flash that `setSelection`
// fires when the caret lands in a new block.
export function pasteFragment(
  state: EditorState,
  fragment: Fragment,
  verbatimFallback?: string,
): EditorState | null {
  const result = applyFragment(state, fragment);

  if (result) {
    const insertedLength = inlineInsertionLength(fragment);
    return insertedLength > 0
      ? addInsertedTextHighlightAnimation(result, insertedLength)
      : result;
  }

  // applyFragment refused. Empty `text` payloads silently no-op; opaque
  // destinations (code block / table cell) get a flatten fallback.
  if (fragment.kind === "text") {
    return null;
  }

  return pasteIntoOpaqueRoot(state, fragment, verbatimFallback);
}

// The number of characters the paste landed inline in the destination
// region. For `text` and `inlines`, that's the whole payload. For a
// single-paragraph block fragment, it's the paragraph's text — the seam
// merge absorbs it into the destination block's run. Multi-block
// fragments cross block boundaries (the active-block flash takes over)
// so they report 0 — no inline highlight.
function inlineInsertionLength(fragment: Fragment): number {
  switch (fragment.kind) {
    case "text":
      return fragment.text.length;
    case "inlines":
      return extractPlainTextFromInlineNodes(fragment.inlines).length;
    case "blocks":
      return fragment.blocks.length === 1 && fragment.blocks[0]!.type === "paragraph"
        ? fragment.blocks[0]!.plainText.length
        : 0;
  }
}

function pasteIntoOpaqueRoot(
  state: EditorState,
  fragment: Extract<Fragment, { kind: "inlines" } | { kind: "blocks" }>,
  verbatimFallback: string | undefined,
): EditorState | null {
  // Code blocks store source text — preserve every character of the
  // original clipboard payload. Table cells (or code blocks without a
  // verbatim source) take the fragment's plain-text projection so
  // newlines / markdown markers don't bleed into the inline content.
  const destination = resolveFragmentDestinationContext(state.documentIndex, state.selection);

  if (!destination) {
    return null;
  }

  const fallbackText =
    destination.prefersVerbatimFallback && verbatimFallback && verbatimFallback.length > 0
      ? verbatimFallback
      : extractPlainTextFromFragment(fragment);

  return fallbackText.length > 0 ? replaceSelection(state, fallbackText) : null;
}

// --- Selection ---

export function extendSelectionToPoint(
  state: EditorState,
  regionId: string,
  offset: number,
): EditorState {
  return setSelectionPoint(state, regionId, offset, true);
}

export function selectAll(state: EditorState): EditorState {
  const regions = state.documentIndex.regions;
  const first = regions[0];
  const last = regions.at(-1);

  if (!first || !last) {
    return state;
  }

  return setSelection(state, {
    anchor: { regionId: first.id, offset: 0 },
    focus: { regionId: last.id, offset: last.text.length },
  });
}

// --- Inline formatting ---

export const toggleBold = (state: EditorState) => toggleMark(state, "bold");

export const toggleItalic = (state: EditorState) => toggleMark(state, "italic");

export const toggleStrikethrough = (state: EditorState) =>
  toggleMark(state, "strikethrough");

export const toggleUnderline = (state: EditorState) => toggleMark(state, "underline");

export const toggleCode = (state: EditorState) => applyInlineSelectionEdit(state, toggleInlineCode);

// --- Links ---

export const updateLink = makeCommand((
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
  url: string,
) =>
  replaceExactInlineLinkRange(state.documentIndex, regionId, startOffset, endOffset, url),
);

export const removeLink = makeCommand((
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
) =>
  replaceExactInlineLinkRange(state.documentIndex, regionId, startOffset, endOffset, null),
);

// --- Images ---

export const insertImage = makeCommand((state, url: string, alt?: string) =>
  insertInlineNode(state.documentIndex, state.selection, (path) =>
    createImage({ alt: alt ?? null, path, url }),
  ),
);

export const resizeImage = makeCommand((
  state: EditorState,
  regionId: string,
  run: { start: number; end: number; image: NonNullable<EditorInline["image"]> },
  newWidth: number,
): EditorStateAction | null => {
  const inlineRegion = resolveInlineRegion(state.documentIndex, regionId);

  if (!inlineRegion) {
    return null;
  }

  const { image } = run;
  const replacement = insertInlineIntoRegion(inlineRegion, run.start, run.end, (path) =>
    createImage({ alt: image.alt, path, title: image.title, url: image.url, width: newWidth }),
  );

  return {
    kind: "replace-block",
    block: replacement.block,
    blockId: replacement.blockId,
  };
});

// --- History ---

export const undo = (state: EditorState) => undoEditorState(state);

export const redo = (state: EditorState) => redoEditorState(state);

// --- Structural operations (indent / dedent) ---

export const indent = makeCommand((state, ctx) => {
  switch (ctx.kind) {
    case "tableCell":
      return resolveTableSelectionMove(state.documentIndex, state.selection, ctx, 1);
    case "rootTextBlock":
      return resolveHeadingDepthShift(ctx, 1, state.selection.focus.offset);
    case "listItem":
      return resolveListItemIndent(ctx);
    default:
      return null;
  }
}, { context: resolveBlockCommandContext });

export const dedent = makeCommand((state, ctx) => {
  switch (ctx.kind) {
    case "tableCell":
      return resolveTableSelectionMove(state.documentIndex, state.selection, ctx, -1);
    case "rootTextBlock":
      return resolveHeadingDepthShift(ctx, -1, state.selection.focus.offset);
    case "listItem":
      return resolveListItemDedent(ctx);
    default:
      return null;
  }
}, { context: resolveBlockCommandContext });

// --- Lists & tasks ---

export const moveListItemUp = makeCommand((_, ctx) =>
  resolveListItemMove(ctx, -1),
  { context: resolveListItemContext },
);

export const moveListItemDown = makeCommand((_, ctx) =>
  resolveListItemMove(ctx, 1),
  { context: resolveListItemContext },
);

export const toggleTask = makeCommand((state, listItemId: string) => {
  const block = resolveBlockById(state.documentIndex, listItemId);

  if (!block || block.type !== "listItem" || typeof block.checked !== "boolean") {
    return null;
  }

  return {
    kind: "replace-block",
    block: { ...block, checked: !block.checked },
    blockId: listItemId,
  };
});

// --- Tables ---

export const insertTable = makeCommand((state, columnCount: number) =>
  resolveTableInsertion(state.documentIndex, state.selection, columnCount),
);

export const insertTableColumn = makeCommand(
  (_, ctx, direction: "left" | "right") => resolveTableColumnInsertion(ctx, direction),
  { context: resolveTableCellContextFromSelection },
);

export const deleteTableColumn = makeCommand((_, ctx) =>
  resolveTableColumnDeletion(ctx),
  { context: resolveTableCellContextFromSelection },
);

export const insertTableRow = makeCommand(
  (_, ctx, direction: "above" | "below") => resolveTableRowInsertion(ctx, direction),
  { context: resolveTableCellContextFromSelection },
);

export const deleteTableRow = makeCommand((_, ctx) =>
  resolveTableRowDeletion(ctx),
  { context: resolveTableCellContextFromSelection },
);

export const deleteTable = makeCommand((_, ctx) =>
  resolveTableDeletion(ctx),
  { context: resolveTableCellContextFromSelection },
);

// --- Comments ---

export const addComment = makeCommand((
  state: EditorState,
  selection: { endOffset: number; regionId: string; startOffset: number },
  body: string,
): EditorStateAction | null => {
  const thread = createCommentThreadForSelection(state.documentIndex, selection, body);

  if (!thread) {
    return null;
  }

  return {
    kind: "splice-comments",
    count: 0,
    index: state.documentIndex.document.comments.length,
    threads: [thread],
  };
});

export const replyToThread = (state: EditorState, threadIndex: number, body: string) =>
  updateCommentThread(state, threadIndex, (thread) =>
    appendThreadReply(thread, { body: body.trim() }),
  );

export const editComment = (
  state: EditorState,
  threadIndex: number,
  commentIndex: number,
  body: string,
) =>
  updateCommentThread(state, threadIndex, (thread) =>
    editCommentInThread(thread, commentIndex, body),
  );

export const deleteComment = (
  state: EditorState,
  threadIndex: number,
  commentIndex: number,
) =>
  updateCommentThread(state, threadIndex, (thread) =>
    deleteCommentFromThread(thread, commentIndex),
  );

export const deleteThread = (state: EditorState, threadIndex: number) =>
  updateCommentThread(state, threadIndex, () => null);

export const resolveThread = (
  state: EditorState,
  threadIndex: number,
  resolved: boolean,
) => updateCommentThread(state, threadIndex, (thread) => markThreadResolved(thread, resolved));

// --- Private helpers ---

type Command<A extends unknown[] = []> = (state: EditorState, ...args: A) => EditorState | null;
type CommandResult<R extends EditorStateAction | null> =
  [Extract<R, null>] extends [never] ? EditorState : EditorState | null;

type ContextResolver<C> = (
  documentIndex: DocumentIndex,
  selection: EditorSelection,
) => C | null;

// Optional post-dispatch hook used to layer presentation effects (typically
// an animation) on top of the freshly-dispatched state. Return a new
// EditorState to replace `nextState`; return nothing to keep `nextState`
// as-is. Receives the original args so it can branch on what was requested.
type CommandAnimator<A extends unknown[] = []> = (
  previousState: EditorState,
  nextState: EditorState,
  action: EditorStateAction,
  ...args: A
) => EditorState | void;

type CommandOptions<C = never, A extends unknown[] = []> = {
  animate?: CommandAnimator<A>;
  context?: ContextResolver<C>;
};

function makeCommand<A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: (state: EditorState, ...args: A) => R,
  options?: CommandOptions<never, A>,
): (state: EditorState, ...args: A) => CommandResult<R>;
function makeCommand<C, A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: (state: EditorState, context: C, ...args: A) => R,
  options: CommandOptions<C, A> & { context: ContextResolver<C> },
): (state: EditorState, ...args: A) => CommandResult<R>;
function makeCommand<C, A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: (state: EditorState, ...rest: unknown[]) => R,
  options?: CommandOptions<C, A>,
): (state: EditorState, ...args: A) => CommandResult<R> {
  return ((state: EditorState, ...args: A) => {
    const prefix: unknown[] = [];

    if (options?.context) {
      const context = options.context(state.documentIndex, state.selection);
      if (!context) return null;
      prefix.push(context);
    }

    const action = resolveAction(state, ...prefix, ...args);
    if (!action) return null;

    const nextState = dispatch(state, action);
    return options?.animate?.(state, nextState, action, ...args) ?? nextState;
  }) as (state: EditorState, ...args: A) => CommandResult<R>;
}

function makePipelineCommand<A extends unknown[]>(
  ...stages: Array<(state: EditorState, ...args: A) => EditorState | null>
): (state: EditorState, ...args: A) => EditorState | null {
  return (state, ...args) => {
    for (const stage of stages) {
      const result = stage(state, ...args);

      if (result) {
        return result;
      }
    }

    return null;
  };
}

function resolveTableCellContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
) {
  return resolveTableCellContext(documentIndex, selection.focus.regionId);
}

function deleteExpandedSelectionStage(state: EditorState) {
  return hasExpandedSelection(state) ? deleteSelection(state) : null;
}

function deleteStructuralStage(state: EditorState, direction: "backward" | "forward") {
  const ctx = resolveDeleteCommandContext(state.documentIndex, state.selection, direction);

  return dispatch(state, resolveStructuralDelete(state.documentIndex, ctx));
}

function toggleMark(
  state: EditorState,
  mark: "italic" | "bold" | "strikethrough" | "underline",
) {
  return applyInlineSelectionEdit(state, (inlineRegion, startOffset, endOffset) =>
    toggleInlineMark(inlineRegion, startOffset, endOffset, mark),
  );
}

function applyInlineSelectionEdit(
  state: EditorState,
  applyEdit: (
    inlineRegion: InlineRegion,
    startOffset: number,
    endOffset: number,
  ) => InlineRegionReplacement | null,
) {
  const selection = normalizeSelection(state.documentIndex, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset === selection.end.offset
  ) {
    return null;
  }

  return dispatch(
    state,
    replaceInlineRange(
      state.documentIndex,
      selection.start.regionId,
      selection.start.offset,
      selection.end.offset,
      applyEdit,
    ),
  );
}

function hasExpandedSelection(state: EditorState) {
  const normalized = normalizeSelection(state.documentIndex, state.selection);

  return (
    normalized.start.regionId !== normalized.end.regionId ||
    normalized.start.offset !== normalized.end.offset
  );
}

function deleteCollapsedCharacter(state: EditorState, direction: "backward" | "forward") {
  const action = resolveCharacterDelete(state, direction);
  if (!action) return null;

  const nextState = dispatch(state, action);
  if (!nextState) return null;

  // The action's selection carries the deletion range; the animation
  // layer only needs the offsets, not the action shape itself.
  return addPlainTextDeletionFadeAnimation(
    state,
    nextState,
    action.selection.anchor.offset,
    action.selection.focus.offset,
  );
}

function updateCommentThread(
  state: EditorState,
  threadIndex: number,
  updater: (thread: CommentThread) => CommentThread | null,
) {
  const threads = getCommentState(state.documentIndex).threads;
  const currentThread = threads[threadIndex];

  if (!currentThread) {
    return null;
  }

  const nextThread = updater(currentThread);

  if (nextThread === currentThread) {
    return null;
  }

  return dispatch(state, {
    kind: "splice-comments",
    count: 1,
    index: threadIndex,
    threads: nextThread ? [nextThread] : [],
  });
}
