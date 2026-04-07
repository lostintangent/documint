import { expect, test } from "bun:test";
import {
  createCodeBlock,
  createHeadingTextBlock,
  createLink,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
  createRawBlock,
  createRaw,
  rebuildCodeBlock,
  rebuildListBlock,
  rebuildTableBlock,
  rebuildTextBlock,
} from "@/document";

test("creates canonical text blocks from semantic text input", () => {
  const paragraph = createParagraphTextBlock({
    text: "Alpha",
  });
  const heading = createHeadingTextBlock({
    depth: 2,
    text: "Beta",
  });
  const emptyParagraph = createParagraphTextBlock({
    text: "",
  });

  expect(paragraph.plainText).toBe("Alpha");
  expect(paragraph.children).toHaveLength(1);
  expect(paragraph.id).toBe(
    createParagraphTextBlock({
      text: "Alpha",
    }).id,
  );
  expect(heading.depth).toBe(2);
  expect(heading.plainText).toBe("Beta");
  expect(heading.id).toBe(
    createHeadingTextBlock({
      depth: 2,
      text: "Beta",
    }).id,
  );
  expect(emptyParagraph.children).toEqual([]);
  expect(emptyParagraph.plainText).toBe("");
});

test("creates lists, tables, links, and unsupported nodes from semantic children", () => {
  const listItem = createListItemBlock({
    children: [
      createParagraphTextBlock({
        text: "alpha",
      }),
    ],
    path: "root.0.children.0",
  });
  const list = createListBlock({
    children: [listItem],
    ordered: true,
    path: "root.0",
    start: 5,
  });
  const table = createTableBlock({
    align: [null, "right"],
    path: "root.1",
    rows: [
      createTableRow({
        cells: [
          createTableCell({
            children: [createText({ path: "root.1.rows.0.cells.0.children.0", text: "A" })],
            path: "root.1.rows.0.cells.0",
          }),
          createTableCell({
            children: [createText({ path: "root.1.rows.0.cells.1.children.0", text: "B" })],
            path: "root.1.rows.0.cells.1",
          }),
        ],
        path: "root.1.rows.0",
      }),
    ],
  });
  const paragraph = createParagraphBlock({
    children: [
      createText({ path: "root.2.children.0", text: "See " }),
      createLink({
        children: [createText({ path: "root.2.children.1.children.0", text: "alpha" })],
        path: "root.2.children.1",
        url: "https://example.com",
      }),
      createRaw({
        originalType: "textDirective",
        path: "root.2.children.2",
        raw: ":badge[beta]{disabled}",
      }),
    ],
    path: "root.2",
  });
  const unsupportedBlock = createRawBlock({
    originalType: "containerDirective",
    path: "root.3",
    raw: ":::callout{tone=\"info\"}\nBody\n:::",
  });

  expect(list.plainText).toBe("alpha");
  expect(list.ordered).toBe(true);
  expect(list.start).toBe(5);
  expect(table.plainText).toBe("A | B");
  expect(table.rows[0]?.id).toBe(
    createTableRow({
      cells: table.rows[0]!.cells,
      path: "root.1.rows.0",
    }).id,
  );
  expect(paragraph.plainText).toBe("See alpha:badge[beta]{disabled}");
  expect(unsupportedBlock.plainText).toBe(":::callout{tone=\"info\"}\nBody\n:::");
});

test("rebuilds semantic nodes while preserving non-derived fields", () => {
  const heading = createHeadingTextBlock({
    depth: 3,
    text: "Before",
  });
  const rebuiltHeading = rebuildTextBlock(heading, [
    createText({
      path: "root.0.children.0",
      text: "After",
    }),
  ]);
  const list = createListBlock({
    children: [
      createListItemBlock({
        checked: true,
        children: [
          createParagraphTextBlock({
            text: "first",
          }),
        ],
        path: "root.1.children.0",
        spread: true,
      }),
    ],
    ordered: false,
    path: "root.1",
    spread: true,
  });
  const rebuiltList = rebuildListBlock(
    list,
    [
      createListItemBlock({
        checked: true,
        children: [
          createParagraphTextBlock({
            text: "renamed",
          }),
        ],
        path: "root.1.children.0",
        spread: true,
      }),
    ],
    {
      ordered: true,
      start: 3,
    },
  );
  const table = createTableBlock({
    align: ["center"],
    path: "root.2",
    rows: [
      createTableRow({
        cells: [
          createTableCell({
            children: [createText({ path: "root.2.rows.0.cells.0.children.0", text: "one" })],
            path: "root.2.rows.0.cells.0",
          }),
        ],
        path: "root.2.rows.0",
      }),
    ],
  });
  const rebuiltTable = rebuildTableBlock(
    table,
    [
      createTableRow({
        cells: [
          createTableCell({
            children: [createText({ path: "root.2.rows.0.cells.0.children.0", text: "two" })],
            path: "root.2.rows.0.cells.0",
          }),
        ],
        path: "root.2.rows.0",
      }),
    ],
  );
  const code = createCodeBlock({
    language: "ts",
    meta: "title=demo.ts",
    path: "root.3",
    value: "const before = true;",
  });
  const rebuiltCode = rebuildCodeBlock(code, "const after = true;");

  expect(rebuiltHeading.type).toBe("heading");
  if (rebuiltHeading.type !== "heading") {
    throw new Error("Expected rebuilt heading");
  }

  expect(rebuiltHeading.depth).toBe(3);
  expect(rebuiltHeading.plainText).toBe("After");
  expect(rebuiltList.ordered).toBe(true);
  expect(rebuiltList.start).toBe(3);
  expect(rebuiltList.spread).toBe(true);
  expect(rebuiltList.plainText).toBe("renamed");
  expect(rebuiltTable.align).toEqual(["center"]);
  expect(rebuiltTable.plainText).toBe("two");
  expect(rebuiltCode.language).toBe("ts");
  expect(rebuiltCode.meta).toBe("title=demo.ts");
  expect(rebuiltCode.plainText).toBe("const after = true;");
});
