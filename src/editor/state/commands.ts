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
  clearInsertedTextHighlightAnimations,
} from "./animations";
import { normalizeSelection } from "./selection";
import { dispatch, redoEditorState, setSelection, undoEditorState } from "./reducer/state";
import {
  resolveBlockById,
  resolveBlockContext,
  resolveDeletionContext,
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
import type { EditorState, EditorStateAction } from "./types";
import { createCommentThreadForSelection, getCommentState } from "../anchors";
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
  extractPlainTextFromFragment,
  extractPlainTextFromInlineNodes,
  markCommentThreadAsResolved as markThreadResolved,
  replyToCommentThread as appendThreadReply,
  type CommentThread,
  type Fragment,
  type Mark,
} from "@/document";
import { resolveCharacterDelete } from "./actions/deletion/character";
import { resolveTextInsertion } from "./actions/insertion";
import { resolveLineBreakAction } from "./actions/insertion/line-break";
import { resolveTextRangeReplacement, resolveTextReplacement } from "./actions/insertion/replace";
import { applyFragment, extractFragment } from "./fragment";
import { resolveFragmentDestinationContext } from "./fragment/context";
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

      return addInsertedTextHighlightAnimation(nextState, text);
    },
  },
);

export const insertLineBreak = makeCommand(resolveLineBreakAction, {
  context: resolveBlockContext,
  animate: (_, nextState, action) => {
    if (action.kind !== "replace-block" || !action.listItemInsertedPath) {
      return;
    }

    return addListMarkerPopAnimation(nextState, action.listItemInsertedPath);
  },
});

// Inserts an inline LineBreak at the caret (the Shift+Enter gesture). This
// mirrors `insertImage` — both are single-inline inserts at the selection —
// and falls back to a literal `\n` splice for source-text regions (code
// blocks, raw blocks) where no inline tree exists.
export const insertSoftLineBreak = makeCommand(
  (state) =>
    insertSoftLineBreakInline(state) ?? {
      kind: "splice-text",
      selection: state.selection,
      text: "\n",
    },
);

export const replaceSelection = makeCommand(
  (state, text: string): EditorStateAction => resolveTextReplacement(state.selection, text),
  {
    animate: (_prevState, nextState, _action, text) => {
      return animateInsertedText(nextState, text);
    },
  },
);

export const replaceTextRange = makeCommand(
  (
    context: TextRangeContext,
    _startOffset: number,
    _endOffset: number,
    text: string,
  ): EditorStateAction => resolveTextRangeReplacement(context, text),
  {
    context: (state, startOffset: number, endOffset: number) =>
      resolveTextRangeContext(state, startOffset, endOffset),
    animate: (_prevState, nextState, _action, _startOffset, _endOffset, text) =>
      animateInsertedText(clearInsertedTextHighlightAnimations(nextState), text),
  },
);

function animateInsertedText(nextState: EditorState, text: string) {
  return text.length > 0 ? addInsertedTextHighlightAnimation(nextState, text) : undefined;
}

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
    const insertedText = inlineInsertionText(fragment);
    return insertedText.length > 0
      ? addInsertedTextHighlightAnimation(result, insertedText)
      : result;
  }

  // applyFragment refused. Empty `text` payloads silently no-op; opaque
  // destinations (code block / table cell) get a flatten fallback.
  if (fragment.kind === "text") {
    return null;
  }

  return pasteIntoOpaqueRoot(state, fragment, verbatimFallback);
}

// The text that paste landed inline in the destination region. For `text`
// and `inlines`, that's the whole payload. For a single-paragraph block
// fragment, it's the paragraph's text — the seam merge absorbs it into the
// destination block's inline content. Multi-block fragments cross block
// boundaries (the active-block flash takes over) so they report empty text
// — no inline highlight.
function inlineInsertionText(fragment: Fragment): string {
  switch (fragment.kind) {
    case "text":
      return fragment.text;
    case "inlines":
      return extractPlainTextFromInlineNodes(fragment.inlines);
    case "blocks":
      return fragment.blocks.length === 1 && fragment.blocks[0]!.type === "paragraph"
        ? fragment.blocks[0]!.plainText
        : "";
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
  { context: resolveInlineContext },
);

// --- Links ---

export const updateLink = makeCommand(
  (context: InlineContext, _target: TextRangeTarget, url: string) =>
    resolveInlineRangeReplacement(context, (region, start, end) =>
      updateInlineLinkUrl(region, start, end, url),
    ),
  { context: resolveInlineTargetContext },
);

export const removeLink = makeCommand(
  (context: InlineContext, _target: TextRangeTarget) =>
    resolveInlineRangeReplacement(context, removeInlineLink),
  { context: resolveInlineTargetContext },
);

export const insertLink = makeCommand(
  (context: InlineContext, url: string) =>
    resolveInlineRangeReplacement(context, (region, start, end) =>
      wrapInlineLink(region, start, end, url),
    ),
  { context: resolveInlineContext },
);

// --- Inline objects ---

export const insertImage = makeCommand(
  (context: InlineContext, url: string, alt?: string) =>
    insertInlineNode(context, createImage({ alt: alt ?? null, url })),
  { context: resolveInlineContext },
);

export const insertMention = makeCommand(
  (
    context: InlineContext,
    _target: TextRangeTarget,
    userId: string,
    name: string,
    trailingText: string = "",
  ): EditorStateAction => resolveMentionReplacement(context, userId, name, trailingText),
  { context: resolveInlineTargetContext },
);

export const resizeImage = makeCommand(
  (context: InlineContext, inline: ImageResizeTarget, newWidth: number): EditorStateAction =>
    resolveImageResize(context.inlineContainer, inline, newWidth),
  { context: resolveInlineContext },
);

// --- History ---

export const undo = (state: EditorState) => undoEditorState(state);

export const redo = (state: EditorState) => redoEditorState(state);

// --- Structural operations (indent / dedent) ---

export const indent = makeCommand(
  (ctx) => {
    switch (ctx.kind) {
      case "tableCell":
        return resolveTableSelectionMove(ctx, 1);
      case "rootTextBlock":
        return resolveHeadingDepthShift(ctx, 1);
      case "listItem":
        return resolveListItemIndent(ctx);
      default:
        return null;
    }
  },
  { context: resolveBlockContext },
);

export const dedent = makeCommand(
  (ctx) => {
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
  },
  { context: resolveBlockContext },
);

// --- Lists & tasks ---

export const moveListItemUp = makeCommand((ctx) => resolveListItemMove(ctx, -1), {
  context: resolveListItemContext,
});

export const moveListItemDown = makeCommand((ctx) => resolveListItemMove(ctx, 1), {
  context: resolveListItemContext,
});

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
  { context: resolveTableCellContext },
);

export const deleteTableColumn = makeCommand(resolveTableColumnDeletion, {
  context: resolveTableCellContext,
});

export const insertTableRow = makeCommand(
  (ctx: TableCellContext, direction: "above" | "below") => resolveTableRowInsertion(ctx, direction),
  { context: resolveTableCellContext },
);

export const deleteTableRow = makeCommand(resolveTableRowDeletion, {
  context: resolveTableCellContext,
});

export const deleteTable = makeCommand(resolveTableDeletion, {
  context: resolveTableCellContext,
});

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

type CommandOptions<A extends unknown[] = []> = {
  animate?: CommandAnimator<A>;
};

type ContextCommandOptions<C, A extends unknown[] = []> = CommandOptions<A> & {
  context: ContextResolver<C, A>;
};

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
  options: ContextCommandOptions<C, A>,
): (state: EditorState, ...args: A) => CommandResult<R>;
function makeCommand<A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: StateActionResolver<A, R>,
  options?: CommandOptions<A>,
): (state: EditorState, ...args: A) => CommandResult<R>;
function makeCommand<C, A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: StateActionResolver<A, R> | ContextActionResolver<C, A, R>,
  options?: CommandOptions<A> | ContextCommandOptions<C, A>,
): (state: EditorState, ...args: A) => CommandResult<R> {
  return ((state: EditorState, ...args: A) => {
    const action =
      options && "context" in options
        ? resolveContextAction(resolveAction, options, state, args)
        : (resolveAction as StateActionResolver<A, R>)(state, ...args);

    if (!action) return null;

    const nextState = dispatch(state, action);
    return options?.animate?.(state, nextState, action, ...args) ?? nextState;
  }) as (state: EditorState, ...args: A) => CommandResult<R>;
}

function resolveContextAction<C, A extends unknown[], R extends EditorStateAction | null>(
  resolveAction: StateActionResolver<A, R> | ContextActionResolver<C, A, R>,
  options: ContextCommandOptions<C, A>,
  state: EditorState,
  args: A,
): R | null {
  const context = options.context(state, ...args);
  return context ? (resolveAction as ContextActionResolver<C, A, R>)(context, ...args) : null;
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

function deleteExpandedSelectionStage(state: EditorState) {
  return hasExpandedSelection(state) ? deleteSelection(state) : null;
}

function deleteStructuralStage(state: EditorState, direction: "backward" | "forward") {
  const ctx = resolveDeletionContext(state, direction);

  return dispatch(state, resolveStructuralDelete(state.documentIndex, ctx));
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
    { context: resolveInlineContext },
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
