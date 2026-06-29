import { describe, expect, test } from "bun:test";
import { createDocumentNodeAnchor } from "@/document";
import { createDocumentIndex, resolveRegion } from "@/editor/state";
import {
  createNodeAnchorForRegion,
  resolveNodeAnchor,
  resolveNodeAnchorForRegion,
} from "@/editor/anchors";
import { parseDocument } from "@/markdown";

describe("editor node anchors", () => {
  test("resolves a matched block anchor to its block path and primary runtime region", () => {
    const previousIndex = createIndex("Alpha\n\nTarget\n");
    const nextIndex = createIndex("Intro\n\nAlpha\n\nTarget\n");
    const anchor = requireDocumentNodeAnchor(previousIndex, "root.1");
    const resolved = resolveNodeAnchor(nextIndex, anchor);

    expect(resolved).toMatchObject({
      basis: "exact-content-context",
      path: "root.2",
      status: "matched",
    });
    expect(resolved.status === "matched" ? resolved.region?.text : null).toBe("Target");
    expect(resolved.status === "matched" ? resolved.region?.path : null).toBe("root.2.children");
  });

  test("resolves a matched table-cell anchor to the runtime cell region", () => {
    const previousIndex = createIndex("| A | B |\n| - | - |\n| one | two |\n");
    const nextIndex = createIndex("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");
    const anchor = requireDocumentNodeAnchor(previousIndex, "root.0.rows.1.cells.1");
    const resolved = resolveNodeAnchor(nextIndex, anchor);

    expect(resolved).toMatchObject({
      basis: "exact-content-context",
      path: "root.0.rows.2.cells.1",
      status: "matched",
    });
    expect(resolved.status === "matched" ? resolved.region?.text : null).toBe("two");
    expect(resolved.status === "matched" ? resolved.region?.path : null).toBe(
      "root.0.rows.2.cells.1",
    );
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

  test("preserves matched block path separately from descendant region resolution", () => {
    const previousIndex = createIndex("> Target\n");
    const nextIndex = createIndex("Intro\n\n> Target\n");
    const anchor = requireDocumentNodeAnchor(previousIndex, "root.0");
    const resolved = resolveNodeAnchor(nextIndex, anchor);

    expect(resolved).toMatchObject({
      path: "root.1",
      status: "matched",
    });
    expect(resolved.status === "matched" ? resolved.region?.path : null).toBe(
      "root.1.children.0.children",
    );
  });

  test("creates and resolves a node anchor from an editable region", () => {
    const previousIndex = createIndex("Alpha\n\nTarget\n");
    const nextIndex = createIndex("Intro\n\nAlpha\n\nTarget\n");
    const previousRegion = resolveRegion(previousIndex, "root.1.children");

    if (!previousRegion) {
      throw new Error("Expected previous region");
    }

    const anchor = createNodeAnchorForRegion(previousIndex, previousRegion);
    const resolved = resolveNodeAnchorForRegion(previousIndex, previousRegion, nextIndex);

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
