// Editor state machine. Owns the central `dispatch` that turns an
// EditorStateAction (built by an action resolver, dispatched by a command)
// into the next EditorState — applying the document mutation, rebuilding
// the document index, resolving the post-edit selection, and pushing the
// previous state onto the history stack. Also owns the selection and
// undo/redo primitives commands call directly.
//
// Text-level mutations (single-path splice, cross-path merge, inline
// rewrites) live in ./text and ./inlines; this file handles the action
// dispatch, document index swap, selection clamping, and history.

import {
  blockPathCoordinates,
  blockPathFromCoordinates,
  findBlockChildIndicesByReference,
  spliceCommentThreads,
  spliceDocument,
  type Block,
  type Document,
} from "@/document";
import { carryComments } from "../../anchors";
import { recordEditorEffects, takeEditorEffects, type EditorEffect } from "../effects";
import {
  resolveActiveBlockKey,
  resolveDocumentTextPathBoundary,
  resolveEditorTextAtPath,
  resolveIndexedBlock,
  resolveIndexedBlockContainingPath,
} from "../index/query";
import {
  createDocumentIndex,
  replaceIndexedDocument,
  replaceEditorBlock,
  spliceDocumentIndex,
} from "../index/splice";
import type { DocumentIndex } from "../index/types";
import type { EditorState, EditorStateAction, HistoryEntry } from "../types";
import {
  resolveSelectionTarget,
  target,
  type EditorSelection,
  type EditorSelectionPoint,
  type SelectionTarget,
} from "../selection";
import { replaceWithBlocks, spliceText } from "./text";

/* Initialization */

export function createEditorState(document: Document): EditorState {
  const documentIndex = createDocumentIndex(document);
  const initialPoint = resolveDefaultSelectionPoint(documentIndex);

  return {
    documentIndex,
    future: [],
    history: [],
    selection: {
      anchor: initialPoint,
      focus: initialPoint,
    },
  };
}

/* Action dispatch */

export function dispatch(state: EditorState, action: EditorStateAction): EditorState {
  // Block references in the action (selection targets, effects) are only
  // meaningful against the action payload. Translate them into positional form
  // first, against the pre-edit index, before the document is committed.
  const materialized = materializeBlockReferences(state.documentIndex, action);

  const nextState = reduceEditorStateAction(state, materialized);
  if (nextState === state || !materialized.effect) {
    return nextState;
  }

  // `reduceEditorStateAction` may emit derived effects while resolving the
  // post-edit selection. Re-record them after the action effect so consumers
  // see the edit's semantic event before selection-derived follow-ups.
  const postEditEffects = takeEditorEffects(nextState);
  return recordEditorEffects(nextState, [materialized.effect, ...postEditEffects]);
}

function reduceEditorStateAction(state: EditorState, action: EditorStateAction): EditorState {
  switch (action.kind) {
    case "keep-state":
      return state;

    case "set-selection":
      return setSelection(state, action.selection);

    case "replace-block": {
      const nextDocumentIndex = replaceEditorBlock(
        state.documentIndex,
        action.blockPath,
        () => action.block,
      );
      return nextDocumentIndex
        ? applyDocumentMutation(state, nextDocumentIndex, action.selection ?? null)
        : state;
    }

    case "splice-blocks": {
      const count = action.count ?? 1;
      const document = spliceDocument(
        state.documentIndex.document,
        action.rootIndex,
        count,
        action.blocks,
      );
      return applyDocumentMutation(
        state,
        spliceDocumentIndex(state.documentIndex, document, action.rootIndex, count),
        action.selection ?? null,
      );
    }

    case "splice-text": {
      const result = spliceText(state.documentIndex, action.range ?? state.selection, action.text);
      if (!result) {
        return state;
      }

      return applyDocumentMutation(
        state,
        result.documentIndex,
        action.selection ?? result.selection,
      );
    }

    case "splice-fragment": {
      const result = replaceWithBlocks(state.documentIndex, state.selection, action.blocks);
      return applyDocumentMutation(state, result.documentIndex, result.selection);
    }

    case "splice-metadata": {
      const metadata = state.documentIndex.document.metadata;
      if (!metadata || "raw" in metadata) {
        return state;
      }

      const entries = [...metadata];
      if (action.index < 0 || action.count < 0 || action.index + action.count > entries.length) {
        return state;
      }

      entries.splice(action.index, action.count, ...action.entries);
      const nextMetadata = new Map(entries);
      if (nextMetadata.size !== entries.length) {
        return state;
      }

      const document = { ...state.documentIndex.document, metadata: nextMetadata };
      return applyDocumentMutation(
        state,
        replaceIndexedDocument(state.documentIndex, document),
        null,
      );
    }

    case "splice-comments": {
      const document = spliceCommentThreads(
        state.documentIndex.document,
        action.index,
        action.count,
        action.threads,
      );
      return applyDocumentMutation(
        state,
        carryComments(state.documentIndex, replaceIndexedDocument(state.documentIndex, document), {
          splice: action,
        }),
        null,
      );
    }
  }
}

/* Block-reference materialization */

// Actions may address "the block I just built" by reference into their own
// payload (`target.block(block)` selection targets, block-referenced effects).
// Those references are translated here before the edit applies. The translation
// produces positional coordinates that stay valid after commit because document
// construction preserves the payload's structural order.
type MaterializedEditorStateAction = EditorStateAction & { effect?: EditorEffect };

function materializeBlockReferences(
  documentIndex: DocumentIndex,
  action: EditorStateAction,
): MaterializedEditorStateAction {
  const blockSelection = blockReferenceSelection(action);
  const blockEffect = action.effect?.kind === "list-item-inserted-block" ? action.effect : null;

  if (action.kind !== "replace-block" && action.kind !== "splice-blocks") {
    if (blockSelection || blockEffect) {
      throw new Error("Block-reference selections and effects require a block payload action.");
    }

    return action as MaterializedEditorStateAction;
  }

  if (!blockSelection && !blockEffect) {
    return action as MaterializedEditorStateAction;
  }

  const payload = resolveBlockPayloadBase(documentIndex, action);
  const materialized = { ...action };

  if (blockSelection) {
    const located = locateBlockInPayload(payload, blockSelection.block);
    materialized.selection = target.blockPath(
      blockPathForLocatedBlock(located),
      blockSelection.offset,
    );
  }

  if (blockEffect) {
    const located = locateBlockInPayload(payload, blockEffect.block);
    materialized.effect = {
      blockPath: blockPathForLocatedBlock(located),
      kind: "list-item-inserted",
    };
  }

  return materialized as MaterializedEditorStateAction;
}

function blockReferenceSelection(action: EditorStateAction) {
  if (!("selection" in action) || action.kind === "set-selection") {
    return null;
  }

  return action.selection?.kind === "block" ? action.selection : null;
}

type BlockPayloadBase = {
  baseChildIndices: readonly number[];
  baseRootIndex: number;
  roots: readonly Block[];
};

// The coordinate frame the action's payload lands in: `splice-blocks` payloads
// are whole roots at `action.rootIndex`; a `replace-block` payload sits at the
// replaced block's existing position, which the pre-edit index knows.
function resolveBlockPayloadBase(
  documentIndex: DocumentIndex,
  action: Extract<EditorStateAction, { kind: "replace-block" | "splice-blocks" }>,
): BlockPayloadBase {
  if (action.kind === "splice-blocks") {
    return { baseChildIndices: [], baseRootIndex: action.rootIndex, roots: action.blocks };
  }

  const indexedBlock = resolveIndexedBlock(documentIndex, action.blockPath);

  if (!indexedBlock) {
    throw new Error(`Unknown block for block-reference target: ${action.blockPath}`);
  }

  return {
    baseChildIndices: blockPathCoordinates(indexedBlock.path)?.childIndices ?? [],
    baseRootIndex: indexedBlock.rootIndex,
    roots: [action.block],
  };
}

function locateBlockInPayload(
  payload: BlockPayloadBase,
  block: Block,
): { childIndices: number[]; rootIndex: number } {
  const found = findBlockChildIndicesByReference(payload.roots, block);

  if (!found) {
    throw new Error("Block-reference target is not present in the action's block payload.");
  }

  return {
    childIndices: [...payload.baseChildIndices, ...found.childIndices],
    rootIndex: payload.baseRootIndex + found.rootOffset,
  };
}

function blockPathForLocatedBlock(location: {
  childIndices: readonly number[];
  rootIndex: number;
}) {
  const blockPath = blockPathFromCoordinates(location.rootIndex, location.childIndices);
  if (!blockPath) {
    throw new Error("Block-reference target resolved to an invalid block path.");
  }

  return blockPath;
}

function applyDocumentMutation(
  state: EditorState,
  documentIndex: DocumentIndex,
  selection: SelectionTarget | null,
): EditorState {
  const nextState = pushHistory(state, carryComments(state.documentIndex, documentIndex));

  if (!selection && canPreserveSelection(documentIndex, state.selection)) {
    return {
      ...nextState,
      selection: state.selection,
    };
  }

  const resolvedSelection =
    resolveSelectionTarget(nextState.documentIndex, selection) ?? state.selection;

  const blockChanged = didActiveBlockChange(state, nextState, resolvedSelection);
  return setSelection(nextState, resolvedSelection, blockChanged);
}

/* Selection */

export function setSelection(
  state: EditorState,
  selection: EditorSelection | EditorSelectionPoint,
  activeBlockChanged?: boolean,
): EditorState {
  const nextSelection: EditorSelection =
    "path" in selection
      ? {
          anchor: clampSelectionPoint(state.documentIndex, selection),
          focus: clampSelectionPoint(state.documentIndex, selection),
        }
      : {
          anchor: clampSelectionPoint(state.documentIndex, selection.anchor),
          focus: clampSelectionPoint(state.documentIndex, selection.focus),
        };

  const nextState: EditorState = {
    ...state,
    selection: nextSelection,
  };

  const shouldFlash = activeBlockChanged ?? didActiveBlockChange(state, nextState);

  if (!shouldFlash) {
    return nextState;
  }

  const focusedBlock = resolveIndexedBlockContainingPath(
    nextState.documentIndex,
    nextState.selection.focus.path,
  );
  const blockPath = focusedBlock?.path ?? null;

  return recordEditorEffects(
    nextState,
    blockPath ? [{ blockPath, kind: "active-block-changed" }] : [],
  );
}

export function setSelectionPoint(
  state: EditorState,
  path: string,
  offset: number,
  extendSelection: boolean,
): EditorState {
  const point: EditorSelectionPoint = { path, offset };

  return setSelection(
    state,
    extendSelection ? { anchor: state.selection.anchor, focus: point } : point,
  );
}

/* History */

function pushHistory(state: EditorState, documentIndex: DocumentIndex): EditorState {
  const point = resolveDefaultSelectionPoint(documentIndex);

  return {
    documentIndex,
    future: [],
    history: [
      ...state.history,
      { document: state.documentIndex.document, selection: state.selection },
    ],
    selection: { anchor: point, focus: point },
  };
}

export function undoEditorState(state: EditorState): EditorState {
  const previous = state.history.at(-1);

  if (!previous) {
    return state;
  }

  return restoreHistoryEntry(state, previous, {
    future: [snapshotState(state), ...state.future],
    history: state.history.slice(0, -1),
  });
}

export function redoEditorState(state: EditorState): EditorState {
  const next = state.future[0];

  if (!next) {
    return state;
  }

  return restoreHistoryEntry(state, next, {
    future: state.future.slice(1),
    history: [...state.history, snapshotState(state)],
  });
}

function snapshotState(state: EditorState): HistoryEntry {
  return {
    document: state.documentIndex.document,
    selection: state.selection,
  };
}

function restoreHistoryEntry(
  state: EditorState,
  entry: HistoryEntry,
  stacks: { future: HistoryEntry[]; history: HistoryEntry[] },
): EditorState {
  const documentIndex =
    entry.document.blocks === state.documentIndex.document.blocks
      ? replaceIndexedDocument(state.documentIndex, entry.document)
      : createDocumentIndex(entry.document);

  return {
    documentIndex,
    future: stacks.future,
    history: stacks.history,
    selection: entry.selection,
  };
}

/* Internal helpers */

function resolveDefaultSelectionPoint(documentIndex: DocumentIndex): EditorSelectionPoint {
  const path =
    resolveDocumentTextPathBoundary(documentIndex, "start") ?? documentIndex.blocks[0]?.path;

  if (!path) {
    throw new Error("Document index must contain at least one selectable block.");
  }

  return { path, offset: 0 };
}

function clampSelectionPoint(
  documentIndex: DocumentIndex,
  point: EditorSelectionPoint,
): EditorSelectionPoint {
  const text = resolveEditorTextAtPath(documentIndex, point.path);

  if (text === null) {
    return point;
  }

  return {
    path: point.path,
    offset: Math.max(0, Math.min(point.offset, text.length)),
  };
}

function canPreserveSelection(documentIndex: DocumentIndex, selection: EditorSelection): boolean {
  return (
    canPreserveSelectionPoint(documentIndex, selection.anchor) &&
    canPreserveSelectionPoint(documentIndex, selection.focus)
  );
}

function canPreserveSelectionPoint(
  documentIndex: DocumentIndex,
  point: EditorSelectionPoint,
): boolean {
  const text = resolveEditorTextAtPath(documentIndex, point.path);
  return text !== null && point.offset >= 0 && point.offset <= text.length;
}

function didActiveBlockChange(
  previousState: EditorState,
  nextState: EditorState,
  nextSelection?: EditorSelection,
): boolean {
  const previousKey = resolveActiveBlockKey(
    previousState.documentIndex,
    previousState.selection.focus,
  );
  const nextKey = resolveActiveBlockKey(
    nextState.documentIndex,
    (nextSelection ?? nextState.selection).focus,
  );

  return nextKey !== null && nextKey !== previousKey;
}
