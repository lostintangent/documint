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
  resolveListItemContext,
  resolveTableCellContext,
} from "./context";
import type { DocumentIndex } from "./index/types";
import type { EditorState, EditorStateAction } from "./types";
import type { EditorInline } from "./index/types";
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
} from "./actions/inline";
import {
  createImage,
  deleteCommentFromThread,
  editCommentInThread,
  markCommentThreadAsResolved as markThreadResolved,
  replyToCommentThread as appendThreadReply,
  type CommentThread,
} from "@/document";
import { resolveCharacterDelete } from "./actions/text";
import { resolveTextInputRule } from "./actions/input-rules";
import {
  resolveListItemDedent,
  resolveListItemIndent,
  resolveListItemMove,
  resolveListItemSplit,
  resolveListStructuralBackspace,
  resolveStructuralListBlockSplit,
} from "./actions/list";import {
  resolveBlockquoteBackspace,
  resolveBlockquoteTextBlockSplit,
  resolveHeadingDepthShift,
  resolveRootBlockBackspace,
  resolveRootTextBlockSplit,
  resolveStructuralBlockquoteSplit,
} from "./actions/block";
import {
  resolveTableCellLineBreak,
  resolveTableColumnDeletion,
  resolveTableColumnInsertion,
  resolveTableDeletion,
  resolveTableInsertion,
  resolveTableRowDeletion,
  resolveTableRowInsertion,
  resolveTableSelectionMove,
} from "./actions/table";

// --- Core editing ---

export function insertText(state: EditorState, text: string) {
  const operation = resolveTextInputRule(state.documentIndex, state.selection, text);
  let nextState = dispatch(state, operation);

  if (!nextState) {
    return null;
  }

  if (operation?.kind === "splice-text" && text.length > 0) {
    nextState = addInsertedTextHighlightAnimation(nextState, text.length);
  }

  if (text === ".") {
    nextState = addPunctuationPulseAnimation(nextState);
  }

  return nextState;
}

export function insertLineBreak(state: EditorState) {
  const ctx = resolveBlockCommandContext(state.documentIndex, state.selection);
  const offset = normalizeSelection(state.documentIndex, state.selection).start.offset;

  switch (ctx.kind) {
    case "code":
      return dispatch(state, { kind: "splice-text", selection: state.selection, text: "\n" });

    case "tableCell":
      return dispatch(state, resolveTableCellLineBreak(state.documentIndex, state.selection));

    case "listItem": {
      const action = resolveStructuralListBlockSplit(ctx, offset);
      return maybeAnimateListItemInsertion({
        state:
          dispatch(state, action) ??
          dispatch(state, resolveListItemSplit(ctx, offset)),
        action,
      });
    }

    case "blockquoteTextBlock":
      return (
        dispatch(state, resolveStructuralBlockquoteSplit(ctx, offset)) ??
        dispatch(state, resolveBlockquoteTextBlockSplit(ctx, offset))
      );

    case "rootTextBlock":
      return dispatch(state, resolveRootTextBlockSplit(ctx, offset));
      
    case "unsupported":
      return null;
  }
}

export function replaceSelection(state: EditorState, text: string) {
  const nextState = dispatch(state, {
    kind: "splice-text",
    selection: state.selection,
    text,
  });

  return text.length > 0 ? addInsertedTextHighlightAnimation(nextState, text.length) : nextState;
}

export function deleteSelection(state: EditorState) {
  return replaceSelection(state, "");
}

export function deleteBackward(state: EditorState) {
  if (hasExpandedSelection(state)) {
    return deleteSelection(state);
  }

  const characterDelete = deleteCollapsedCharacter(state, "backward");

  if (characterDelete) {
    return characterDelete;
  }

  const selection = normalizeSelection(state.documentIndex, state.selection);

  if (
    selection.start.regionId !== selection.end.regionId ||
    selection.start.offset !== 0 ||
    selection.end.offset !== 0
  ) {
    return null;
  }

  const ctx = resolveBlockCommandContext(state.documentIndex, state.selection);

  switch (ctx.kind) {
    case "listItem":
      return dispatch(state, resolveListStructuralBackspace(ctx));
    case "blockquoteTextBlock":
      return dispatch(state, resolveBlockquoteBackspace(ctx));
    case "rootTextBlock":
      return dispatch(state, resolveRootBlockBackspace(ctx, state.documentIndex));
    default:
      return null;
  }
}

export function deleteForward(state: EditorState) {
  if (hasExpandedSelection(state)) {
    return deleteSelection(state);
  }

  return deleteCollapsedCharacter(state, "forward");
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

// --- Structural operations (indent / dedent) ---

export function indent(state: EditorState) {
  const ctx = resolveBlockCommandContext(state.documentIndex, state.selection);

  switch (ctx.kind) {
    case "tableCell":
      return dispatch(state, resolveTableSelectionMove(state.documentIndex, state.selection, ctx, 1));
    case "rootTextBlock":
      return dispatch(state, resolveHeadingDepthShift(ctx, 1, state.selection.focus.offset));
    case "listItem":
      return dispatch(state, resolveListItemIndent(ctx));
    default:
      return null;
  }
}

export function dedent(state: EditorState) {
  const ctx = resolveBlockCommandContext(state.documentIndex, state.selection);

  switch (ctx.kind) {
    case "tableCell":
      return dispatch(state, resolveTableSelectionMove(state.documentIndex, state.selection, ctx, -1));
    case "rootTextBlock":
      return dispatch(state, resolveHeadingDepthShift(ctx, -1, state.selection.focus.offset));
    case "listItem":
      return dispatch(state, resolveListItemDedent(ctx));
    default:
      return null;
  }
}

// --- Lists & tasks ---

export const moveListItemUp = makeCommand(resolveListItemContext, (_, ctx) =>
  resolveListItemMove(ctx, -1),
);

export const moveListItemDown = makeCommand(resolveListItemContext, (_, ctx) =>
  resolveListItemMove(ctx, 1),
);

export function toggleTask(state: EditorState, listItemId: string) {
  const block = resolveBlockById(state.documentIndex, listItemId);

  if (!block || block.type !== "listItem" || typeof block.checked !== "boolean") {
    return null;
  }

  return dispatch(state, {
    kind: "replace-block",
    block: { ...block, checked: !block.checked },
    blockId: listItemId,
  });
}

// --- Tables ---

export function insertTable(state: EditorState, columnCount: number) {
  return dispatch(state, resolveTableInsertion(state.documentIndex, state.selection, columnCount));
}

export const insertTableColumn = makeCommand(
  resolveTableCellContextFromSelection,
  (_, ctx, direction: "left" | "right") => resolveTableColumnInsertion(ctx, direction),
);

export const deleteTableColumn = makeCommand(resolveTableCellContextFromSelection, (_, ctx) =>
  resolveTableColumnDeletion(ctx),
);

export const insertTableRow = makeCommand(
  resolveTableCellContextFromSelection,
  (_, ctx, direction: "above" | "below") => resolveTableRowInsertion(ctx, direction),
);

export const deleteTableRow = makeCommand(resolveTableCellContextFromSelection, (_, ctx) =>
  resolveTableRowDeletion(ctx),
);

export const deleteTable = makeCommand(resolveTableCellContextFromSelection, (_, ctx) =>
  resolveTableDeletion(ctx),
);

// --- Inline formatting ---

export function toggleBold(state: EditorState) {
  return toggleMark(state, "bold");
}

export function toggleItalic(state: EditorState) {
  return toggleMark(state, "italic");
}

export function toggleStrikethrough(state: EditorState) {
  return toggleMark(state, "strikethrough");
}

export function toggleUnderline(state: EditorState) {
  return toggleMark(state, "underline");
}

export function toggleCode(state: EditorState) {
  return applyInlineSelectionEdit(state, toggleInlineCode);
}

// --- Links ---

export function updateLink(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
  url: string,
) {
  return setLink(state, regionId, startOffset, endOffset, url);
}

export function removeLink(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
) {
  return setLink(state, regionId, startOffset, endOffset, null);
}

// --- Images ---

export function insertImage(state: EditorState, url: string, alt?: string) {
  return dispatch(
    state,
    insertInlineNode(state.documentIndex, state.selection, (path) =>
      createImage({ alt: alt ?? null, path, url }),
    ),
  );
}

export function resizeImage(
  state: EditorState,
  regionId: string,
  run: { start: number; end: number; image: NonNullable<EditorInline["image"]> },
  newWidth: number,
): EditorState | null {
  const inlineRegion = resolveInlineRegion(state.documentIndex, regionId);

  if (!inlineRegion) {
    return null;
  }

  const { image } = run;
  const replacement = insertInlineIntoRegion(inlineRegion, run.start, run.end, (path) =>
    createImage({ alt: image.alt, path, title: image.title, url: image.url, width: newWidth }),
  );

  return dispatch(state, {
    kind: "replace-block",
    block: replacement.block,
    blockId: replacement.blockId,
  });
}

// --- Comments ---

export function addComment(
  state: EditorState,
  selection: { endOffset: number; regionId: string; startOffset: number },
  body: string,
) {
  const thread = createCommentThreadForSelection(state.documentIndex, selection, body);

  if (!thread) {
    return null;
  }

  return spliceComments(state, state.documentIndex.document.comments.length, 0, [thread]);
}

export function replyToThread(state: EditorState, threadIndex: number, body: string) {
  return updateCommentThread(state, threadIndex, (thread) =>
    appendThreadReply(thread, { body: body.trim() }),
  );
}

export function editComment(
  state: EditorState,
  threadIndex: number,
  commentIndex: number,
  body: string,
) {
  return updateCommentThread(state, threadIndex, (thread) =>
    editCommentInThread(thread, commentIndex, body),
  );
}

export function deleteComment(state: EditorState, threadIndex: number, commentIndex: number) {
  return updateCommentThread(state, threadIndex, (thread) =>
    deleteCommentFromThread(thread, commentIndex),
  );
}

export function deleteThread(state: EditorState, threadIndex: number) {
  return updateCommentThread(state, threadIndex, () => null);
}

export function resolveThread(state: EditorState, threadIndex: number, resolved: boolean) {
  return updateCommentThread(state, threadIndex, (thread) => markThreadResolved(thread, resolved));
}

// --- History ---

export function undo(state: EditorState) {
  return undoEditorState(state);
}

export function redo(state: EditorState) {
  return redoEditorState(state);
}

// --- Private helpers ---

function makeCommand<C, A extends unknown[]>(
  resolveContext: (documentIndex: DocumentIndex, selection: EditorSelection) => C | null,
  resolveAction: (state: EditorState, context: C, ...args: A) => EditorStateAction | null,
): (state: EditorState, ...args: A) => EditorState | null {
  return (state, ...args) => {
    const context = resolveContext(state.documentIndex, state.selection);

    return context ? dispatch(state, resolveAction(state, context, ...args)) : null;
  };
}

function resolveTableCellContextFromSelection(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
) {
  return resolveTableCellContext(documentIndex, selection.focus.regionId);
}

function maybeAnimateListItemInsertion(result: {
  state: EditorState | null;
  action: EditorStateAction | null;
}): EditorState | null {
  if (
    !result.state ||
    !result.action ||
    result.action.kind !== "replace-block" ||
    !result.action.listItemInsertedPath
  ) {
    return result.state;
  }

  return addListMarkerPopAnimation(result.state, result.action.listItemInsertedPath);
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

function setLink(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
  url: string | null,
) {
  return dispatch(
    state,
    replaceExactInlineLinkRange(state.documentIndex, regionId, startOffset, endOffset, url),
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
  const resolved = resolveCharacterDelete(state, direction);

  if (!resolved) {
    return null;
  }

  const nextState = dispatch(state, resolved.action);

  if (!nextState) {
    return null;
  }

  return addPlainTextDeletionFadeAnimation(state, nextState, resolved.startOffset, resolved.endOffset);
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

  return spliceComments(state, threadIndex, 1, nextThread ? [nextThread] : []);
}

function spliceComments(
  state: EditorState,
  index: number,
  count: number,
  threads: CommentThread[],
) {
  return dispatch(state, {
    kind: "splice-comments",
    count,
    index,
    threads,
  });
}
