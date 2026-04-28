import { expect, test } from "bun:test";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("preserves markdown directives as unsupported semantic content", () => {
  const source = `::badge{disabled}

:::callout{tone}
Body
:::

Paragraph with :badge[alpha]{disabled} inline.
`;
  const snapshot = parseMarkdown(source);
  const leafDirective = snapshot.blocks[0];
  const containerDirective = snapshot.blocks[1];
  const paragraph = snapshot.blocks[2];

  if (!leafDirective || leafDirective.type !== "unsupported") {
    throw new Error("Expected top-level unsupported leaf directive");
  }

  if (!containerDirective || containerDirective.type !== "directive") {
    throw new Error("Expected top-level container directive block");
  }

  if (!paragraph || paragraph.type !== "paragraph") {
    throw new Error("Expected trailing paragraph");
  }

  const textDirective = paragraph.children.find((node) => node.type === "unsupported");

  if (!textDirective || textDirective.type !== "unsupported") {
    throw new Error("Expected inline unsupported directive");
  }

  expect(leafDirective.originalType).toBe("leafDirective");
  expect(leafDirective.source).toBe("::badge{disabled}");
  expect(containerDirective.name).toBe("callout");
  expect(containerDirective.attributes).toBe("tone");
  expect(containerDirective.body).toBe("Body");
  expect(paragraph.plainText).toBe("Paragraph with :badge[alpha]{disabled} inline.");
  expect(textDirective.originalType).toBe("textDirective");
  expect(textDirective.source).toBe(":badge[alpha]{disabled}");
  expect(serializeMarkdown(snapshot)).toBe(source);
});

test("normalizes blank task items into empty semantic paragraphs", () => {
  const snapshot = parseMarkdown("- [ ] \n");
  const list = snapshot.blocks[0];

  if (!list || list.type !== "list") {
    throw new Error("Expected task list block");
  }

  const item = list.items[0];

  if (!item) {
    throw new Error("Expected task list item");
  }

  const paragraph = item.children[0];

  if (!paragraph || paragraph.type !== "paragraph") {
    throw new Error("Expected normalized empty paragraph");
  }

  expect(list.plainText).toBe("");
  expect(item.checked).toBe(false);
  expect(item.plainText).toBe("");
  expect(paragraph.plainText).toBe("");
  expect(paragraph.children).toEqual([]);
  expect(serializeMarkdown(snapshot)).toBe("- [ ] \n");
});

test("repeated parse produces stable ids for representative semantic node kinds", () => {
  const source = `# Heading

::badge{status="experimental"}

Paragraph with :badge[alpha]{status="experimental"} inline.

- first

| A | B |
| - | - |
| one | two |

:::callout{tone="info"}
Body
:::
`;
  const first = summarizeRepresentativeNodes(parseMarkdown(source));
  const second = summarizeRepresentativeNodes(parseMarkdown(source));

  expect(first).toEqual(second);
  expect(first.headingText).toBe("Heading");
  expect(first.paragraphText).toBe('Paragraph with :badge[alpha]{status="experimental"} inline.');
  expect(first.listText).toBe("first");
  expect(first.listItemText).toBe("first");
  expect(first.tableText).toBe("A | B\none | two");
  expect(first.leafDirectiveRaw).toBe('::badge{status="experimental"}');
  expect(first.inlineDirectiveRaw).toBe(':badge[alpha]{status="experimental"}');
  expect(first.containerDirectiveName).toBe("callout");
  expect(first.containerDirectiveAttributes).toBe('tone="info"');
  expect(first.containerDirectiveBody).toBe("Body");
});

function summarizeRepresentativeNodes(snapshot: ReturnType<typeof parseMarkdown>) {
  const heading = snapshot.blocks[0];
  const leafDirective = snapshot.blocks[1];
  const paragraph = snapshot.blocks[2];
  const list = snapshot.blocks[3];
  const table = snapshot.blocks[4];
  const containerDirective = snapshot.blocks[5];

  if (!heading || heading.type !== "heading") {
    throw new Error("Expected heading block");
  }

  if (!leafDirective || leafDirective.type !== "unsupported") {
    throw new Error("Expected unsupported leaf directive block");
  }

  if (!paragraph || paragraph.type !== "paragraph") {
    throw new Error("Expected paragraph block");
  }

  const inlineDirective = paragraph.children.find((node) => node.type === "unsupported");

  if (!inlineDirective || inlineDirective.type !== "unsupported") {
    throw new Error("Expected unsupported inline directive node");
  }

  if (!list || list.type !== "list") {
    throw new Error("Expected list block");
  }

  const listItem = list.items[0];

  if (!listItem) {
    throw new Error("Expected list item");
  }

  if (!table || table.type !== "table") {
    throw new Error("Expected table block");
  }

  const firstRow = table.rows[0];
  const firstCell = firstRow?.cells[0];

  if (!firstRow || !firstCell) {
    throw new Error("Expected first table row and cell");
  }

  if (!containerDirective || containerDirective.type !== "directive") {
    throw new Error("Expected container directive block");
  }

  return {
    containerDirectiveAttributes: containerDirective.attributes,
    containerDirectiveBody: containerDirective.body,
    containerDirectiveId: containerDirective.id,
    containerDirectiveName: containerDirective.name,
    firstTableCellId: firstCell.id,
    firstTableRowId: firstRow.id,
    headingId: heading.id,
    headingText: heading.plainText,
    inlineDirectiveId: inlineDirective.id,
    inlineDirectiveRaw: inlineDirective.source,
    leafDirectiveId: leafDirective.id,
    leafDirectiveRaw: leafDirective.source,
    listId: list.id,
    listItemId: listItem.id,
    listItemText: listItem.plainText,
    listText: list.plainText,
    paragraphId: paragraph.id,
    paragraphText: paragraph.plainText,
    tableId: table.id,
    tableText: table.plainText,
  };
}

test("captures leading yaml front matter on the document", () => {
  const source = `---
title: Hello
draft: false
---

# Body
`;
  const snapshot = parseMarkdown(source);

  expect(snapshot.frontMatter).toBe("---\ntitle: Hello\ndraft: false\n---");
  expect(snapshot.blocks[0]?.type).toBe("heading");
  expect(serializeMarkdown(snapshot)).toBe(source);
});

test("treats an unterminated leading fence as a thematic break", () => {
  const snapshot = parseMarkdown("---\n\nBody\n");

  expect(snapshot.blocks[0]?.type).toBe("thematicBreak");
  expect(snapshot.blocks[1]?.type).toBe("paragraph");
});

test("does not treat mid-document fences as front matter", () => {
  const snapshot = parseMarkdown("# Title\n\n---\nkey: value\n---\n");

  expect(snapshot.blocks[0]?.type).toBe("heading");
  expect(snapshot.blocks.some((block) => block.type === "unsupported")).toBe(false);
});

test("round-trips a document containing only front matter", () => {
  const source = "---\ntitle: Stub\n---\n";
  const snapshot = parseMarkdown(source);

  expect(snapshot.frontMatter).toBe("---\ntitle: Stub\n---");
  expect(snapshot.blocks).toHaveLength(0);
  expect(serializeMarkdown(snapshot)).toBe(source);
});
