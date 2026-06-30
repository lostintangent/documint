import {
  createDocumentNodeAnchor,
  documentNodeAnchorKey,
  resolveDocumentNodeAnchor,
  resolveDocumentNodeAnchors,
  type Block,
  type DocumentNodeAnchor,
  type DocumentNodeAnchorResolution,
  type TableCell,
} from "@/document";
import {
  resolveBlockByPath,
  resolveEditorTextAtPath,
  resolveIndexedTableCell,
  resolveBlockTextPathBoundary,
  type DocumentIndex,
} from "../state";

type MatchedDocumentNodeAnchor = Extract<DocumentNodeAnchorResolution, { status: "matched" }>;

export type EditorNodeAnchor =
  | {
      anchor: DocumentNodeAnchor;
      basis: MatchedDocumentNodeAnchor["basis"];
      editorPath: string | null;
      node: Block | TableCell;
      path: string;
      status: "matched";
    }
  | {
      reason: "duplicate" | "weak-evidence";
      status: "ambiguous";
    }
  | {
      status: "unmatched";
    };

export function createNodeAnchorForPath(
  documentIndex: DocumentIndex,
  path: string,
): DocumentNodeAnchor | null {
  const node = resolveDocumentNodeForPath(documentIndex, path);

  return node ? createDocumentNodeAnchor(documentIndex.document, path) : null;
}

export function resolveNodeAnchor(
  documentIndex: DocumentIndex,
  anchor: DocumentNodeAnchor,
): EditorNodeAnchor {
  return editorNodeAnchorFromMatch(
    documentIndex,
    resolveDocumentNodeAnchor(documentIndex.document, anchor),
  );
}

export function resolveNodeAnchors(
  documentIndex: DocumentIndex,
  anchors: readonly DocumentNodeAnchor[],
): ReadonlyMap<string, EditorNodeAnchor> {
  const matches = resolveDocumentNodeAnchors(documentIndex.document, anchors);
  const resolved = new Map<string, EditorNodeAnchor>();

  for (const anchor of anchors) {
    const key = documentNodeAnchorKey(anchor);
    const match = matches.get(key);
    resolved.set(
      key,
      match ? editorNodeAnchorFromMatch(documentIndex, match) : { status: "unmatched" },
    );
  }

  return resolved;
}

function editorNodeAnchorFromMatch(
  documentIndex: DocumentIndex,
  match: DocumentNodeAnchorResolution,
): EditorNodeAnchor {
  if (match.status === "ambiguous") {
    return {
      reason: match.reason,
      status: "ambiguous",
    };
  }

  if (match.status !== "matched") {
    return { status: "unmatched" };
  }

  return {
    anchor: match.anchor,
    basis: match.basis,
    editorPath: resolveDocumentNodeEditorPath(documentIndex, match.node, match.path),
    node: match.node,
    path: match.path,
    status: "matched",
  };
}

export function resolveNodeAnchorForPath(
  previousIndex: DocumentIndex,
  previousPath: string,
  nextIndex: DocumentIndex,
): EditorNodeAnchor {
  const anchor = createNodeAnchorForPath(previousIndex, previousPath);

  return anchor ? resolveNodeAnchor(nextIndex, anchor) : { status: "unmatched" };
}

function resolveDocumentNodeForPath(
  documentIndex: DocumentIndex,
  path: string,
): Block | TableCell | null {
  const tableCell = resolveIndexedTableCell(documentIndex, path);

  if (tableCell) {
    return tableCell.cell;
  }

  return resolveBlockByPath(documentIndex, path);
}

function resolveDocumentNodeEditorPath(
  documentIndex: DocumentIndex,
  node: Block | TableCell,
  path: string,
): string | null {
  if ("type" in node) {
    return resolveBlockTextPathBoundary(documentIndex, path, "start");
  }

  return resolveEditorTextAtPath(documentIndex, path) !== null ? path : null;
}
