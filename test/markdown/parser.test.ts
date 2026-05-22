// Asserts on the `Document` tree that `parseDocument` produces. Round-trip
// stability is covered by `roundtrip.test.ts`.

import { describe, expect, test } from "bun:test";
import { parseDocument, serializeDocument } from "@/markdown";
import { expectBlockAt, expectInlineAt, findInline } from "../document/helpers";

describe("Inline parsing", () => {
  // --- Hard line breaks ---
  // All four CommonMark encodings produce a `lineBreak` inline between the
  // surrounding `a` and `b` text runs. The `<br>\n` case additionally
  // consumes the trailing newline so authored `<br>\n` (a common line-wrap
  // convention) doesn't leave a soft break.
  test.each([
    ["bare <br>", "a<br>b\n"],
    ["<br>\\n (trailing newline absorbed)", "a<br>\nb\n"],
    ["two-or-more trailing spaces", "a  \nb\n"],
    ["backslash-newline", "a\\\nb\n"],
  ])("parses %s as a hard line break", (_label, source) => {
    const paragraph = expectBlockAt(parseDocument(source), 0, "paragraph");

    expect(paragraph.children).toHaveLength(3);
    expect(expectInlineAt(paragraph.children, 0, "text").text).toBe("a");
    expectInlineAt(paragraph.children, 1, "lineBreak");
    expect(expectInlineAt(paragraph.children, 2, "text").text).toBe("b");
  });

  test.each([["<br/>"], ["<br />"], ["<BR>"], ["<Br/>"]])(
    "accepts %s as a self-closing / case-insensitive <br> spelling",
    (spelling) => {
      const paragraph = expectBlockAt(parseDocument(`a${spelling}b\n`), 0, "paragraph");

      expect(paragraph.children).toHaveLength(3);
      expectInlineAt(paragraph.children, 1, "lineBreak");
    },
  );

  test("treats a bare intra-paragraph newline as a soft break, not a hard break", () => {
    // A soft break is preserved as a literal `\n` inside the text run; the
    // layout's whitespace handling is what collapses it visually. There must
    // be no `lineBreak` inline produced.
    const paragraph = expectBlockAt(parseDocument("a\nb\n"), 0, "paragraph");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
  });

  // --- Mentions ---
  test("parses user mentions as semantic inline nodes", () => {
    const paragraph = expectBlockAt(
      parseDocument("Hello @[Jane Doe](user-123)!\n"),
      0,
      "paragraph",
    );
    const mention = expectInlineAt(paragraph.children, 1, "mention");

    expect(mention.name).toBe("Jane Doe");
    expect(mention.userId).toBe("user-123");
    expect(paragraph.plainText).toBe("Hello @Jane Doe!");
  });

  // --- Edge cases that mimic hard-break / mark syntax but aren't ---
  test("preserves <br>-like tags that aren't actually `<br>` as raw HTML", () => {
    const paragraph = expectBlockAt(parseDocument("a<bridge>b\n"), 0, "paragraph");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
    expect(paragraph.children.some((child) => child.type === "raw")).toBe(true);
  });

  test("does not treat an escaped backslash followed by newline as a hard break", () => {
    // `\\\\\n` in source = two literal backslashes + newline. The first
    // backslash escapes the second, leaving the `\n` as a soft break.
    const paragraph = expectBlockAt(parseDocument("a\\\\\nb\n"), 0, "paragraph");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
  });

  test("does not treat intra-word underscores as italic delimiters", () => {
    const paragraph = expectBlockAt(parseDocument("snake_case_identifier\n"), 0, "paragraph");
    const text = expectInlineAt(paragraph.children, 0, "text");

    expect(paragraph.children).toHaveLength(1);
    expect(text.text).toBe("snake_case_identifier");
    expect(text.marks).toEqual([]);
  });

  test("parses superscript html as a semantic text mark", () => {
    const paragraph = expectBlockAt(parseDocument("Area x<sup>2</sup>\n"), 0, "paragraph");
    const superscript = expectInlineAt(paragraph.children, 1, "text");

    expect(superscript.text).toBe("2");
    expect(superscript.marks).toEqual(["superscript"]);
    expect(paragraph.plainText).toBe("Area x2");
  });
});

describe("Backslash escapes", () => {
  // Directly exercises `readGenericEscapeToken`. Round-trip coverage in
  // `serializer.test.ts` exercises the escapable paths through the
  // `Paragraph block-start escapes` table; these tests lock down the
  // non-escapable and trailing-`\` branches that round-trip can't reach.

  test.each([
    ["\\#", "#"],
    ["\\>", ">"],
    ["\\:", ":"],
    ["\\\\", "\\"],
  ])("unescapes `%s` to plain text `%s`", (escaped, unescaped) => {
    const paragraph = expectBlockAt(parseDocument(`${escaped}foo\n`), 0, "paragraph");
    expect(paragraph.plainText).toBe(`${unescaped}foo`);
  });

  test("preserves a backslash before an unrecognized character as literal `\\X`", () => {
    // CommonMark allows only ASCII punctuation to be escaped. `\a` is not a
    // recognized escape, so both characters survive into the text node.
    const paragraph = expectBlockAt(parseDocument("a\\bc\n"), 0, "paragraph");
    expect(paragraph.plainText).toBe("a\\bc");
  });

  test("preserves a trailing backslash at end of input as literal `\\`", () => {
    // The reader returns null when `\` has no following character, so the
    // dispatcher's default one-char advance leaves it as text.
    const paragraph = expectBlockAt(parseDocument("foo\\\n"), 0, "paragraph");
    expect(paragraph.plainText).toBe("foo\\");
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

  test("lets document normalization own parsed comment thread ids", () => {
    const document = parseDocument(`Paragraph with a comment.

:::documint-comments
[
  {
    "id": "persisted-comment-id",
    "anchor": {
      "prefix": "Paragraph",
      "suffix": " with a comment."
    },
    "comments": [
      {
        "body": "Reviewing this.",
        "updatedAt": "2026-04-05T12:00:00.000Z"
      }
    ],
    "quote": " with "
  }
]
:::
`);

    expect(document.comments[0]?.id).toMatch(/^commentThread-/);
    expect(document.comments[0]?.id).not.toBe("persisted-comment-id");
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
