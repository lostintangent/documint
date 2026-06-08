// Editor state machine. Owns the central `dispatch` that turns an
// EditorStateAction (built by an action resolver, dispatched by a command)
// into the next EditorState — applying the document mutation, rebuilding
// the document index, resolving the post-edit selection, and pushing the
// previous state onto the history stack. Also owns the selection and
// undo/redo primitives commands call directly.
//
// Text-level mutations (single-region splice, cross-region merge, inline
// rewrites) live in ./text and ./inlines; this file handles the action
// dispatch, document index swap, selection clamping, and history.

import {
  createDocument,
  spliceCommentThreads,
  spliceDocument,
  trimTrailingWhitespace,
  type Document,
} from "@/document";
import { getCommentState } from "../../anchors";
import { recordEditorEffects, takeEditorEffects } from "../effects";
import {
  resolveActiveBlockKey,
  resolveBlockPathForRegion,
  resolveDocumentBoundaryRegion,
} from "../index/query";
import {
  createDocumentIndex,
  replaceDocumentMetadata,
  replaceEditorBlock,
  spliceDocumentIndex,
} from "../index/splice";
import type { DocumentIndex } from "../index/types";
import type { EditorState, EditorStateAction, HistoryEntry } from "../types";
import {
  resolveRegion,
  resolveSelectionTarget,
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

export function createDocumentFromEditorState(state: EditorState) {
  const commentState = getCommentState(state.documentIndex);

  return createDocument(
    trimTrailingWhitespace(state.documentIndex.document.blocks),
    commentState.threads,
    state.documentIndex.document.frontMatter,
  );
}

/* Action dispatch */

export function dispatch(state: EditorState, action: EditorStateAction): EditorState;
export function dispatch(state: EditorState, action: EditorStateAction | null): EditorState | null;
export function dispatch(state: EditorState, action: EditorStateAction | null) {
  if (!action) {
    return null;
  }

  const nextState = reduceEditorStateAction(state, action);
  if (!nextState || !action.effect) {
    return nextState;
  }

  // `reduceEditorStateAction` may emit derived effects while resolving the
  // post-edit selection. Re-record them after the action effect so consumers
  // see the edit's semantic event before selection-derived follow-ups.
  const postEditEffects = takeEditorEffects(nextState);
  return recordEditorEffects(nextState, [action.effect, ...postEditEffects]);
}

function reduceEditorStateAction(
  state: EditorState,
  action: EditorStateAction,
): EditorState | null {
  switch (action.kind) {
    case "keep-state":
      return state;

    case "set-selection":
      return setSelection(state, action.selection);

    case "replace-block": {
      const nextDocumentIndex = replaceEditorBlock(
        state.documentIndex,
        action.blockId,
        () => action.block,
      );
      return nextDocumentIndex
        ? applyDocumentMutation(state, nextDocumentIndex, action.selection ?? null)
        : null;
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

    case "splice-comments": {
      const document = spliceCommentThreads(
        state.documentIndex.document,
        action.index,
        action.count,
        action.threads,
      );
      return applyDocumentMutation(
        state,
        replaceDocumentMetadata(state.documentIndex, document),
        null,
      );
    }
  }
}

function applyDocumentMutation(
  state: EditorState,
  documentIndex: DocumentIndex,
  selection: SelectionTarget | null,
): EditorState {
  const nextState = pushHistory(state, documentIndex);

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
    "regionId" in selection
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

  const blockPath =
    resolveBlockPathForRegion(nextState.documentIndex, nextState.selection.focus.regionId) ?? "";

  return recordEditorEffects(
    nextState,
    blockPath ? [{ blockPath, kind: "active-block-changed" }] : [],
  );
}

export function setSelectionPoint(
  state: EditorState,
  regionId: string,
  offset: number,
  extendSelection: boolean,
): EditorState {
  const point: EditorSelectionPoint = { regionId, offset };

  return setSelection(
    state,
    extendSelection ? { anchor: state.selection.anchor, focus: point } : point,
  );
}

/* History */

export function pushHistory(state: EditorState, documentIndex: DocumentIndex): EditorState {
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

  return restoreHistoryEntry(previous, {
    future: [snapshotState(state), ...state.future],
    history: state.history.slice(0, -1),
  });
}

export function redoEditorState(state: EditorState): EditorState {
  const next = state.future[0];

  if (!next) {
    return state;
  }

  return restoreHistoryEntry(next, {
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
  entry: HistoryEntry,
  stacks: { future: HistoryEntry[]; history: HistoryEntry[] },
): EditorState {
  return {
    documentIndex: createDocumentIndex(entry.document),
    future: stacks.future,
    history: stacks.history,
    selection: entry.selection,
  };
}

/* Internal helpers */

function resolveDefaultSelectionPoint(documentIndex: DocumentIndex): EditorSelectionPoint {
  const region = resolveDocumentBoundaryRegion(documentIndex, "start");

  return region ? { regionId: region.id, offset: 0 } : { regionId: "empty", offset: 0 };
}

function clampSelectionPoint(
  documentIndex: DocumentIndex,
  point: EditorSelectionPoint,
): EditorSelectionPoint {
  const region = resolveRegion(documentIndex, point.regionId);

  if (!region) {
    return point;
  }

  return {
    regionId: region.id,
    offset: Math.max(0, Math.min(point.offset, region.text.length)),
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
  const region = resolveRegion(documentIndex, point.regionId);

  return Boolean(region && point.offset >= 0 && point.offset <= region.text.length);
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
