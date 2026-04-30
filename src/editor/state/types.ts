// Editor state action contract: the union of all actions accepted by
// `dispatch`, plus the selection shape they may carry.
import type { Block, CommentThread, Document } from "@/document";
import type { EditorAnimation } from "./animations";
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

  // Transient editor animations that are actively
  // running, but aren't meant to be persisted.
  animations: EditorAnimation[];
};

export type HistoryEntry = {
  // History stores documents vs. document indices to avoid
  // bloating memory with potentially large indices that won't be reused.
  document: Document;
  selection: EditorSelection;
};

export type ActionSelection = EditorSelection | SelectionTarget;

export type EditorStateAction =
  | {
      kind: "replace-block";
      block: Block;
      blockId: string;
      listItemInsertedPath?: string;
      selection?: ActionSelection | null;
    }
  | {
      kind: "splice-blocks";
      blocks: Block[];
      count?: number;
      rootIndex: number;
      selection?: ActionSelection | null;
    }
  | {
      kind: "splice-text";
      selection: EditorSelection;
      text: string;
    }
  | {
      kind: "splice-fragment";
      fragment: Block[];
      selection: EditorSelection;
    }
  | {
      kind: "splice-comments";
      count: number;
      index: number;
      threads: CommentThread[];
    }
  | { kind: "keep-state" }
  | { kind: "set-selection"; selection: EditorSelection };
