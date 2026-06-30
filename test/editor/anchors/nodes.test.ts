import { describe, expect, test } from "bun:test";
import { createDocumentNodeAnchor } from "@/document";
import { createDocumentIndex, resolveEditorTextAtPath } from "@/editor/state";
import {
  createNodeAnchorForPath,
  resolveNodeAnchor,
  resolveNodeAnchorForPath,
} from "@/editor/anchors";
import { parseDocument } from "@/markdown";

describe("editor node anchors", () => {
  test("resolves a matched block anchor to its block path and editor path", () => {
    const previousIndex = createIndex("Alpha\n\nTarget\n");
    const nextIndex = createIndex("Intro\n\nAlpha\n\nTarget\n");
    const anchor = requireDocumentNodeAnchor(previousIndex, "root.1");
    const resolved = resolveNodeAnchor(nextIndex, anchor);

    expect(resolved).toMatchObject({
      basis: "exact-content-context",
      path: "root.2",
      status: "matched",
    });
    const editorPath = resolved.status === "matched" ? resolved.editorPath : null;

    expect(editorPath).toBe("root.2");
    expect(editorPath ? resolveEditorTextAtPath(nextIndex, editorPath) : null).toBe("Target");
  });

  test("resolves a matched table-cell anchor to the cell editor path", () => {
    const previousIndex = createIndex("| A | B |\n| - | - |\n| one | two |\n");
    const nextIndex = createIndex("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");
    const anchor = requireDocumentNodeAnchor(previousIndex, "root.0.rows.1.cells.1");
    const resolved = resolveNodeAnchor(nextIndex, anchor);

    expect(resolved).toMatchObject({
      basis: "exact-content-context",
      path: "root.0.rows.2.cells.1",
      status: "matched",
    });
    const editorPath = resolved.status === "matched" ? resolved.editorPath : null;

    expect(editorPath).toBe("root.0.rows.2.cells.1");
    expect(editorPath ? resolveEditorTextAtPath(nextIndex, editorPath) : null).toBe("two");
  });

  test("keeps ambiguous document node anchors ambiguous", () => {
    const previousIndex = createIndex("Target\n");
    const nextIndex = createIndex("Target\n\nTarget\n");
    const anchor = requireDocumentNodeAnchor(previousIndex, "root.0");
    const resolved = resolveNodeAnchor(nextIndex, anchor);

    expect(resolved).toEqual({
      reason: "weak-evidence",
      status: "ambiguous",
    });
  });

  test("resolves a matched container block to its first descendant text block", () => {
    const previousIndex = createIndex("> Target\n");
    const nextIndex = createIndex("Intro\n\n> Target\n");
    const anchor = requireDocumentNodeAnchor(previousIndex, "root.0");
    const resolved = resolveNodeAnchor(nextIndex, anchor);

    expect(resolved).toMatchObject({
      path: "root.1",
      status: "matched",
    });
    expect(resolved.status === "matched" ? resolved.editorPath : null).toBe("root.1.children.0");
  });

  test("creates and resolves a node anchor from an editor path", () => {
    const previousIndex = createIndex("Alpha\n\nTarget\n");
    const nextIndex = createIndex("Intro\n\nAlpha\n\nTarget\n");
    const anchor = createNodeAnchorForPath(previousIndex, "root.1");
    const resolved = resolveNodeAnchorForPath(previousIndex, "root.1", nextIndex);

    expect(anchor).not.toBeNull();
    expect(resolved).toMatchObject({
      path: "root.2",
      status: "matched",
    });
  });
});

function createIndex(markdown: string) {
  return createDocumentIndex(parseDocument(markdown));
}

function requireDocumentNodeAnchor(
  documentIndex: ReturnType<typeof createIndex>,
  path: string,
) {
  const anchor = createDocumentNodeAnchor(documentIndex.document, path);

  if (!anchor) {
    throw new Error(`Expected document node anchor at ${path}`);
  }

  return anchor;
}
