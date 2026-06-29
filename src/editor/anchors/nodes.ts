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
  resolvePrimaryRegionForBlockPath,
  resolveRegion,
  type DocumentIndex,
  type EditableRegion,
} from "../state";

type MatchedDocumentNodeAnchor = Extract<DocumentNodeAnchorResolution, { status: "matched" }>;

export type EditorNodeAnchor =
  | {
      anchor: DocumentNodeAnchor;
      basis: MatchedDocumentNodeAnchor["basis"];
      node: Block | TableCell;
      path: string;
      region: EditableRegion | null;
      status: "matched";
    }
  | {
      reason: "duplicate" | "weak-evidence";
      status: "ambiguous";
    }
  | {
      status: "unmatched";
    };

export function createNodeAnchorForRegion(
  documentIndex: DocumentIndex,
  region: EditableRegion,
): DocumentNodeAnchor | null {
  const node = resolveRegionDocumentNode(region);

  return node ? createDocumentNodeAnchor(documentIndex.document, region.containerPath) : null;
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
    node: match.node,
    path: match.path,
    region: resolveDocumentNodeRegion(documentIndex, match.node, match.path),
    status: "matched",
  };
}

export function resolveNodeAnchorForRegion(
  previousIndex: DocumentIndex,
  previousRegion: EditableRegion,
  nextIndex: DocumentIndex,
): EditorNodeAnchor {
  const anchor = createNodeAnchorForRegion(previousIndex, previousRegion);

  return anchor ? resolveNodeAnchor(nextIndex, anchor) : { status: "unmatched" };
}

function resolveRegionDocumentNode(region: EditableRegion): Block | TableCell | null {
  if (!region.tableCellPosition) {
    return region.block;
  }

  if (region.block.type !== "table") {
    return null;
  }

  const { cellIndex, rowIndex } = region.tableCellPosition;
  return region.block.rows[rowIndex]?.cells[cellIndex] ?? null;
}

function resolveDocumentNodeRegion(
  documentIndex: DocumentIndex,
  node: Block | TableCell,
  path: string,
): EditableRegion | null {
  return "type" in node
    ? resolvePrimaryRegionForBlockPath(documentIndex, path)
    : resolveRegion(documentIndex, path);
}
