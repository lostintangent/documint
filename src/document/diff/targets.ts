import type { Block, Document, TableCell } from "../model";
import {
  createDocumentNodeAnchor,
  documentNodeAnchorKey,
  resolveDocumentNodeAnchors,
  type DocumentNodeAnchorResolution,
} from "../query/anchors/node";
import { resolveBlockByPath, resolveTableCellByPath } from "../query/paths";
import type { DocumentChange, DocumentChangeTarget } from "./types";

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
      node: {
        blockId: target.block.id,
        path: target.path,
      },
      kind: "block",
    };
  }

  const cell = resolveTableCellByPath(document, target.path);
  if (!cell || cell !== target.cell || anchor.kind !== "table-cell") {
    throw new Error(`Expected table-cell target for ${target.path}`);
  }

  return {
    anchor,
    node: {
      cellId: target.cell.id,
      path: target.path,
    },
    kind: "table-cell",
  };
}

export function retargetDocumentChanges(
  document: Document,
  changes: readonly DocumentChange[],
): readonly (DocumentChange | null)[] {
  const matches = resolveDocumentNodeAnchors(
    document,
    changes.map((change) => change.target.anchor),
  );

  return changes.map((change) => {
    const target = retargetDocumentChangeTarget(
      change.target,
      matches,
    );
    if (!target) {
      return null;
    }

    if (change.changeKind === "added") {
      return { changeKind: "added", target };
    }

    // `previousTarget` is historical adjacent-snapshot evidence. Retargeting
    // creates a lifecycle projection for rendering; it must not rewrite history.
    return {
      changeKind: "modified",
      previousTarget: change.previousTarget,
      target,
    };
  });
}

export function documentChangeLocationKey(target: DocumentChangeTarget) {
  return `${target.kind}:${target.node.path}`;
}

export function hasSameDocumentChangeTargetEvidence(
  activeTarget: DocumentChangeTarget,
  previousTarget: DocumentChangeTarget,
) {
  return (
    documentChangeTargetEvidenceKey(activeTarget) ===
    documentChangeTargetEvidenceKey(previousTarget)
  );
}

export function documentChangeTargetEvidenceKey(target: DocumentChangeTarget) {
  return documentNodeAnchorKey(target.anchor);
}

function retargetDocumentChangeTarget(
  target: DocumentChangeTarget,
  matches: ReadonlyMap<string, DocumentNodeAnchorResolution>,
): DocumentChangeTarget | null {
  const match = matches.get(documentNodeAnchorKey(target.anchor));
  if (match?.status !== "matched") {
    return null;
  }

  return createResolvedDocumentChangeTarget(match);
}

function createResolvedDocumentChangeTarget(
  match: Extract<DocumentNodeAnchorResolution, { status: "matched" }>,
): DocumentChangeTarget {
  if (match.anchor.kind === "block") {
    if (!("type" in match.node)) {
      throw new Error(`Expected block node for ${match.path}`);
    }

    return {
      anchor: match.anchor,
      node: {
        blockId: match.node.id,
        path: match.path,
      },
      kind: "block",
    };
  }

  if ("type" in match.node) {
    throw new Error(`Expected table-cell node for ${match.path}`);
  }

  return {
    anchor: match.anchor,
    node: {
      cellId: match.node.id,
      path: match.path,
    },
    kind: "table-cell",
  };
}
