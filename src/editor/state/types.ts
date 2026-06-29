// Editor state action contract: the union of all actions accepted by
// `dispatch`, plus the selection shape they may carry.
import type { Block, CommentThread, Document } from "@/document";
import type { BlockReferencedListItemInsertedEffect, EditorEffect } from "./effects";
import type { DocumentIndex } from "./index/types";
import type { EditorSelection, SelectionTarget } from "./selection";

export type EditorState = {
  // The current document state and selection,
  // denormalized for efficient lookup and mutation.
  documentIndex: DocumentIndex;
  selection: EditorSelection;

  // Undo/redo stack, which includes a distinct
  // document and selection state.
  history: HistoryEntry[];
  future: HistoryEntry[];
};

export type HistoryEntry = {
  // History stores documents vs. document indices to avoid
  // bloating memory with potentially large indices that won't be reused.
  document: Document;
  selection: EditorSelection;
};

type ActionEffectFields = {
  effect?: EditorEffect | BlockReferencedListItemInsertedEffect;
};

export type EditorStateAction =
  | ({
      kind: "replace-block";
      block: Block;
      blockPath: string;
      selection?: SelectionTarget | null;
    } & ActionEffectFields)
  | ({
      kind: "splice-blocks";
      blocks: Block[];
      count?: number;
      rootIndex: number;
      selection?: SelectionTarget | null;
    } & ActionEffectFields)
  | ({
      kind: "splice-text";
      range?: EditorSelection;
      selection?: SelectionTarget | null;
      text: string;
    } & ActionEffectFields)
  | ({
      kind: "splice-fragment";
      blocks: Block[];
    } & ActionEffectFields)
  | ({
      kind: "splice-comments";
      count: number;
      index: number;
      threads: CommentThread[];
    } & ActionEffectFields)
  | ({ kind: "keep-state" } & ActionEffectFields)
  | ({ kind: "set-selection"; selection: EditorSelection } & ActionEffectFields);
