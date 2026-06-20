import type {
  DocumentBlockAnchor,
  DocumentTableCellAnchor,
} from "../query/anchors/node";

export type DocumentChangeKind = "added" | "modified";

export type DocumentChangeTarget =
  | {
      readonly anchor: DocumentBlockAnchor;
      readonly node: {
        readonly blockId: string;
        readonly path: string;
      };
      readonly kind: "block";
    }
  | {
      readonly anchor: DocumentTableCellAnchor;
      readonly node: {
        readonly cellId: string;
        readonly path: string;
      };
      readonly kind: "table-cell";
    };

export type DocumentChange =
  | {
      readonly changeKind: "added";
      readonly target: DocumentChangeTarget;
    }
  | {
      readonly changeKind: "modified";
      readonly previousTarget: DocumentChangeTarget;
      readonly target: DocumentChangeTarget;
    };
