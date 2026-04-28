// Editor commands: composable EditorState → EditorState | null functions.
// Each command resolves an action, dispatches it, and applies any
// side-effects (animations). These are the public API consumed by tests,
// benchmarks, and the Editor facade.
//
// Structural commands (insertLineBreak, deleteBackward, indent, dedent) use
// context-first dispatch: they resolve the block command context once, then
// switch on context.kind to call the appropriate resolver.

import {
  addDeletedTextFadeAnimation,
  addInsertedTextHighlightAnimation,
  addListMarkerPopAnimation,
  addPunctuationPulseAnimation,
} from "./animations";
import {
  type EditorSelection,
  normalizeSelection,
  resolveRegion,
} from "./selection";
import {
  dispatch,
  redoEditorState,
  setSelection,
  undoEditorState,
} from "./reducer/state";
import { resolveBlockById, resolveBlockCommandContext, resolveListItemContext, resolveTableCellContext } from "./index/context";
import type { DocumentIndex } from "./index/types";
import type { EditorState, EditorStateAction } from "./types";
import { createCommentThreadForSelection, getCommentState } from "../anchors";
import {
  type InlineCommandReplacement,
  insertInlineNode,
  replaceExactInlineLinkRange,
  replaceInlineRange,
  type InlineCommandTarget,
  toggleInlineCodeTarget,
  toggleInlineMarkTarget,
} from "./actions/inline";
import {
  createImage,
  deleteCommentFromThread,
  editCommentInThread,
  markCommentThreadAsResolved as markThreadResolved,
  replyToCommentThread as replyToThread,
  type CommentThread,
} from "@/document";
import { resolveTextInputRule } from "./actions/input-rules";
import {
  resolveListItemDedent,
  resolveListItemIndent,
  resolveListItemMove,
  resolveListStructuralBackspace,
  resolveStructuralListBlockSplit,
} from "./actions/list";
import {
  resolveBlockStructuralBackspace,
  resolveCodeLineBreak,
  resolveHeadingDepthShift,
  resolveStructuralBlockquoteSplit,
  resolveTextBlockSplit,
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

// --- Core editing commands ---

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

  switch (ctx.kind) {
    case "code":
      return dispatch(state, resolveCodeLineBreak(state.documentIndex, state.selection));
    case "tableCell":
      return dispatch(state, resolveTableCellLineBreak(state.documentIndex, state.selection));
    case "listItem": {
      const action = resolveStructuralListBlockSplit(state.documentIndex, state.selection, ctx);
      return maybeAnimateListItemInsertion({
        state:
          dispatch(state, action) ??
          dispatch(state, resolveTextBlockSplit(state.documentIndex, state.selection)),
        action,
      });
    }
    case "blockquoteTextBlock":
      return (
        dispatch(state, resolveStructuralBlockquoteSplit(state.documentIndex, state.selection)) ??
        dispatch(state, resolveTextBlockSplit(state.documentIndex, state.selection))
      );
    case "rootTextBlock":
      return dispatch(state, resolveTextBlockSplit(state.documentIndex, state.selection));
    case "unsupported":
      return null;
  }
}

export function deleteBackward(state: EditorState) {
  if (hasExpandedSelection(state)) {
    return deleteSelectionText(state);
  }

  const characterDelete = deleteCharacterBackward(state);

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
    case "rootTextBlock":
      return dispatch(state, resolveBlockStructuralBackspace(state.documentIndex, state.selection));
    default:
      return null;
  }
}

export function deleteForward(state: EditorState) {
  if (hasExpandedSelection(state)) {
    return deleteSelectionText(state);
  }

  return deleteCharacterForward(state);
}

// --- Selection text operations ---

function replaceSelectionText(state: EditorState, text: string) {
  return dispatch(state, {
    kind: "splice-text",
    selection: state.selection,
    text,
  });
}

export function insertSelectionText(state: EditorState, text: string) {
  const nextState = replaceSelectionText(state, text);

  return text.length > 0 ? addInsertedTextHighlightAnimation(nextState, text.length) : nextState;
}

export function deleteSelectionText(state: EditorState) {
  return replaceSelectionText(state, "");
}

export function insertImage(state: EditorState, url: string, alt?: string) {
  return dispatch(
    state,
    insertInlineNode(state.documentIndex, state.selection, (path) =>
      createImage({ alt: alt ?? null, path, url }),
    ),
  );
}

// --- Select operations ---

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

// --- Structural operations ---

export function indent(state: EditorState) {
  const ctx = resolveBlockCommandContext(state.documentIndex, state.selection);

  switch (ctx.kind) {
    case "tableCell":
      return dispatch(state, resolveTableSelectionMove(state.documentIndex, state.selection, ctx, 1));
    case "rootTextBlock":
      return dispatch(state, resolveHeadingDepthShift(state.documentIndex, state.selection, 1));
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
      return dispatch(state, resolveHeadingDepthShift(state.documentIndex, state.selection, -1));
    case "listItem":
      return dispatch(state, resolveListItemDedent(ctx));
    default:
      return null;
  }
}

// --- List operations ---

export const moveListItemUp = makeCommand(resolveListItemContext, (_, ctx) =>
  resolveListItemMove(ctx, -1),
);

export const moveListItemDown = makeCommand(resolveListItemContext, (_, ctx) =>
  resolveListItemMove(ctx, 1),
);

// --- Table operations ---

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

function toggleMark(
  state: EditorState,
  mark: "italic" | "bold" | "strikethrough" | "underline",
) {
  return applyInlineSelectionEdit(state, (target, startOffset, endOffset) =>
    toggleInlineMarkTarget(target, startOffset, endOffset, mark),
  );
}

export function toggleInlineCode(state: EditorState) {
  return applyInlineSelectionEdit(state, (target, startOffset, endOffset) =>
    toggleInlineCodeTarget(target, startOffset, endOffset),
  );
}

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

// --- Links ---

export function updateInlineLink(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
  url: string,
) {
  return dispatch(
    state,
    replaceExactInlineLinkRange(state.documentIndex, regionId, startOffset, endOffset, url),
  );
}

export function removeInlineLink(
  state: EditorState,
  regionId: string,
  startOffset: number,
  endOffset: number,
) {
  return dispatch(
    state,
    replaceExactInlineLinkRange(state.documentIndex, regionId, startOffset, endOffset, null),
  );
}

// --- Task items ---

export function toggleTaskItem(state: EditorState, listItemId: string) {
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

// --- History ---

export function undo(state: EditorState) {
  return undoEditorState(state);
}

export function redo(state: EditorState) {
  return redoEditorState(state);
}

// --- Comments ---

export function createCommentThread(
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

export function replyToCommentThread(state: EditorState, threadIndex: number, body: string) {
  return updateCommentThread(state, threadIndex, (thread) =>
    replyToThread(thread, { body: body.trim() }),
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

export function deleteCommentThread(state: EditorState, threadIndex: number) {
  return updateCommentThread(state, threadIndex, () => null);
}

export function resolveCommentThread(state: EditorState, threadIndex: number, resolved: boolean) {
  return updateCommentThread(state, threadIndex, (thread) => markThreadResolved(thread, resolved));
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

function applyInlineSelectionEdit(
  state: EditorState,
  applyTargetEdit: (
    target: InlineCommandTarget,
    startOffset: number,
    endOffset: number,
  ) => InlineCommandReplacement | null,
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
      applyTargetEdit,
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

function deleteCharacterBackward(state: EditorState) {
  return deleteCollapsedCharacter(state, "backward");
}

function deleteCharacterForward(state: EditorState) {
  return deleteCollapsedCharacter(state, "forward");
}

function deleteCollapsedCharacter(state: EditorState, direction: "backward" | "forward") {
  if (
    state.selection.anchor.regionId !== state.selection.focus.regionId ||
    state.selection.anchor.offset !== state.selection.focus.offset
  ) {
    return null;
  }

  const region = resolveRegion(state.documentIndex, state.selection.focus.regionId);

  if (!region) {
    return null;
  }

  if (direction === "forward" && state.selection.focus.offset >= region.text.length) {
    return null;
  }

  const startOffset =
    direction === "backward"
      ? previousGraphemeOffset(region.text, state.selection.focus.offset)
      : state.selection.focus.offset;
  const endOffset =
    direction === "backward"
      ? state.selection.focus.offset
      : nextGraphemeOffset(region.text, state.selection.focus.offset);

  if (startOffset === endOffset) {
    return null;
  }

  const nextState = replaceSelectionText(
    setSelection(state, {
      anchor: {
        regionId: region.id,
        offset: startOffset,
      },
      focus: {
        regionId: region.id,
        offset: endOffset,
      },
    }),
    "",
  );

  return maybeAddDeletedTextFadeAnimation(state, nextState, startOffset, endOffset);
}

function maybeAddDeletedTextFadeAnimation(
  previousState: EditorState,
  nextState: EditorState,
  startOffset: number,
  endOffset: number,
) {
  const deletedTextFade = resolveDeletedTextFadeAnimation(previousState, startOffset, endOffset);

  return deletedTextFade ? addDeletedTextFadeAnimation(nextState, deletedTextFade) : nextState;
}

function resolveDeletedTextFadeAnimation(
  state: EditorState,
  startOffset: number,
  endOffset: number,
) {
  const region = state.documentIndex.regionIndex.get(state.selection.focus.regionId);

  if (!region) {
    return null;
  }

  const deletedText = region.text.slice(startOffset, endOffset);

  if (deletedText.length === 0) {
    return null;
  }

  const deletedInline = region.inlines.find(
    (inline) =>
      inline.start <= startOffset &&
      inline.end >= endOffset &&
      inline.kind === "text" &&
      inline.link === null &&
      inline.marks.length === 0,
  );

  if (!deletedInline) {
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
