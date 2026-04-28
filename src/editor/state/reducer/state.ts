// Editor state machine. Manages document mutations, selection, undo/redo,
// and action dispatch. All state transitions flow through `dispatch`.

import {
  createDocument,
  spliceCommentThreads,
  spliceDocument,
  trimTrailingWhitespace,
  type Document,
} from "@/document";
import { getCommentState } from "../../anchors";
import {
  addActiveBlockFlashAnimation,
  getEditorAnimationTime,
  pruneEditorAnimations,
  resolveFocusedBlockPath,
} from "../animations";
import {
  createDocumentIndex,
  replaceEditorBlock,
  replaceIndexedDocument,
} from "../index/build";
import type { DocumentIndex } from "../index/types";
import type { ActionSelection, EditorState, EditorStateAction } from "../types";
import {
  resolveRegion,
  resolveSelectionTarget,
  type EditorSelection,
  type EditorSelectionPoint,
} from "../selection";
import { spliceText } from "./text";

/* Initialization */

export function createEditorState(document: Document): EditorState {
  const documentIndex = createDocumentIndex(document);
  const initialPoint = resolveDefaultSelectionPoint(documentIndex);

  return {
    animations: [],
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

  switch (action.kind) {
    case "keep-state":
      return state;

    case "set-selection":
      return setSelection(state, action.selection);

    case "replace-block": {
      const document = replaceEditorBlock(
        state.documentIndex,
        action.blockId,
        () => action.block,
      );
      return document
        ? applyDocumentMutation(state, createDocumentIndex(document), action.selection ?? null)
        : null;
    }

    case "splice-blocks": {
      const document = spliceDocument(
        state.documentIndex.document,
        action.rootIndex,
        action.count ?? 1,
        action.blocks,
      );
      return applyDocumentMutation(state, createDocumentIndex(document), action.selection ?? null);
    }

    case "splice-text": {
      const result = spliceText(state.documentIndex, action.selection, action.text);
      return applyDocumentMutation(state, result.documentIndex, result.selection);
    }

    case "splice-comments": {
      const document = spliceCommentThreads(
        state.documentIndex.document,
        action.index,
        action.count,
        action.threads,
      );
      return applyDocumentMutation(state, replaceIndexedDocument(state.documentIndex, document), null);
    }
  }
}

function applyDocumentMutation(
  state: EditorState,
  documentIndex: DocumentIndex,
  selection: ActionSelection | null,
): EditorState {
  const nextState = pushHistory(state, documentIndex);
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

  return shouldFlash
    ? addActiveBlockFlashAnimation(nextState, resolveFocusedBlockPath(nextState))
    : nextState;
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
  return {
    animations: pruneEditorAnimations(state.animations, getEditorAnimationTime()),
    documentIndex,
    future: [],
    history: [
      ...state.history,
      { document: state.documentIndex.document, selection: state.selection },
    ],
    selection: createCollapsedSelectionAtDefaultPoint(documentIndex),
  };
}

export function undoEditorState(state: EditorState): EditorState {
  const previous = state.history.at(-1);
  if (!previous) {
    return state;
  }

  const documentIndex = createDocumentIndex(previous.document);

  return {
    animations: [],
    documentIndex,
    future: [
      { document: state.documentIndex.document, selection: state.selection },
      ...state.future,
    ],
    history: state.history.slice(0, -1),
    selection: previous.selection,
  };
}

export function redoEditorState(state: EditorState): EditorState {
  const next = state.future[0];
  if (!next) {
    return state;
  }

  const documentIndex = createDocumentIndex(next.document);

  return {
    animations: [],
    documentIndex,
    future: state.future.slice(1),
    history: [
      ...state.history,
      { document: state.documentIndex.document, selection: state.selection },
    ],
    selection: next.selection,
  };
}

/* Internal helpers */

function createCollapsedSelectionAtDefaultPoint(documentIndex: DocumentIndex): EditorSelection {
  const point = resolveDefaultSelectionPoint(documentIndex);

  return {
    anchor: point,
    focus: point,
  };
}

function resolveDefaultSelectionPoint(documentIndex: DocumentIndex): EditorSelectionPoint {
  return documentIndex.regions[0]
    ? { regionId: documentIndex.regions[0].id, offset: 0 }
    : { regionId: "empty", offset: 0 };
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

function didActiveBlockChange(
  previousState: EditorState,
  nextState: EditorState,
  nextSelection?: EditorSelection,
): boolean {
  const previousKey = resolveActiveBlockKey(previousState.documentIndex, previousState.selection);
  const nextKey = resolveActiveBlockKey(
    nextState.documentIndex,
    nextSelection ?? nextState.selection,
  );

  return nextKey !== null && nextKey !== previousKey;
}

function resolveActiveBlockKey(
  documentIndex: DocumentIndex,
  selection: EditorSelection,
): string | null {
  const focusedRegion = documentIndex.regionIndex.get(selection.focus.regionId);
  const focusedBlock = focusedRegion
    ? (documentIndex.blockIndex.get(focusedRegion.blockId) ?? null)
    : null;

  if (!focusedRegion || !focusedBlock?.path) {
    return null;
  }

  return focusedBlock.type === "table"
    ? `cell:${focusedRegion.path}`
    : `block:${focusedBlock.path}`;
}
