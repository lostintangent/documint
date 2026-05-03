// Asserts on the `Document` tree that `parseDocument` produces. Round-trip
// stability is covered by `roundtrip.test.ts`.

import { describe, expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@/markdown";
import { expectBlockAt, expectInlineAt, findInline } from "../document/helpers";

describe("Inline parsing", () => {
  test("does not treat intra-word underscores as italic delimiters", () => {
    const document = parseDocument("snake_case_identifier\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children).toHaveLength(1);
    const text = expectInlineAt(paragraph.children, 0, "text");

    expect(text.text).toBe("snake_case_identifier");
    expect(text.marks).toEqual([]);
  });

  test("parses <br> as a hard line break", () => {
    const document = parseDocument("a<br>b\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children).toHaveLength(3);
    expect(expectInlineAt(paragraph.children, 0, "text").text).toBe("a");
    expectInlineAt(paragraph.children, 1, "lineBreak");
    expect(expectInlineAt(paragraph.children, 2, "text").text).toBe("b");
  });

  test("eats a trailing newline after <br> so authored line wraps don't leave a soft break", () => {
    const document = parseDocument("a<br>\nb\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children).toHaveLength(3);
    expect(expectInlineAt(paragraph.children, 0, "text").text).toBe("a");
    expectInlineAt(paragraph.children, 1, "lineBreak");
    // No leading `\n` on this text run — the parser consumed the newline
    // immediately following `<br>`.
    expect(expectInlineAt(paragraph.children, 2, "text").text).toBe("b");
  });

  test("accepts the self-closing and case-insensitive <br> spellings", () => {
    for (const spelling of ["<br/>", "<br />", "<BR>", "<Br/>"]) {
      const document = parseDocument(`a${spelling}b\n`);
      const paragraph = expectBlockAt(document, 0, "paragraph");

      expect(paragraph.children).toHaveLength(3);
      expectInlineAt(paragraph.children, 1, "lineBreak");
    }
  });

  test("parses two-or-more trailing spaces before a newline as a hard line break", () => {
    const document = parseDocument("a  \nb\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children).toHaveLength(3);
    expect(expectInlineAt(paragraph.children, 0, "text").text).toBe("a");
    expectInlineAt(paragraph.children, 1, "lineBreak");
    expect(expectInlineAt(paragraph.children, 2, "text").text).toBe("b");
  });

  test("parses backslash-newline as a hard line break", () => {
    const document = parseDocument("a\\\nb\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children).toHaveLength(3);
    expect(expectInlineAt(paragraph.children, 0, "text").text).toBe("a");
    expectInlineAt(paragraph.children, 1, "lineBreak");
    expect(expectInlineAt(paragraph.children, 2, "text").text).toBe("b");
  });

  test("treats a bare intra-paragraph newline as a soft break, not a hard break", () => {
    const document = parseDocument("a\nb\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    // A soft break is preserved as a literal `\n` inside the text run; the
    // layout's whitespace handling is what collapses it visually. There must
    // be no `lineBreak` inline produced.
    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
  });

  test("preserves <br>-like tags that aren't actually `<br>` as raw HTML", () => {
    const document = parseDocument("a<bridge>b\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
    expect(paragraph.children.some((child) => child.type === "raw")).toBe(true);
  });

  test("does not treat an escaped backslash followed by newline as a hard break", () => {
    // `\\\\\n` in source = two literal backslashes + newline. The first
    // backslash escapes the second, leaving the `\n` as a soft break.
    const document = parseDocument("a\\\\\nb\n");
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
  });
});

describe("Block parsing", () => {
  test("preserves directives as semantic block and unsupported inline content", () => {
    const document = parseDocument(`:::callout{tone}
Body
:::

Paragraph with :badge[alpha]{disabled} inline.
`);
    const containerDirective = expectBlockAt(document, 0, "directive");
    const paragraph = expectBlockAt(document, 1, "paragraph");
    const textDirective = findInline(paragraph.children, "raw");

    expect(containerDirective.name).toBe("callout");
    expect(containerDirective.attributes).toBe("tone");
    expect(containerDirective.body).toBe("Body");
    expect(textDirective.originalType).toBe("textDirective");
    expect(textDirective.source).toBe(":badge[alpha]{disabled}");
  });

  test("normalizes blank task items into empty semantic paragraphs", () => {
    const document = parseDocument("- [ ] \n");
    const list = expectBlockAt(document, 0, "list");
    const item = list.items[0];

    if (!item) {
      throw new Error("Expected task list item");
    }

    const paragraph = item.children[0];

    if (!paragraph || paragraph.type !== "paragraph") {
      throw new Error("Expected normalized empty paragraph");
    }

    expect(item.checked).toBe(false);
    expect(paragraph.children).toEqual([]);
  });
});

describe("Front matter", () => {
  test("captures leading yaml front matter on the document", () => {
    const document = parseDocument(`---
title: Hello
draft: false
---

# Body
`);

    expect(document.frontMatter).toBe("---\ntitle: Hello\ndraft: false\n---");
    expect(document.blocks[0]?.type).toBe("heading");
  });

  test("captures front matter on a document with no body blocks", () => {
    const document = parseDocument("---\ntitle: Stub\n---\n");

    expect(document.frontMatter).toBe("---\ntitle: Stub\n---");
    expect(document.blocks).toHaveLength(0);
  });

  test("treats an unterminated leading fence as a thematic break", () => {
    const document = parseDocument("---\n\nBody\n");

    expect(document.blocks[0]?.type).toBe("divider");
    expect(document.blocks[1]?.type).toBe("paragraph");
  });

  test("ignores mid-document yaml fences", () => {
    const document = parseDocument("# Title\n\n---\nkey: value\n---\n");

    expect(document.blocks[0]?.type).toBe("heading");
    expect(document.blocks.some((block) => block.type === "raw")).toBe(false);
  });
});

describe("Comment appendix extraction", () => {
  test("extracts comment threads with semantic metadata from the trailing appendix", async () => {
    const source = await Bun.file("test/goldens/comments-review.md").text();
    const document = parseDocument(source);

    expect(document.comments).toHaveLength(3);
    expect(document.comments[0]?.quote).toBe("review surface");
    expect(document.comments[1]?.quote).toBe("List feedback");
    expect(document.comments[2]?.quote).toBe("Table cell anchors");
  });

  test("drops misplaced comment appendices from document content", () => {
    const document = parseDocument(`:::documint-comments
[]
:::

Paragraph after misplaced appendix.
`);
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(document.blocks).toHaveLength(1);
    expect(paragraph.plainText).toBe("Paragraph after misplaced appendix.");
    expect(document.comments).toHaveLength(0);
  });

  test("rejects legacy comment appendix payload formats", () => {
    const document = parseDocument(`Paragraph before appendix.

:::documint-comments
\`\`\`json
{
  "threads": []
}
\`\`\`
:::
`);

    expect(document.blocks).toHaveLength(1);
    expect(document.comments).toHaveLength(0);
    // Stripping the unrecognized payload should leave the body alone.
    expect(serializeDocument(document)).toBe("Paragraph before appendix.\n");
  });
});

describe("Document identity", () => {
  test("produces stable ids across repeated parses", () => {
    const source = `# Heading

\`\`\`ts
const x = 1;
\`\`\`

Paragraph with :badge[alpha]{status="experimental"} inline.

- first

| A | B |
| - | - |
| one | two |

:::callout{tone="info"}
Body
:::
`;
    const first = summarizeRepresentativeNodes(parseDocument(source));
    const second = summarizeRepresentativeNodes(parseDocument(source));

    expect(first).toEqual(second);
    expect(first.headingText).toBe("Heading");
    expect(first.codeSource).toBe("const x = 1;");
    expect(first.codeLanguage).toBe("ts");
    expect(first.paragraphText).toBe('Paragraph with :badge[alpha]{status="experimental"} inline.');
    expect(first.listText).toBe("first");
    expect(first.listItemText).toBe("first");
    expect(first.tableText).toBe("A | B\none | two");
    expect(first.inlineDirectiveRaw).toBe(':badge[alpha]{status="experimental"}');
    expect(first.containerDirectiveName).toBe("callout");
    expect(first.containerDirectiveAttributes).toBe('tone="info"');
    expect(first.containerDirectiveBody).toBe("Body");
  });
});

function summarizeRepresentativeNodes(document: ReturnType<typeof parseDocument>) {
  const heading = expectBlockAt(document, 0, "heading");
  const code = expectBlockAt(document, 1, "code");
  const paragraph = expectBlockAt(document, 2, "paragraph");
  const inlineDirective = findInline(paragraph.children, "raw");
  const list = expectBlockAt(document, 3, "list");
  const listItem = list.items[0];

  if (!listItem) {
    throw new Error("Expected list item");
  }

  const table = expectBlockAt(document, 4, "table");
  const firstRow = table.rows[0];
  const firstCell = firstRow?.cells[0];

  if (!firstRow || !firstCell) {
    throw new Error("Expected first table row and cell");
  }

  const containerDirective = expectBlockAt(document, 5, "directive");

  return {
    codeId: code.id,
    codeLanguage: code.language,
    codeSource: code.source,
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
