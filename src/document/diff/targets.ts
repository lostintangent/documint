import type { Block, Document, TableCell } from "../model";
import { createDocumentNodeAnchor, documentNodeAnchorKey } from "../query/anchors/node";
import { resolveBlockByPath, resolveTableCellByPath } from "../query/paths";
import type { DocumentChangeTarget } from "./types";

type LocatedDocumentChangeTarget =
  | {
      readonly block: Block;
      readonly kind: "block";
      readonly path: string;
    }
  | {
      readonly cell: TableCell;
      readonly kind: "table-cell";
      readonly path: string;
    };

export function createDocumentChangeTarget(
  document: Document,
  target: LocatedDocumentChangeTarget,
): DocumentChangeTarget {
  const anchor = createDocumentNodeAnchor(document, target.path);
  if (!anchor) {
    throw new Error(
      `Unable to create document change target for ${target.path}`,
    );
  }

  if (target.kind === "block") {
    const block = resolveBlockByPath(document, target.path);
    if (!block || block !== target.block || anchor.kind !== "block") {
      throw new Error(`Expected block target for ${target.path}`);
    }

    return {
      anchor,
      kind: "block",
      path: target.path,
    };
  }

  const cell = resolveTableCellByPath(document, target.path);
  if (!cell || cell !== target.cell || anchor.kind !== "table-cell") {
    throw new Error(`Expected table-cell target for ${target.path}`);
  }

  return {
    anchor,
    kind: "table-cell",
    path: target.path,
  };
}

export function documentChangeLocationKey(target: DocumentChangeTarget) {
  return `${target.kind}:${target.path}`;
}

export function hasSameDocumentChangeTargetAnchor(
  activeTarget: DocumentChangeTarget,
  previousTarget: DocumentChangeTarget,
) {
  return (
    documentChangeTargetAnchorKey(activeTarget) ===
    documentChangeTargetAnchorKey(previousTarget)
  );
}

export function documentChangeTargetAnchorKey(target: DocumentChangeTarget) {
  return documentNodeAnchorKey(target.anchor);
}
