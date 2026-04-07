import { expect, test } from "bun:test";
import {
  buildDocument,
  createBlockquoteBlock,
  createParagraphTextBlock,
  extractPlainTextFromInlineNodes,
  findBlockById,
  visitDocument,
} from "@/document";
import { parseMarkdown } from "@/markdown";

test("visits blocks, inline links, and table cells in semantic document order", () => {
  const snapshot = parseMarkdown(`# Title

Paragraph with [alpha](https://example.com) inline.

| A | B |
| - | - |
| one | two |
`);
  const visited: string[] = [];

  visitDocument(snapshot, {
    enterBlock(block) {
      if (block.type === "heading" || block.type === "paragraph" || block.type === "table") {
        visited.push(`block:${block.type}:${block.plainText}`);
      }
    },
    enterInline(node) {
      if (node.type === "link") {
        visited.push(`inline:link:${extractPlainTextFromInlineNodes(node.children)}`);
      }
    },
    enterTableCell(cell) {
      visited.push(`cell:${cell.plainText}`);
    },
  });

  expect(visited).toEqual([
    "block:heading:Title",
    "block:paragraph:Paragraph with alpha inline.",
    "inline:link:alpha",
    "block:table:A | B\none | two",
    "cell:A",
    "cell:B",
    "cell:one",
    "cell:two",
  ]);
});

test("supports skipping table-cell descendants during traversal", () => {
  const snapshot = parseMarkdown(`| A |
| - |
| one |
`);
  const visited: string[] = [];

  visitDocument(snapshot, {
    enterTableCell(cell) {
      visited.push(`cell:${cell.plainText}`);
      return "skip";
    },
    enterInline(node) {
      if (node.type === "text") {
        visited.push(`text:${node.text}`);
      }
    },
  });

  expect(visited).toEqual([
    "cell:A",
    "cell:one",
  ]);
});

test("supports stopping traversal once a semantic target has been found", () => {
  const snapshot = parseMarkdown(`| A | B |
| - | - |
| one | two |
`);
  const visited: string[] = [];

  visitDocument(snapshot, {
    enterTableCell(cell) {
      visited.push(cell.plainText);

      if (cell.plainText === "one") {
        return "stop";
      }
    },
  });

  expect(visited).toEqual([
    "A",
    "B",
    "one",
  ]);
});

test("finds nested blocks through document queries", () => {
  const nestedParagraph = createParagraphTextBlock({
    text: "Inside",
  });
  const snapshot = buildDocument({
    blocks: [
      createBlockquoteBlock({
        children: [nestedParagraph],
        path: "root.0",
      }),
    ],
  });
  const nestedParagraphId =
    snapshot.blocks[0]?.type === "blockquote"
      ? snapshot.blocks[0].children[0]?.id
      : null;

  if (!nestedParagraphId) {
    throw new Error("Expected nested paragraph id");
  }

  const resolvedFromDocument = findBlockById(snapshot, nestedParagraphId);
  const resolvedFromBlocks = findBlockById(snapshot.blocks, nestedParagraphId);

  expect(resolvedFromDocument?.id).toBe(nestedParagraphId);
  expect(resolvedFromDocument?.type).toBe("paragraph");
  expect(resolvedFromDocument?.plainText).toBe("Inside");
  expect(resolvedFromBlocks?.id).toBe(nestedParagraphId);
  expect(resolvedFromBlocks?.type).toBe("paragraph");
  expect(resolvedFromBlocks?.plainText).toBe("Inside");
  expect(findBlockById(snapshot, "missing-block")).toBeNull();
});
