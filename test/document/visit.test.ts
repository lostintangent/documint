import { describe, expect, test } from "bun:test";
import {
  createDocument,
  createBlockquoteBlock,
  createParagraphTextBlock,
  createLink,
  createMention,
  createText,
  createListBlock,
  createListItemBlock,
  extractPlainTextFromInlineNodes,
  findBlockChildIndicesByReference,
  mapInlines,
  visitBlockTree,
  visitDocument,
} from "@/document";
import { parseDocument } from "@/markdown";

describe("Document traversal", () => {
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

  test("visits inline containers with their owner paths", () => {
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
      "block:root.0:Title",
      "block:root.1:Paragraph.",
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

    expect(visited).toEqual(["root.1"]);
  });

  test("maps inline lists with nested link children and stable paths", () => {
    const inlines = [
      createText("See "),
      createLink({
        children: [createText("alpha"), createMention({ name: "Jane", userId: "u-jane" })],
        url: "https://example.com",
      }),
      createText("."),
    ];

    const mapped = mapInlines(inlines, (node, context, children) => {
      if (node.type === "link") {
        return `${context.path}:link(${children?.join("|")})`;
      }
      if (node.type === "mention") {
        return `${context.path}:mention:${node.userId}`;
      }
      if (node.type === "text") {
        return `${context.path}:text:${node.text}`;
      }
      return null;
    });

    expect(mapped).toEqual([
      "root.0:text:See ",
      "root.1:link(root.1.children.0:text:alpha|root.1.children.1:mention:u-jane)",
      "root.2:text:.",
    ]);
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

  test("locates nested blocks by reference in committed trees", () => {
    const nestedParagraph = createParagraphTextBlock("Inside");
    const snapshot = createDocument([createBlockquoteBlock([nestedParagraph])]);
    const root = snapshot.blocks[0];
    const committedParagraph = root?.type === "blockquote" ? root.children[0] : null;

    if (!committedParagraph) {
      throw new Error("Expected nested paragraph");
    }

    expect(findBlockChildIndicesByReference(snapshot.blocks, committedParagraph)).toEqual({
      childIndices: [0],
      rootOffset: 0,
    });
    expect(
      findBlockChildIndicesByReference(snapshot.blocks, createParagraphTextBlock("Inside")),
    ).toBeNull();
  });

  test("locates blocks by reference identity in un-normalized trees", () => {
    const paragraph = createParagraphTextBlock("inside item");
    const item = createListItemBlock({ checked: null, children: [paragraph], compact: true });
    const list = createListBlock({ compact: true, items: [item], ordered: false, start: null });
    const intro = createParagraphTextBlock("intro");

    expect(findBlockChildIndicesByReference([intro, list], list)).toEqual({
      childIndices: [],
      rootOffset: 1,
    });
    expect(findBlockChildIndicesByReference([intro, list], item)).toEqual({
      childIndices: [0],
      rootOffset: 1,
    });
    expect(findBlockChildIndicesByReference([intro, list], paragraph)).toEqual({
      childIndices: [0, 0],
      rootOffset: 1,
    });
    expect(findBlockChildIndicesByReference([intro, list], intro)).toEqual({
      childIndices: [],
      rootOffset: 0,
    });
  });

  test("matches by object identity, not content equality", () => {
    const original = createParagraphTextBlock("twin");
    const twin = createParagraphTextBlock("twin");

    expect(findBlockChildIndicesByReference([original], twin)).toBeNull();
    expect(findBlockChildIndicesByReference([original], original)).toEqual({
      childIndices: [],
      rootOffset: 0,
    });
  });
});
