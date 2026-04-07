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

  if (!containerDirective || containerDirective.type !== "unsupported") {
    throw new Error("Expected top-level unsupported container directive");
  }

  if (!paragraph || paragraph.type !== "paragraph") {
    throw new Error("Expected trailing paragraph");
  }

  const textDirective = paragraph.children.find((node) => node.type === "unsupported");

  if (!textDirective || textDirective.type !== "unsupported") {
    throw new Error("Expected inline unsupported directive");
  }

  expect(leafDirective.originalType).toBe("leafDirective");
  expect(leafDirective.raw).toBe("::badge{disabled}");
  expect(containerDirective.originalType).toBe("containerDirective");
  expect(containerDirective.raw).toBe(":::callout{tone}\nBody\n:::");
  expect(paragraph.plainText).toBe("Paragraph with :badge[alpha]{disabled} inline.");
  expect(textDirective.originalType).toBe("textDirective");
  expect(textDirective.raw).toBe(":badge[alpha]{disabled}");
  expect(serializeMarkdown(snapshot)).toBe(source);
});

test("normalizes blank task items into empty semantic paragraphs", () => {
  const snapshot = parseMarkdown("- [ ] \n");
  const list = snapshot.blocks[0];

  if (!list || list.type !== "list") {
    throw new Error("Expected task list block");
  }

  const item = list.children[0];

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
  expect(first.containerDirectiveRaw).toBe(':::callout{tone="info"}\nBody\n:::');
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

  const listItem = list.children[0];

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

  if (!containerDirective || containerDirective.type !== "unsupported") {
    throw new Error("Expected unsupported container directive block");
  }

  return {
    containerDirectiveId: containerDirective.id,
    containerDirectiveRaw: containerDirective.raw,
    firstTableCellId: firstCell.id,
    firstTableRowId: firstRow.id,
    headingId: heading.id,
    headingText: heading.plainText,
    inlineDirectiveId: inlineDirective.id,
    inlineDirectiveRaw: inlineDirective.raw,
    leafDirectiveId: leafDirective.id,
    leafDirectiveRaw: leafDirective.raw,
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
