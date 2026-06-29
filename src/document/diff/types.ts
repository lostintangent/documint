import type {
  DocumentBlockAnchor,
  DocumentTableCellAnchor,
} from "../query/anchors/node";

export type DocumentChangeKind = "added" | "modified";

export type DocumentChangeTarget =
  | {
      readonly anchor: DocumentBlockAnchor;
      readonly kind: "block";
      readonly path: string;
    }
  | {
      readonly anchor: DocumentTableCellAnchor;
      readonly kind: "table-cell";
      readonly path: string;
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
