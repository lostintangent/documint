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

export type AnimationIntent =
  | {
      endOffset: number;
      kind: "text-highlight";
      regionPath: string;
      startOffset: number;
    }
  | {
      kind: "text-fade";
      regionPath: string;
      startOffset: number;
      text: string;
    }
  | {
      kind: "text-pulse";
      offset: number;
      regionPath: string;
    }
  | {
      blockPath: string;
      kind: "block-pulse";
    };

type ActionAnimationFields = {
  animation?: AnimationIntent;
};

export type EditorStateAction =
  | ({
      kind: "replace-block";
      block: Block;
      blockId: string;
      selection?: SelectionTarget | null;
    } & ActionAnimationFields)
  | ({
      kind: "splice-blocks";
      blocks: Block[];
      count?: number;
      rootIndex: number;
      selection?: SelectionTarget | null;
    } & ActionAnimationFields)
  | ({
      kind: "splice-text";
      range?: EditorSelection;
      selection?: SelectionTarget | null;
      text: string;
    } & ActionAnimationFields)
  | ({
      kind: "splice-fragment";
      blocks: Block[];
    } & ActionAnimationFields)
  | ({
      kind: "splice-comments";
      count: number;
      index: number;
      threads: CommentThread[];
    } & ActionAnimationFields)
  | ({ kind: "keep-state" } & ActionAnimationFields)
  | ({ kind: "set-selection"; selection: EditorSelection } & ActionAnimationFields);
