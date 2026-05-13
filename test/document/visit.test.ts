import { expect, test } from "bun:test";
import {
  createDocument,
  createBlockquoteBlock,
  createCode,
  createParagraphTextBlock,
  createLink,
  createParagraphBlock,
  createText,
  extractPlainTextFromInlineNodes,
  findBlockById,
  visitBlockTree,
  visitDocument,
} from "@/document";
import { parseDocument } from "@/markdown";

test("visits blocks, inline links, and table cells in semantic document order", () => {
  const snapshot = parseDocument(`# Title

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
  const snapshot = parseDocument(`| A |
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

  expect(visited).toEqual(["cell:A", "cell:one"]);
});

test("visits editable inline containers with their region paths", () => {
  const snapshot = parseDocument(`# Title

Paragraph.

| A | B |
| - | - |
| one | two |
`);
  const visited: string[] = [];

  visitDocument(snapshot, {
    enterInlineContainer(nodes, context) {
      visited.push(
        `${context.kind}:${context.path}:${extractPlainTextFromInlineNodes([...nodes])}`,
      );
      return "skip";
    },
  });

  expect(visited).toEqual([
    "block:root.0.children:Title",
    "block:root.1.children:Paragraph.",
    "tableCell:root.2.rows.0.cells.0:A",
    "tableCell:root.2.rows.0.cells.1:B",
    "tableCell:root.2.rows.1.cells.0:one",
    "tableCell:root.2.rows.1.cells.1:two",
  ]);
});

test("supports visiting root block slices at their document root index", () => {
  const snapshot = parseDocument(`First

Second
`);
  const visited: string[] = [];

  visitBlockTree(
    [snapshot.blocks[1]!],
    {
      enterInlineContainer(_nodes, context) {
        visited.push(context.path);
      },
    },
    { startIndex: 1 },
  );

  expect(visited).toEqual(["root.1.children"]);
});

test("visits plain text with region paths and text-coordinate offsets", () => {
  const snapshot = createDocument([
    createParagraphBlock([
      createText("plain "),
      createText("bold", ["bold"]),
      createCode("code"),
      createLink({ children: [createText("link")], url: "https://example.com" }),
      createText(" tail"),
    ]),
  ]);
  const visited: string[] = [];

  visitDocument(snapshot, {
    enterPlainText(text, context) {
      visited.push(`${context.path}:${context.startOffset}-${context.endOffset}:${text}`);
    },
  });

  expect(visited).toEqual(["root.0.children:0-6:plain ", "root.0.children:18-23: tail"]);
});

test("supports stopping traversal once a semantic target has been found", () => {
  const snapshot = parseDocument(`| A | B |
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

  expect(visited).toEqual(["A", "B", "one"]);
});

test("finds nested blocks through document queries", () => {
  const nestedParagraph = createParagraphTextBlock("Inside");
  const snapshot = createDocument([createBlockquoteBlock([nestedParagraph])]);
  const nestedParagraphId =
    snapshot.blocks[0]?.type === "blockquote" ? snapshot.blocks[0].children[0]?.id : null;

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
