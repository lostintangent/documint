import {
  createDocumentNodeAnchor,
  documentNodeAnchorKey,
  resolveDocumentNodeAnchors,
  type Block,
  type DocumentNodeAnchor,
  type DocumentNodeAnchorResolution,
  type TableCell,
} from "@/document";
import { resolveBlockTextPathBoundary, type DocumentIndex } from "../state";

// `path` is the matched document node path. `editorPath` is the editor text
// path a selection or effect should target, which differs for container blocks.
export type EditorNodeAnchor =
  | {
      anchor: DocumentNodeAnchor;
      editorPath: string | null;
      path: string;
      status: "matched";
    }
  | {
      status: "ambiguous" | "unmatched";
    };

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
  if (match.status !== "matched") {
    return { status: match.status === "ambiguous" ? "ambiguous" : "unmatched" };
  }

  return {
    anchor: match.anchor,
    editorPath: resolveDocumentNodeEditorPath(documentIndex, match.node, match.path),
    path: match.path,
    status: "matched",
  };
}

export function resolveNodeAnchorForPath(
  previousIndex: DocumentIndex,
  previousPath: string,
  nextIndex: DocumentIndex,
): EditorNodeAnchor {
  const anchor = createDocumentNodeAnchor(previousIndex.document, previousPath);

  return anchor
    ? resolveNodeAnchors(nextIndex, [anchor]).get(documentNodeAnchorKey(anchor))!
    : { status: "unmatched" };
}

function resolveDocumentNodeEditorPath(
  documentIndex: DocumentIndex,
  node: Block | TableCell,
  path: string,
): string | null {
  return "type" in node ? resolveBlockTextPathBoundary(documentIndex, path, "start") : path;
}
