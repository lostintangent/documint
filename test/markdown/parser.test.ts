// Asserts on the `Document` tree that `parseDocument` produces. Round-trip
// stability is covered by `roundtrip.test.ts`.

import { describe, expect, test } from "bun:test";
import type { Block, Inline, Mark, MetadataValue } from "@/document";
import { parseDocument, serializeDocument, type MarkdownOptions } from "@/markdown";
import { expectBlockAt, expectInlineAt, findInline } from "../document/helpers";
import {
  commentedParagraphMarkdown,
  expectCanonicalRoundTrip,
  expectStableRoundTrip,
} from "./helpers";

describe("Mentions", () => {
  test("parses user mentions as semantic inline nodes", () => {
    const paragraph = parseParagraph("Hello @[Jane Doe](user-123)!\n");
    const mention = expectInlineAt(paragraph.children, 1, "mention");

    expect(mention.name).toBe("Jane Doe");
    expect(mention.userId).toBe("user-123");
    expect(paragraph.plainText).toBe("Hello @Jane Doe!");
  });

  test("leaves bare mentions as text without mention targets", () => {
    const paragraph = parseParagraph("Hello @Jane.\n");

    expect(paragraph.children).toHaveLength(1);
    expectTextAt(paragraph.children, 0, "Hello @Jane.");
  });

  // A bare mention needs whitespace or the start of the text before it, a
  // non-name character after it, and takes the longest matching target.
  test.each([
    ["the longest target", "Hello @Jane Doe and @Jane.", ["u-jane-doe", "u-jane"]],
    ["mentions after a newline and a tab", "first\n@Jane\t@John", ["u-jane", "u-john"]],
    ["no mention inside a word", "email@Jane.com and @JaneDoe", []],
    ["no mention after punctuation", "(@Jane) and /@Jane", []],
  ])("reads bare mentions as %s", (_, source, userIds) => {
    const paragraph = parseParagraph(`${source}\n`, {
      mentionTargets: [
        { name: "Jane", userId: "u-jane" },
        { name: "Jane Doe", userId: "u-jane-doe" },
        { name: "John", userId: "u-john" },
      ],
    });

    expect(
      paragraph.children.flatMap((child) => (child.type === "mention" ? [child.userId] : [])),
    ).toEqual(userIds);
  });
});

describe("Resources", () => {
  test.each([
    ["a registered protocol link", "", "demo-resource:"],
    ["a titled link", ' "title"', "demo-resource:"],
    ["a protocol registered without its colon", "", "demo-resource"],
  ])("parses %s as a semantic resource node", (_, title, protocol) => {
    const paragraph = parseParagraph(
      `Use [Recording](demo-resource://recording/live${title}) now.\n`,
      { resourceProtocols: [protocol] },
    );

    expect(paragraph.children).toHaveLength(3);
    expect(expectInlineAt(paragraph.children, 1, "resource")).toMatchObject({
      label: "Recording",
      protocol: "demo-resource:",
      url: "demo-resource://recording/live",
    });
    expect(paragraph.plainText).toBe("Use Recording now.");
  });

  test("uses the link text projection as the resource label", () => {
    const paragraph = parseParagraph(
      "Use [ **Recording** session ](demo-resource://recording/live) now.\n",
      { resourceProtocols: ["demo-resource:"] },
    );

    expect(expectInlineAt(paragraph.children, 1, "resource").label).toBe(" Recording session ");
  });
});

describe("Images", () => {
  test.each([
    ["an image", "![Alt](a.png)", null],
    ["a sized image", "![Alt](a.png){width=120}", 120],
  ])("parses %s as a semantic image node", (_, source, width) => {
    expect(expectInlineAt(parseParagraph(`${source}\n`).children, 0, "image")).toMatchObject({
      alt: "Alt",
      url: "a.png",
      width,
    });
  });
});

describe("Inline marks", () => {
  test("does not treat intra-word underscores as italic delimiters", () => {
    const paragraph = parseParagraph("snake_case_identifier\n");

    expect(paragraph.children).toHaveLength(1);
    expectTextAt(paragraph.children, 0, "snake_case_identifier");
  });

  test.each([
    ["superscript", "Area x<sup>2</sup>\n", "2", ["superscript"], "Area x2"],
    ["u underline", "A <u>small</u> note.\n", "small", ["underline"], "A small note."],
  ] as const)(
    "parses %s html as a semantic text mark",
    (_label, source, text, marks, plainText) => {
      const paragraph = parseParagraph(source);

      expectTextAt(paragraph.children, 1, text, marks);
      expect(paragraph.plainText).toBe(plainText);
    },
  );

  test("parses inline code as a composable text mark", () => {
    const paragraph = parseParagraph("*`code`* and <ins>`underlined`</ins>\n");

    expectTextAt(paragraph.children, 0, "code", ["code", "italic"]);
    expectTextAt(paragraph.children, 2, "underlined", ["code", "underline"]);
  });

  test("nests emphasis by pairing each closer with the nearest compatible opener", () => {
    const paragraph = parseParagraph("_Note: a __b__ c._\n");

    expectTextAt(paragraph.children, 0, "Note: a ", ["italic"]);
    expectTextAt(paragraph.children, 1, "b", ["bold", "italic"]);
    expectTextAt(paragraph.children, 2, " c.", ["italic"]);
  });

  test("keeps a run that can open and close literal when the rule of 3 forbids the pair", () => {
    const paragraph = parseParagraph("*foo**bar*\n");

    expect(paragraph.children).toHaveLength(1);
    expectTextAt(paragraph.children, 0, "foo**bar", ["italic"]);
  });

  test.each([['a**"b"**'], ["中文**「加粗」**中文"], ["a * b * c"]])(
    "leaves %s literal because its delimiters can't open or close",
    (source) => {
      const paragraph = parseParagraph(`${source}\n`);

      expect(paragraph.children).toHaveLength(1);
      expectTextAt(paragraph.children, 0, source);
    },
  );
});

describe("Line breaks", () => {
  // Every hard-break encoding saves as a bare `<br>`. Authored `<br>\n` also
  // consumes its newline so it doesn't leave a soft break.
  test.each([
    ["bare <br>", "a<br>b\n"],
    ["self-closing <br/>", "a<br/>b\n"],
    ["spaced <br />", "a<br />b\n"],
    ["uppercase <BR>", "a<BR>b\n"],
    ["mixed-case <Br/>", "a<Br/>b\n"],
    ["<br>\\n (trailing newline absorbed)", "a<br>\nb\n"],
    ["two-or-more trailing spaces", "a  \nb\n"],
    ["backslash-newline", "a\\\nb\n"],
  ])("parses %s as a hard line break", (_label, source) => {
    const document = parseDocument(source);
    const paragraph = expectBlockAt(document, 0, "paragraph");

    expect(paragraph.children).toHaveLength(3);
    expectTextAt(paragraph.children, 0, "a");
    expectInlineAt(paragraph.children, 1, "lineBreak");
    expectTextAt(paragraph.children, 2, "b");
    expect(serializeDocument(document)).toBe("a<br>b\n");
  });

  // A soft break stays a literal `\n` inside the text run.
  test.each([
    ["a bare newline", "a\nb\n"],
    ["an escaped backslash before a newline", "a\\\\\nb\n"],
  ])("reads %s as a soft break", (_label, source) => {
    expect(parseParagraph(source).children.some((child) => child.type === "lineBreak")).toBe(false);
  });
});

describe("Entities", () => {
  test.each([
    ["hex", "&#x20;leading\n", " leading"],
    ["uppercase hex", "&#X20;leading\n", " leading"],
    ["decimal", "&#32;leading\n", " leading"],
    ["repeated", "&#x20;&#32;leading\n", "  leading"],
  ])("decodes %s ordinary-space entities as inline spaces", (_label, source, expected) => {
    const paragraph = parseParagraph(source);

    expectTextAt(paragraph.children, 0, expected);
  });
});

describe("Unsupported inline syntax", () => {
  test("preserves text directives as unsupported inline content", () => {
    const paragraph = parseParagraph("Paragraph with :badge[alpha]{disabled} inline.\n");
    const textDirective = findInline(paragraph.children, "raw");

    expect(textDirective.originalType).toBe("textDirective");
    expect(textDirective.source).toBe(":badge[alpha]{disabled}");
  });

  test("preserves <br>-like tags that aren't actually `<br>` as raw HTML", () => {
    const paragraph = parseParagraph("a<bridge>b\n");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
    expect(paragraph.children.some((child) => child.type === "raw")).toBe(true);
  });
});

// Only ASCII punctuation escapes, so other backslashes and a trailing one stay
// literal.
describe("Backslash escapes", () => {
  test.each([
    ["\\#foo", "#foo"],
    ["\\>foo", ">foo"],
    ["\\:foo", ":foo"],
    ["\\\\foo", "\\foo"],
    ["a\\bc", "a\\bc"],
    ["foo\\", "foo\\"],
  ])("reads `%s` as `%s`", (source, plainText) => {
    expect(parseParagraph(`${source}\n`).plainText).toBe(plainText);
  });
});

describe("Link brackets", () => {
  test("lets a code span that spans the closing bracket win over the link", () => {
    const paragraph = parseParagraph("[a `b](u)` c\n");

    expect(paragraph.children.some((child) => child.type === "link")).toBe(false);
    expectTextAt(paragraph.children, 1, "b](u)", ["code"]);
  });
});

describe("Reference links", () => {
  test.each([
    ["a reference after its definition", "[ws]: /ws\n\nTry [ws].\n", "Try [ws](/ws).\n"],
    ["a label in another case", "[Foo  Bar][]\n\n[foo bar]: /u\n", "[Foo  Bar](/u)\n"],
    ["a code span label", "[`isUtf8()`][]\n\n[`isutf8()`]: /u\n", "[`isUtf8()`](/u)\n"],
    ["the first of two definitions", "[a]\n\n[a]: /first\n[A]: /second\n", "[a](/first)\n"],
  ])("saves %s as an inline link", (_, source, canonical) => {
    expectCanonicalRoundTrip(source, canonical);
  });

  test.each([
    ["a full reference to an undefined label", "[a][b]\n\n[a]: /a\n", "\\[a\\]\\[b\\]\n"],
    ["an escaped reference", "\\[a\\]\n\n[a]: /a\n", "\\[a\\]\n"],
  ])("leaves %s as text", (_, source, canonical) => {
    expectCanonicalRoundTrip(source, canonical);
  });

  test("prefers an inline link and falls back to a shortcut when it fails", () => {
    expectCanonicalRoundTrip(
      "[a](/inline) and [a](not a link)\n\n[a]: /ref\n",
      "[a](/inline) and [a](/ref)(not a link)\n",
    );
  });

  test.each([
    ["after paragraph text", "Text\n[a]: /u\n", "Text\n\\[a\\]: /u\n"],
    ["with text after its title", '[a]: /u "t" more\n', '\\[a\\]: /u "t" more\n'],
  ])("reads a definition-like line %s as text", (_, source, canonical) => {
    expectCanonicalRoundTrip(source, canonical);
  });
});

describe("Block parsing", () => {
  test("parses a fenced code info string as the language and its body as source", () => {
    const code = expectBlockAt(parseDocument("```ts\nconst x = 1;\n```\n"), 0, "code");

    expect(code.language).toBe("ts");
    expect(code.source).toBe("const x = 1;");
  });

  test("preserves container directives as semantic blocks", () => {
    const document = parseDocument(`:::callout{tone}
Body
:::
`);
    const containerDirective = expectBlockAt(document, 0, "directive");

    expect(containerDirective.name).toBe("callout");
    expect(containerDirective.attributes).toBe("tone");
    expect(containerDirective.body).toBe("Body");
  });

  test("normalizes blank task items into empty semantic paragraphs", () => {
    const item = expectBlockAt(parseDocument("- [ ] \n"), 0, "list").items[0];

    expect(item?.checked).toBe(false);
    expect(item?.children).toMatchObject([{ children: [], type: "paragraph" }]);
  });

  test("parses blank-line-separated sibling bullets as one non-compact list", () => {
    const source = "- alpha\n\n- beta\n";
    const document = parseDocument(source);
    const list = expectBlockAt(document, 0, "list");

    expect(document.blocks).toHaveLength(1);
    expect(list.compact).toBe(false);
    expect(list.items.map((item) => [item.compact, item.plainText])).toEqual([
      [true, "alpha"],
      [true, "beta"],
    ]);
    expect(serializeDocument(document)).toBe(source);
  });

  test("parses blank-line-separated child blocks as one non-compact list item", () => {
    const source = "- alpha\n\n  beta\n";
    const document = parseDocument(source);
    const list = expectBlockAt(document, 0, "list");

    expect(list.compact).toBe(false);
    expect(list.items[0]?.compact).toBe(false);
    expect(list.items[0]?.children.map((child) => child.plainText)).toEqual(["alpha", "beta"]);
    expect(serializeDocument(document)).toBe(source);
  });

  // A task checkbox belongs to the item's first line, so children indent to
  // the list marker. An item that opens empty indents one past its marker.
  test.each<[string, string, Block["type"][]]>([
    ["a task's nested list", "- [x] Hello\n  - child\n", ["paragraph", "list"]],
    ["an ordered task's nested list", "1. [ ] Hello\n   - child\n", ["paragraph", "list"]],
    ["a task's directive", "- [x] :::note\n  body\n  :::\n", ["directive"]],
    ["an empty task's nested list", "- [x]\n  - child\n", ["list"]],
    ["an empty bullet's nested list", "-\n  - child\n", ["list"]],
  ])("keeps %s inside its list item", (_, source, childTypes) => {
    const document = parseDocument(source);
    const item = expectBlockAt(document, 0, "list").items[0];

    expect(document.blocks).toHaveLength(1);
    expect(item?.children.map((child) => child.type)).toEqual(childTypes);
    expect(serializeDocument(document)).toBe(source);
  });

  // List markers may sit behind up to three spaces of indentation, and a line
  // indented to an item's content column nests in that item.
  test.each([
    ["4-space nesting", "- a\n    - b\n        - c\n", "- a\n  - b\n    - c\n"],
    ["4-space nesting under `*` markers", "* a\n    * b\n* c\n", "- a\n  - b\n- c\n"],
    ["4-space nesting under an ordered item", "1. a\n    1. b\n", "1. a\n   1. b\n"],
    ["loose 4-space nesting", "- a\n\n    - b\n", "- a\n\n  - b\n"],
    ["4-space nested tasks", "- [ ] a\n    - [x] b\n", "- [ ] a\n  - [x] b\n"],
    ["an indented bullet list", "  - a\n  - b\n", "- a\n- b\n"],
    ["an indented ordered list", " 1. a\n 2. b\n", "1. a\n2. b\n"],
    ["siblings at mixed indents", "- a\n - b\n  - c\n", "- a\n- b\n- c\n"],
    ["an indented list after a paragraph", "Intro\n  - a\n", "Intro\n\n- a\n"],
    ["a quoted list", "> - a\n>     - b\n", "> - a\n>   - b\n"],
  ])("parses %s as a list", (_, source, canonical) => {
    expectCanonicalRoundTrip(source, canonical);
  });

  test("keeps a list tight when a blank line and under-indented text end it", () => {
    const document = parseDocument("1. a\n2. b\n\n  c\n");

    expect(expectBlockAt(document, 0, "list").compact).toBe(true);
    expect(document.blocks.map((block) => block.type)).toEqual(["list", "paragraph"]);
  });

  test("parses a pipe row without an alignment row as paragraph text", () => {
    const document = parseDocument("| a |\ntext\n");

    expect(expectBlockAt(document, 0, "paragraph").plainText).toBe("| a |\ntext");
  });

  test("pads table rows with empty cells to the widest row", () => {
    const document = parseDocument("| a | b |\n| - | - |\n| c |\n| d | e | f |\n");
    const table = expectBlockAt(document, 0, "table");

    expect(table.rows.map((row) => row.cells.map((cell) => cell.plainText))).toEqual([
      ["a", "b", ""],
      ["c", "", ""],
      ["d", "e", "f"],
    ]);
  });

  // A bare marker, or one followed only by a closing sequence, is an empty
  // heading, as on GitHub.
  test.each([
    ["a bare marker", "Intro\n\n##\n\nBody\n", "Intro\n\n##\n\nBody\n"],
    ["only a closing sequence", "# ##\n", "#\n"],
  ])("reads %s as an empty heading", (_, source, canonical) => {
    const heading = parseDocument(source).blocks.find((block) => block.type === "heading");

    expect(heading?.plainText).toBe("");
    expectCanonicalRoundTrip(source, canonical);
  });

  // Setext headings and indented code save as `#` headings and fenced code,
  // and a heading's trailing `#` run stays escaped.
  // An indented line can't interrupt a paragraph, and task text is never code.
  // A tag wrapped across lines drops its indentation, as GFM does. A lazy line
  // continues the paragraph in its quote or item and saves with its prefix. A
  // blank line ends a quote, while a `>` line alone only ends its paragraph. An
  // opening divider saves as `***`, since `---` would reload as front matter.
  // A fence closes on a backtick-only line at least as long, and saves one
  // longer than any such line in its code.
  test.each([
    ["a setext heading", "Title\n=====\n", "# Title\n"],
    ["a wrapped setext heading over a divider", "Foo\nbar\n---\n", "## Foo bar\n"],
    ["a setext heading ending in a #", "Title \\#\n===\n", "# Title \\#\n"],
    ["a heading of only a #", "\\#\n=\n", "# \\#\n"],
    ["an underline after a definition", "[a]: /u\n===\n", "\\===\n"],
    ["indented code", "a\n\n    b\n\n\n      c\n\nd\n", "a\n\n```\nb\n\n\n  c\n```\n\nd\n"],
    ["an indented wrapped line", "a\n    b\n", "a\n&#x20;&#x20;&#x20;&#x20;b\n"],
    ["a wrapped HTML tag", '<img a="1"\n     b="2"> c\n', '<img a="1"\nb="2"> c\n'],
    ["a wrapped line starting with a year", "In\n2021. It works\n", "In\n2021\\. It works\n"],
    ["over-indented task text", "- [ ]     b\n", "- [ ] b\n"],
    ["lazy quote lines", "> a\nb\n> c\nd\n\ne\n", "> a\n> b\n> c\n> d\n\ne\n"],
    ["lazy lines only after paragraph text", "> # a\nb\n> c\nd\n", "> # a\n\nb\n\n> c\n> d\n"],
    ["lazy lines in an ordered item", "1. a\nb\n   c\n2. d\n", "1. a\n   b\n   c\n2. d\n"],
    ["a lazy line in a nested item", "- a\n  - b\nc\n", "- a\n  - b\n    c\n"],
    ["a lazy line shaped like an underline", "> a\n===\n", "> a\n> \\===\n"],
    ["quotes split by a blank line", "> a\n\n> b\n>\n> c\n>\nd\n", "> a\n\n> b\n>\n> c\n\nd\n"],
    ["an opening divider", "***\n\nBody\n\n***\n", "***\n\nBody\n\n---\n"],
    ["nested fences", "````md\n```\nx\n```\n`````\n", "````md\n```\nx\n```\n````\n"],
    ["code holding fence lines", "    ````\n    ```\n", "`````\n````\n```\n`````\n"],
  ])("canonicalizes %s", (_, source, canonical) => {
    expectCanonicalRoundTrip(source, canonical);
  });
});

// HTML blocks follow CommonMark's start and end conditions and keep their
// lines verbatim, so README headers render the same after a save.
describe("HTML blocks", () => {
  test.each([
    ["a centered README header", '<p align="center">\n  <img src="logo.png">\n</p>\n'],
    ["a comment spanning a blank line", "<!--\n  note\n\n    more\n-->\n"],
    ["a script spanning a blank line", "<script setup>\nimport x\n\nconst y = 1\n</script>\n"],
    [
      "a custom component",
      "<VPTeamPage>\n  <VPTeamPageTitle>Team</VPTeamPageTitle>\n</VPTeamPage>\n",
    ],
    ["a tab-indented header", "<h1>\n\t<b>name</b>\n\t<br>\n</h1>\n"],
  ])("preserves %s", (_, source) => {
    expectStableRoundTrip(source);
  });

  test("parses markdown between HTML blocks separated by blank lines", () => {
    const source = "<details>\n<summary>Install</summary>\n\nRun **it**.\n\n</details>\n";
    const document = parseDocument(source);

    expect(document.blocks.map((block) => block.type)).toEqual(["raw", "paragraph", "raw"]);
    expect(serializeDocument(document)).toBe(source);
  });

  test.each([
    ["a linked image", 'Text\n<a href="x"><img src="y"></a>\n'],
    ["an image", 'Text\n<img src="y">\n'],
  ])("keeps a line holding %s inside the paragraph above it", (_, source) => {
    const document = parseDocument(source);

    expect(document.blocks.map((block) => block.type)).toEqual(["paragraph"]);
    expect(serializeDocument(document)).toBe(source);
  });

  test("lets a block-level tag interrupt a paragraph", () => {
    expectCanonicalRoundTrip("Text\n<div>\nx\n</div>\n", "Text\n\n<div>\nx\n</div>\n");
  });

  test("keeps an indented HTML block at its list item's content column", () => {
    expectStableRoundTrip('- Plugins:\n\n  <p align="center">\n    <img src="x">\n  </p>\n');
  });

  test("does not grow an unclosed comment on each save", () => {
    expectCanonicalRoundTrip("<!-- open\n\ntext\n\n", "<!-- open\n\ntext\n");
  });
});

describe("Document metadata", () => {
  test("parses the structured scalar subset in source order and emits it canonically", () => {
    const document = parseDocument(`---
title: Docs
"release channel": stable
draft: false
published: true
quotedFalse: "false"
url: https://example.com/docs
---

# Body
`);

    expect(document.metadata).toEqual(
      new Map<string, MetadataValue>([
        ["title", "Docs"],
        ["release channel", "stable"],
        ["draft", false],
        ["published", true],
        ["quotedFalse", "false"],
        ["url", "https://example.com/docs"],
      ]),
    );
    expect(serializeDocument(document)).toBe(`---
title: "Docs"
"release channel": "stable"
draft: false
published: true
quotedFalse: "false"
url: "https://example.com/docs"
---

# Body
`);
    expect(document.blocks[0]?.type).toBe("heading");
  });

  test("parses and emits canonical literal strings for each chomping mode", () => {
    const source = [
      "---",
      "withoutTrailing: |-",
      "  alpha",
      "  beta",
      "withOneTrailing: |",
      "  gamma",
      "  delta",
      "withManyTrailing: |+",
      "  epsilon",
      "  zeta",
      "",
      "---",
      "",
    ].join("\n");
    const document = parseDocument(source);

    expect(document.metadata).toEqual(
      new Map([
        ["withoutTrailing", "alpha\nbeta"],
        ["withOneTrailing", "gamma\ndelta\n"],
        ["withManyTrailing", "epsilon\nzeta\n\n"],
      ]),
    );
    expect(document.blocks).toHaveLength(0);
    expect(serializeDocument(document)).toBe(source);
  });

  test.each([
    ["duplicate source keys", ["title: First", "title: Second"]],
    ["duplicate decoded keys", ["title: First", '"title": Second']],
    ["folded scalars", ["summary: >-", "  folded text"]],
    ["indented mappings", ["settings: ", "  theme: dark"]],
    ["indented sequences", ["tags: ", "  - docs"]],
    ["empty values", ["title:"]],
    ["flow collections", ["tags: [docs, sample]"]],
    ["numeric values", ["priority: 1"]],
    ["blank formatting", ["title: First", "", "draft: false"]],
    ["comment-only lines", ["title: First", "# preserved comment"]],
    ["unsupported indentation indicators", ["summary: |4", "    text"]],
  ])("preserves %s as exact raw metadata", (_label, interiorLines) => {
    const source = ["---", ...interiorLines, "---", "", "# Body", ""].join("\n");
    const document = parseDocument(source);

    expect(document.metadata).toEqual({ raw: interiorLines.join("\n") });
    expect(document.blocks[0]?.type).toBe("heading");
    expect(serializeDocument(document)).toBe(source);
  });

  test("treats an unterminated leading fence as a thematic break", () => {
    const document = parseDocument("---\n\nBody\n");

    expect(document.metadata).toBeNull();
    expect(document.blocks[0]?.type).toBe("divider");
    expect(document.blocks[1]?.type).toBe("paragraph");
  });

  test("ignores mid-document yaml fences", () => {
    const document = parseDocument("# Title\n\n---\nkey: value\n---\n");

    expect(document.metadata).toBeNull();
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

  test("generates comment thread ids that ignore saved ids and survive round trips", () => {
    const document = parseDocument(commentedParagraphMarkdown({ id: "persisted-comment-id" }));
    const id = document.comments[0]?.id;

    expect(id).toMatch(/^commentThread-/);
    expect(parseDocument(serializeDocument(document)).comments[0]?.id).toBe(id);
  });

  test("keeps threads whose quote was deleted or that have no anchor", () => {
    const [emptyQuote] = parseDocument(commentedParagraphMarkdown({ quote: "" })).comments;
    const [anchorless] = parseDocument(commentedParagraphMarkdown({ anchor: undefined })).comments;

    expect(emptyQuote).toMatchObject({ anchor: { prefix: "Paragraph" }, quote: "" });
    expect(anchorless?.anchor).toEqual({});
    expect(anchorless?.quote).toBe(" with ");
  });

  test.each<[unknown, number | undefined]>([
    [2, 2],
    [0, undefined],
    [1.5, undefined],
    [2 ** 53, undefined],
    ["2", undefined],
  ])("loads a saved occurrence of %p as %p and keeps the thread", (occurrence, expected) => {
    const anchor = { occurrence, prefix: "Paragraph", suffix: " with a comment." };
    const [thread] = parseDocument(commentedParagraphMarkdown({ anchor })).comments;

    expect(thread?.anchor.occurrence).toBe(expected);
    expect(thread?.id).toBe(parseDocument(commentedParagraphMarkdown()).comments[0]?.id);
  });

  test("drops misplaced comment appendices and their threads", () => {
    const document = parseDocument(`:::documint-comments
[{ "quote": "after", "anchor": {}, "comments": [{ "body": "Misplaced.", "updatedAt": "2026-04-05T12:00:00.000Z" }] }]
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

function parseParagraph(source: string, options?: MarkdownOptions) {
  return expectBlockAt(parseDocument(source, options), 0, "paragraph");
}

function expectTextAt(
  inlines: readonly Inline[],
  index: number,
  text: string,
  marks: readonly Mark[] = [],
) {
  const inline = expectInlineAt(inlines, index, "text");

  expect(inline.text).toBe(text);
  expect(inline.marks).toEqual([...marks]);
  return inline;
}
