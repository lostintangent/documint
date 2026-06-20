import { describe, expect, test } from "bun:test";
import {
  createDocumentNodeAnchor,
  resolveDocumentNodeAnchor,
  resolveDocumentNodeAnchors,
} from "@/document";
import { parseDocument } from "@/markdown";

describe("document node anchors", () => {
  describe("exact content matching", () => {
    test("matches a block by content after its path shifts", () => {
      const previous = parseDocument("Alpha\n\nTarget\n");
      const next = parseDocument("Intro\n\nAlpha\n\nTarget\n");
      const anchor = createAnchor(previous, "root.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toMatchObject({
        basis: "exact-content-context",
        node: { plainText: "Target", type: "paragraph" },
        path: "root.2",
        status: "matched",
      });
    });

    test("reports absent block content without recovering by path", () => {
      const previous = parseDocument("Target\n");
      const next = parseDocument("Other\n");
      const anchor = createAnchor(previous, "root.0");

      expect(resolveDocumentNodeAnchor(next, anchor)).toEqual({
        status: "absent",
      });
    });

    test("reports budget exhaustion without returning a partial match", () => {
      const previous = parseDocument("Target\n");
      const next = parseDocument("Target\n");
      const anchor = createAnchor(previous, "root.0");

      expect(resolveDocumentNodeAnchor(next, anchor, { maxVisitedNodes: 0 })).toEqual({
        status: "exhausted",
      });
    });
  });

  describe("structural disambiguation", () => {
    test("resolves duplicate block content when sibling context identifies one candidate", () => {
      const previous = parseDocument("Before\n\nTarget\n\nAfter\n");
      const next = parseDocument("Target\n\nBefore\n\nTarget\n\nAfter\n");
      const anchor = createAnchor(previous, "root.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toMatchObject({
        basis: "exact-content-context",
        path: "root.2",
        status: "matched",
      });
    });

    test("resolves duplicate nested block content from parent sibling context", () => {
      const previous = parseDocument("> Before\n>\n> Target\n>\n> After\n");
      const next = parseDocument("> Target\n>\n> Before\n>\n> Target\n>\n> After\n");
      const anchor = createAnchor(previous, "root.0.children.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toMatchObject({
        basis: "exact-content-context",
        path: "root.0.children.2",
        status: "matched",
      });
    });

    test("keeps duplicate block content ambiguous when context is symmetric", () => {
      const previous = parseDocument("Target\n");
      const next = parseDocument("Target\n\nTarget\n");
      const anchor = createAnchor(previous, "root.0");

      expect(resolveDocumentNodeAnchor(next, anchor)).toEqual({
        reason: "weak-evidence",
        status: "ambiguous",
      });
    });

    test("keeps duplicate nested block content ambiguous when only path and parent type match", () => {
      const previous = parseDocument("> Target\n");
      const next = parseDocument("> Target\n>\n> Target\n");
      const anchor = createAnchor(previous, "root.0.children.0");

      expect(resolveDocumentNodeAnchor(next, anchor)).toEqual({
        reason: "weak-evidence",
        status: "ambiguous",
      });
    });

    test("does not let path alone resolve duplicate block content", () => {
      const previous = parseDocument("Target\n");
      const next = parseDocument("Target\n\nTarget\n");
      const anchor = createAnchor(previous, "root.0");

      expect(resolveDocumentNodeAnchor(next, anchor)).toEqual({
        reason: "weak-evidence",
        status: "ambiguous",
      });
    });

    test("keeps collapsed duplicate block content ambiguous when original context no longer matches", () => {
      const previous = parseDocument("Same\n\nSame\n");
      const next = parseDocument("Same\n");
      const anchor = createAnchor(previous, "root.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toEqual({
        reason: "weak-evidence",
        status: "ambiguous",
      });
    });

    test("strict exact-content mode does not use context to disambiguate duplicates", () => {
      const previous = parseDocument("Before\n\nTarget\n\nAfter\n");
      const next = parseDocument("Target\n\nBefore\n\nTarget\n\nAfter\n");
      const anchor = createAnchor(previous, "root.1");

      expect(resolveDocumentNodeAnchor(next, anchor, { mode: "exact-content" })).toEqual({
        reason: "duplicate",
        status: "ambiguous",
      });
    });
  });

  describe("table cells", () => {
    test("matches a table cell by content after its row shifts", () => {
      const previous = parseDocument("| A | B |\n| - | - |\n| one | two |\n");
      const next = parseDocument("| A | B |\n| - | - |\n| new | row |\n| one | two |\n");
      const anchor = createAnchor(previous, "root.0.rows.1.cells.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toMatchObject({
        basis: "exact-content-context",
        node: { plainText: "two" },
        path: "root.0.rows.2.cells.1",
        status: "matched",
      });
    });

    test("resolves duplicate table-cell content with row and cell context", () => {
      const previous = parseDocument("| A | B | C |\n| - | - | - |\n| one | two | three |\n");
      const next = parseDocument("| A | B | C |\n| - | - | - |\n| x | two | y |\n| one | two | three |\n");
      const anchor = createAnchor(previous, "root.0.rows.1.cells.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toMatchObject({
        basis: "exact-content-context",
        path: "root.0.rows.2.cells.1",
        status: "matched",
      });
    });

    test("keeps duplicate table-cell content ambiguous when rows are identical", () => {
      const previous = parseDocument("| A | B |\n| - | - |\n| one | two |\n");
      const next = parseDocument("| A | B |\n| - | - |\n| one | two |\n| one | two |\n");
      const anchor = createAnchor(previous, "root.0.rows.1.cells.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toEqual({
        reason: "weak-evidence",
        status: "ambiguous",
      });
    });

    test("keeps collapsed duplicate table-cell content ambiguous when original context no longer matches", () => {
      const previous = parseDocument(
        "| A | B |\n| - | - |\n| left | same |\n| other | same |\n",
      );
      const next = parseDocument("| A | B |\n| - | - |\n| left | same |\n");
      const anchor = createAnchor(previous, "root.0.rows.2.cells.1");

      expect(resolveDocumentNodeAnchor(next, anchor)).toEqual({
        reason: "weak-evidence",
        status: "ambiguous",
      });
    });
  });

  describe("batch resolution", () => {
    test("resolves multiple anchors under one shared budget", () => {
      const previous = parseDocument("One\n\nTwo\n");
      const next = parseDocument("Intro\n\nOne\n\nTwo\n");
      const anchors = [createAnchor(previous, "root.0"), createAnchor(previous, "root.1")];

      const matches = resolveDocumentNodeAnchors(next, anchors, { maxVisitedNodes: 8 });

      expect([...matches.values()]).toEqual([
        expect.objectContaining({ path: "root.1", status: "matched" }),
        expect.objectContaining({ path: "root.2", status: "matched" }),
      ]);
    });
  });
});

function createAnchor(document: ReturnType<typeof parseDocument>, path: string) {
  const anchor = createDocumentNodeAnchor(document, path);
  if (!anchor) {
    throw new Error(`Expected anchor for ${path}`);
  }
  return anchor;
}
