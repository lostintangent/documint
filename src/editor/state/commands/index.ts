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
// dispatch it through the reducer to produce the next state. A few escape
// hatches bypass the action pipeline entirely — selection-only ops
// (selectAll) and history ops (undo/redo) — but still honor the
// state-in/state-out contract.
//
// Commands never reach into reducer internals.

import { dispatch, redoEditorState, setSelection, undoEditorState } from "../reducer/state";
import {
  resolveBlockById,
  resolveBlockContext,
  resolveInlineContext,
  resolveInlineTargetContext,
  resolveListItemContext,
  resolveTableCellContext,
  resolveTextRangeContext,
  type InlineContext,
  type TableCellContext,
  type TextRangeContext,
  type TextRangeTarget,
} from "./context";
import type { EditorState, EditorStateAction } from "../types";
import { createCommentThreadForSelection, getCommentState } from "../../anchors";
import {
  insertInlineNode,
  removeInlineLink,
  resolveInlineRangeReplacement,
  resolveImageResize,
  resolveMentionReplacement,
  toggleInlineCode,
  toggleInlineMark,
  updateInlineLinkUrl,
  wrapInlineLink,
  type ImageResizeTarget,
} from "./actions/inlines";
import {
  createImage,
  createLineBreak,
  deleteCommentFromThread,
  editCommentInThread,
  markCommentThreadAsResolved as markThreadResolved,
  replyToCommentThread as appendThreadReply,
  type CommentThread,
  type Fragment,
  type Mark,
} from "@/document";
import { resolveTextInsertion } from "./actions/insertion";
import { resolveLineBreakAction } from "./actions/insertion/line-break";
import {
  extractFragment,
  resolvePasteFragmentAction,
  resolvePasteFragmentContext,
} from "../fragments";
import { resolveTextRangeReplacement, resolveTextReplacement } from "./actions/insertion/replace";
import {
  resolveListItemDedent,
  resolveListItemIndent,
  resolveListItemMove,
} from "./actions/blocks/list";
import { resolveHeadingDepthShift, resolveParagraphBlockquoteIndent } from "./actions/blocks";
import { resolveDeletion } from "./actions/deletion";
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

export const insertText = makeCommand((state, text: string) =>
  resolveTextInsertion(state.documentIndex, state.selection, text),
);

export const insertLineBreak = makeCommand(resolveLineBreakAction, resolveBlockContext);

// Inserts an inline LineBreak at the caret (the Shift+Enter gesture). This
// mirrors `insertImage` — both are single-inline inserts at the selection —
// and falls back to a literal `\n` splice for source-text regions (code
// blocks, raw blocks) where no inline tree exists.
export const insertSoftLineBreak = makeCommand(
  (state) =>
    insertSoftLineBreakInline(state) ?? {
      kind: "splice-text",
      text: "\n",
    },
);

export const replaceSelection = makeCommand(
  (state, text: string): EditorStateAction =>
    resolveTextReplacement(state.documentIndex, state.selection, text),
);

export const replaceTextRange = makeCommand(
  (
    context: TextRangeContext,
    _startOffset: number,
    _endOffset: number,
    text: string,
  ): EditorStateAction => resolveTextRangeReplacement(context, text),
  (state, startOffset: number, endOffset: number) =>
    resolveTextRangeContext(state, startOffset, endOffset),
);

export const deleteSelection = (state: EditorState) => replaceSelection(state, "");

export const deleteBackward = makeCommand((state) => resolveDeletion(state, "backward"));

export const deleteForward = makeCommand((state) => resolveDeletion(state, "forward"));

// --- Clipboard ---

// Capture the current selection as a `Fragment`. The fragment carries the
// structural shape of every wholly-covered block — bullets for whole list
// items, fences for whole code blocks, etc. — and a bare text slice for a
// partial inline range. Returns null when the selection is collapsed
// (nothing to copy). The component layer is responsible for serializing
// the fragment to whatever clipboard format it uses.
export const copySelection = (state: EditorState): Fragment | null =>
  extractFragment(state.documentIndex, state.selection);

// Replace the current selection with a `Fragment`. Fragment application
// resolves to the lowest-altitude action the fragment kind allows
// (text → inline replace, inlines → in-leaf splice, blocks → structural
// seam-merge).
//
// `verbatimFallback` is consulted only when fragment application declines on
// an opaque destination (code block, table cell). For code blocks the
// fallback text inserts as literal source so markdown markers are
// preserved; table cells get the fragment's plain-text projection. The
// caller (component layer) supplies the original clipboard text as
// `verbatimFallback` — the editor doesn't parse it, just inserts it.
//
// Inline-shaped pastes (text, inlines, single-paragraph blocks) flash a
// text highlight so the visual feedback matches typing.
// Multi-block pastes lean on the active-block flash that `setSelection`
// fires when the caret lands in a new block.
const pasteFragmentCommand = makeCommand(resolvePasteFragmentAction, resolvePasteFragmentContext);

export function pasteFragment(
  state: EditorState,
  fragment: Fragment,
  verbatimFallback?: string,
): EditorState | null {
  return pasteFragmentCommand(state, fragment, verbatimFallback);
}

// --- Selection ---

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

export const toggleBold = createToggleMarkCommand("bold");

export const toggleItalic = createToggleMarkCommand("italic");

export const toggleStrikethrough = createToggleMarkCommand("strikethrough");

export const toggleUnderline = createToggleMarkCommand("underline");

export const toggleCode = makeCommand(
  (context: InlineContext) => resolveInlineRangeReplacement(context, toggleInlineCode),
  resolveInlineContext,
);

// --- Links ---

export const updateLink = makeCommand(
  (context: InlineContext, _target: TextRangeTarget, url: string) =>
    resolveInlineRangeReplacement(context, (region, start, end) =>
      updateInlineLinkUrl(region, start, end, url),
    ),
  resolveInlineTargetContext,
);

export const removeLink = makeCommand(
  (context: InlineContext, _target: TextRangeTarget) =>
    resolveInlineRangeReplacement(context, removeInlineLink),
  resolveInlineTargetContext,
);

export const insertLink = makeCommand(
  (context: InlineContext, url: string) =>
    resolveInlineRangeReplacement(context, (region, start, end) =>
      wrapInlineLink(region, start, end, url),
    ),
  resolveInlineContext,
);

// --- Inline objects ---

export const insertImage = makeCommand(
  (context: InlineContext, url: string, alt?: string) =>
    insertInlineNode(context, createImage({ alt: alt ?? null, url })),
  resolveInlineContext,
);

export const insertMention = makeCommand(
  (
    context: InlineContext,
    _target: TextRangeTarget,
    userId: string,
    name: string,
    trailingText: string = "",
  ): EditorStateAction => resolveMentionReplacement(context, userId, name, trailingText),
  resolveInlineTargetContext,
);

export const resizeImage = makeCommand(
  (context: InlineContext, inline: ImageResizeTarget, newWidth: number): EditorStateAction =>
    resolveImageResize(context.inlineContainer, inline, newWidth),
  resolveInlineContext,
);

// --- History ---

export const undo = (state: EditorState) => undoEditorState(state);

export const redo = (state: EditorState) => redoEditorState(state);

// --- Structural operations (indent / dedent) ---

export const indent = makeCommand((ctx) => {
  switch (ctx.kind) {
    case "tableCell":
      return resolveTableSelectionMove(ctx, 1);
    case "rootTextBlock":
      return resolveHeadingDepthShift(ctx, 1) ?? resolveParagraphBlockquoteIndent(ctx);
    case "listItem":
      return resolveListItemIndent(ctx);
    default:
      return null;
  }
}, resolveBlockContext);

export const dedent = makeCommand((ctx) => {
  switch (ctx.kind) {
    case "tableCell":
      return resolveTableSelectionMove(ctx, -1);
    case "rootTextBlock":
      return resolveHeadingDepthShift(ctx, -1);
    case "listItem":
      return resolveListItemDedent(ctx);
    default:
      return null;
  }
}, resolveBlockContext);

// --- Lists & tasks ---

export const moveListItemUp = makeCommand(
  (ctx) => resolveListItemMove(ctx, -1),
  resolveListItemContext,
);

export const moveListItemDown = makeCommand(
  (ctx) => resolveListItemMove(ctx, 1),
  resolveListItemContext,
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
  (ctx: TableCellContext, direction: "left" | "right") =>
    resolveTableColumnInsertion(ctx, direction),
  resolveTableCellContext,
);

export const deleteTableColumn = makeCommand(resolveTableColumnDeletion, resolveTableCellContext);

export const insertTableRow = makeCommand(
  (ctx: TableCellContext, direction: "above" | "below") => resolveTableRowInsertion(ctx, direction),
  resolveTableCellContext,
);

export const deleteTableRow = makeCommand(resolveTableRowDeletion, resolveTableCellContext);

export const deleteTable = makeCommand(resolveTableDeletion, resolveTableCellContext);

// --- Comments ---

export const addComment = makeCommand(
  (
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
  },
);

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

export const deleteComment = (state: EditorState, threadIndex: number, commentIndex: number) =>
  updateCommentThread(state, threadIndex, (thread) =>
    deleteCommentFromThread(thread, commentIndex),
  );

export const deleteThread = (state: EditorState, threadIndex: number) =>
  updateCommentThread(state, threadIndex, () => null);

export const resolveThread = (state: EditorState, threadIndex: number, resolved: boolean) =>
  updateCommentThread(state, threadIndex, (thread) => markThreadResolved(thread, resolved));

// --- Private helpers ---

type CommandResult<R extends EditorStateAction | null> = [Extract<R, null>] extends [never]
  ? EditorState
  : EditorState | null;

type ContextResolver<C, A extends unknown[] = []> = (state: EditorState, ...args: A) => C | null;

type StateActionResolver<A extends unknown[], R extends EditorStateAction | null> = (
  state: EditorState,
  ...args: A
) => R;

type ContextActionResolver<C, A extends unknown[], R extends EditorStateAction | null> = (
  context: C,
  ...args: A
) => R;

function makeCommand<C, A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: (context: C, ...args: A) => R,
  resolveContext: ContextResolver<C, A>,
): (state: EditorState, ...args: A) => CommandResult<R>;
function makeCommand<A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: StateActionResolver<A, R>,
  resolveContext?: never,
): (state: EditorState, ...args: A) => CommandResult<R>;
function makeCommand<C, A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: StateActionResolver<A, R> | ContextActionResolver<C, A, R>,
  resolveContext?: ContextResolver<C, A>,
): (state: EditorState, ...args: A) => CommandResult<R> {
  return ((state: EditorState, ...args: A) => {
    const action = resolveContext
      ? resolveContextAction(resolveAction, resolveContext, state, args)
      : (resolveAction as StateActionResolver<A, R>)(state, ...args);

    if (!action) return null;

    return dispatch(state, action);
  }) as (state: EditorState, ...args: A) => CommandResult<R>;
}

function resolveContextAction<C, A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: StateActionResolver<A, R> | ContextActionResolver<C, A, R>,
  resolveContext: ContextResolver<C, A>,
  state: EditorState,
  args: A,
): R | null {
  const context = resolveContext(state, ...args);
  return context ? (resolveAction as ContextActionResolver<C, A, R>)(context, ...args) : null;
}

function insertSoftLineBreakInline(state: EditorState) {
  const context = resolveInlineContext(state);

  return context ? insertInlineNode(context, createLineBreak()) : null;
}

type ToggleMark = Extract<Mark, "italic" | "bold" | "strikethrough" | "underline">;

function createToggleMarkCommand(mark: ToggleMark) {
  return makeCommand(
    (context: InlineContext) =>
      resolveInlineRangeReplacement(context, (inlineContainer, startOffset, endOffset) =>
        toggleInlineMark(inlineContainer, startOffset, endOffset, mark),
      ),
    resolveInlineContext,
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
