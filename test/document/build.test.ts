import { describe, expect, test } from "bun:test";
import {
  createCodeBlock,
  createHeadingTextBlock,
  createLink,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createParagraphTextBlock,
  createRaw,
  createRawBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
  rebuildCodeBlock,
  rebuildListBlock,
  rebuildTableBlock,
  rebuildTextBlock,
} from "@/document";

describe("Document builders", () => {
  describe("text blocks", () => {
    test("creates paragraphs and headings from semantic text input", () => {
      const paragraph = createParagraphTextBlock("Alpha");
      const heading = createHeadingTextBlock({
        depth: 2,
        text: "Beta",
      });
      const emptyParagraph = createParagraphTextBlock("");

      expect(paragraph.plainText).toBe("Alpha");
      expect(paragraph.children).toHaveLength(1);
      expect(heading.depth).toBe(2);
      expect(heading.plainText).toBe("Beta");
      expect(emptyParagraph.children).toEqual([]);
      expect(emptyParagraph.plainText).toBe("");
    });
  });

  describe("derived plain text", () => {
    test("creates lists, tables, links, and unsupported nodes from semantic children", () => {
      const listItem = createListItemBlock({
        children: [createParagraphTextBlock("alpha")],
      });
      const list = createListBlock({
        items: [listItem],
        ordered: true,
        start: 5,
      });
      const table = createTableBlock({
        align: [null, "right"],
        rows: [
          createTableRow([createTableCell([createText("A")]), createTableCell([createText("B")])]),
        ],
      });
      const paragraph = createParagraphBlock([
        createText("See "),
        createLink({
          children: [createText("alpha")],
          url: "https://example.com",
        }),
        createRaw({
          originalType: "textDirective",
          source: ":badge[beta]{disabled}",
        }),
      ]);
      const unsupportedBlock = createRawBlock({
        originalType: "containerDirective",
        source: ':::callout{tone="info"}\nBody\n:::',
      });

      expect(list.plainText).toBe("alpha");
      expect(list.ordered).toBe(true);
      expect(list.start).toBe(5);
      expect(table.plainText).toBe("A | B");
      expect(paragraph.plainText).toBe("See alpha:badge[beta]{disabled}");
      expect(unsupportedBlock.plainText).toBe(':::callout{tone="info"}\nBody\n:::');
    });
  });

  describe("rebuilders", () => {
    test("rebuild semantic nodes while preserving non-derived fields", () => {
      const heading = createHeadingTextBlock({
        depth: 3,
        text: "Before",
      });
      const rebuiltHeading = rebuildTextBlock(heading, [createText("After")]);
      const list = createListBlock({
        items: [
          createListItemBlock({
            checked: true,
            children: [createParagraphTextBlock("first")],
            spread: true,
          }),
        ],
        ordered: false,
        spread: true,
      });
      const rebuiltList = rebuildListBlock(
        list,
        [
          createListItemBlock({
            checked: true,
            children: [createParagraphTextBlock("renamed")],
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
        rows: [createTableRow([createTableCell([createText("one")])])],
      });
      const rebuiltTable = rebuildTableBlock(table, [
        createTableRow([createTableCell([createText("two")])]),
      ]);
      const code = createCodeBlock({
        language: "ts",
        meta: "title=demo.ts",
        source: "const before = true;",
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
  });
});
