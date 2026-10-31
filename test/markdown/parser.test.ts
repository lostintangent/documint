// Asserts on the `Document` tree that `parseDocument` produces. Round-trip
// stability is covered by `roundtrip.test.ts`.

import { describe, expect, test } from "bun:test";
import type { Inline, Mark, MetadataValue } from "@/document";
import { parseDocument, serializeDocument, type MarkdownOptions } from "@/markdown";
import { fixtureOptions } from "../../playground/src/lib/data";
import { expectBlockAt, expectInlineAt, findInline } from "../document/helpers";
import { commentedParagraphMarkdown } from "./helpers";

describe("Mentions", () => {
  test("parses user mentions as semantic inline nodes", () => {
    const paragraph = parseParagraph("Hello @[Jane Doe](user-123)!\n");
    const mention = expectInlineAt(paragraph.children, 1, "mention");

    expect(mention.name).toBe("Jane Doe");
    expect(mention.userId).toBe("user-123");
    expect(paragraph.plainText).toBe("Hello @Jane Doe!");
  });

  test("parses bare mentions from explicit mention targets", () => {
    const paragraph = parseParagraph("Hello @Jane Doe and @Jane.\n", {
      mentionTargets: [
        { name: "Jane", userId: "u-jane" },
        { name: "Jane Doe", userId: "u-jane-doe" },
      ],
    });
    const firstMention = expectInlineAt(paragraph.children, 1, "mention");
    const secondMention = expectInlineAt(paragraph.children, 3, "mention");

    expect(firstMention.name).toBe("Jane Doe");
    expect(firstMention.userId).toBe("u-jane-doe");
    expect(secondMention.name).toBe("Jane");
    expect(secondMention.userId).toBe("u-jane");
  });

  test("leaves bare mentions as text without mention targets", () => {
    const paragraph = parseParagraph("Hello @Jane.\n");

    expect(paragraph.children).toHaveLength(1);
    expectTextAt(paragraph.children, 0, "Hello @Jane.");
  });

  test("does not parse bare mentions embedded inside words", () => {
    const paragraph = parseParagraph("email@Jane.com and @JaneDoe\n", {
      mentionTargets: [{ name: "Jane", userId: "u-jane" }],
    });

    expect(paragraph.children).toHaveLength(1);
    expectTextAt(paragraph.children, 0, "email@Jane.com and @JaneDoe");
  });

  test("opens bare mentions after newline and tab boundaries", () => {
    const paragraph = parseParagraph("first\n@Jane\t@John\n", {
      mentionTargets: [
        { name: "Jane", userId: "u-jane" },
        { name: "John", userId: "u-john" },
      ],
    });

    expect(expectInlineAt(paragraph.children, 1, "mention").userId).toBe("u-jane");
    expect(expectInlineAt(paragraph.children, 3, "mention").userId).toBe("u-john");
  });

  test("does not parse bare mentions immediately after punctuation", () => {
    const paragraph = parseParagraph("(@Jane) and /@Jane\n", {
      mentionTargets: [{ name: "Jane", userId: "u-jane" }],
    });

    expect(paragraph.children).toHaveLength(1);
    expectTextAt(paragraph.children, 0, "(@Jane) and /@Jane");
  });
});

describe("Resources", () => {
  test("parses registered protocol links as semantic resource nodes", () => {
    const paragraph = parseParagraph("Use [Recording](demo-resource://recording/live) now.\n", {
      resourceProtocols: ["demo-resource:"],
    });
    const resource = expectInlineAt(paragraph.children, 1, "resource");

    expect(paragraph.children).toHaveLength(3);
    expect(paragraph.children.some((child) => child.type === "link")).toBe(false);
    expect(resource.label).toBe("Recording");
    expect(resource.protocol).toBe("demo-resource:");
    expect(resource.url).toBe("demo-resource://recording/live");
    expect(paragraph.plainText).toBe("Use Recording now.");
  });

  test("canonicalizes registered resource protocols without trailing colons", () => {
    const paragraph = parseParagraph("Use [Recording](demo-resource://recording/live) now.\n", {
      resourceProtocols: ["demo-resource"],
    });
    const resource = expectInlineAt(paragraph.children, 1, "resource");

    expect(resource.protocol).toBe("demo-resource:");
    expect(resource.url).toBe("demo-resource://recording/live");
  });

  test("parses registered protocol links with titles as semantic resource nodes", () => {
    const paragraph = parseParagraph(
      'Use [Recording](demo-resource://recording/live "ignored title") now.\n',
      {
        resourceProtocols: ["demo-resource:"],
      },
    );
    const resource = expectInlineAt(paragraph.children, 1, "resource");

    expect(paragraph.children.some((child) => child.type === "link")).toBe(false);
    expect(resource.label).toBe("Recording");
    expect(resource.protocol).toBe("demo-resource:");
    expect(resource.url).toBe("demo-resource://recording/live");
  });

  test("uses the link text projection as the resource label", () => {
    const paragraph = parseParagraph(
      "Use [ **Recording** session ](demo-resource://recording/live) now.\n",
      {
        resourceProtocols: ["demo-resource:"],
      },
    );
    const resource = expectInlineAt(paragraph.children, 1, "resource");

    expect(resource.label).toBe(" Recording session ");
  });

  test("parses playground tutorial resource links as resources", () => {
    const tutorial = fixtureOptions.find((fixture) => fixture.id === "sample");

    if (!tutorial) {
      throw new Error("Expected playground tutorial fixture");
    }

    const document = parseDocument(tutorial.markdown, {
      resourceProtocols: ["demo-note:", "demo-resource:", "playground:"],
    });
    const inlines = document.blocks.flatMap((block) =>
      block.type === "paragraph" || block.type === "heading" ? block.children : [],
    );
    const resourceNodes = inlines.filter(
      (inline): inline is Extract<Inline, { type: "resource" }> =>
        inline.type === "resource" &&
        (inline.protocol === "demo-note:" ||
          inline.protocol === "demo-resource:" ||
          inline.protocol === "playground:"),
    );
    const demoResourceLinks = collectInlineLinks(inlines).filter(
      (link) =>
        link.url.startsWith("demo-resource:") ||
        link.url.startsWith("demo-note:") ||
        link.url.startsWith("playground:"),
    );

    expect(resourceNodes.map((resource) => resource.url)).toEqual([
      "playground:/theme",
      "demo-resource://recording/live",
      "demo-note://note/complete",
    ]);
    expect(resourceNodes.map((resource) => resource.label)).toEqual([
      "theme picker",
      "Recording session",
      "Planning note",
    ]);
    expect(demoResourceLinks).toEqual([]);
  });

  test("does not cache mutable resource protocol arrays across parses", () => {
    const protocols = ["demo-resource:"];
    const source = "Use [Recording](demo-resource://recording/live) now.\n";

    expectInlineAt(
      expectBlockAt(parseDocument(source, { resourceProtocols: protocols }), 0, "paragraph")
        .children,
      1,
      "resource",
    );

    protocols.length = 0;

    expectInlineAt(
      expectBlockAt(parseDocument(source, { resourceProtocols: protocols }), 0, "paragraph")
        .children,
      1,
      "link",
    );
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
});

describe("Line breaks", () => {
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
    const paragraph = parseParagraph(source);

    expect(paragraph.children).toHaveLength(3);
    expectTextAt(paragraph.children, 0, "a");
    expectInlineAt(paragraph.children, 1, "lineBreak");
    expectTextAt(paragraph.children, 2, "b");
  });

  test.each([["<br/>"], ["<br />"], ["<BR>"], ["<Br/>"]])(
    "accepts %s as a self-closing / case-insensitive <br> spelling",
    (spelling) => {
      const paragraph = parseParagraph(`a${spelling}b\n`);

      expect(paragraph.children).toHaveLength(3);
      expectInlineAt(paragraph.children, 1, "lineBreak");
    },
  );

  test("treats a bare intra-paragraph newline as a soft break, not a hard break", () => {
    // A soft break is preserved as a literal `\n` inside the text run; the
    // layout's whitespace handling is what collapses it visually. There must
    // be no `lineBreak` inline produced.
    const paragraph = parseParagraph("a\nb\n");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
  });

  test("does not treat an escaped backslash followed by newline as a hard break", () => {
    // `\\\\\n` in source = two literal backslashes + newline. The first
    // backslash escapes the second, leaving the `\n` as a soft break.
    const paragraph = parseParagraph("a\\\\\nb\n");

    expect(paragraph.children.some((child) => child.type === "lineBreak")).toBe(false);
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
    const paragraph = parseParagraph(`${escaped}foo\n`);
    expect(paragraph.plainText).toBe(`${unescaped}foo`);
  });

  test("preserves a backslash before an unrecognized character as literal `\\X`", () => {
    // CommonMark allows only ASCII punctuation to be escaped. `\a` is not a
    // recognized escape, so both characters survive into the text node.
    const paragraph = parseParagraph("a\\bc\n");
    expect(paragraph.plainText).toBe("a\\bc");
  });

  test("preserves a trailing backslash at end of input as literal `\\`", () => {
    // The reader returns null when `\` has no following character, so the
    // dispatcher's default one-char advance leaves it as text.
    const paragraph = parseParagraph("foo\\\n");
    expect(paragraph.plainText).toBe("foo\\");
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

  test("parses blank-line-separated sibling bullets as one non-compact list", () => {
    const document = parseDocument(`- alpha

- beta
`);
    const list = expectBlockAt(document, 0, "list");

    expect(document.blocks).toHaveLength(1);
    expect(list.compact).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.compact).toBe(true);
    expect(list.items[1]?.compact).toBe(true);
    expect(list.items[0]?.plainText).toBe("alpha");
    expect(list.items[1]?.plainText).toBe("beta");
  });

  test("parses blank-line-separated child blocks as one non-compact list item", () => {
    const document = parseDocument(`- alpha

  beta
`);
    const list = expectBlockAt(document, 0, "list");
    const item = list.items[0];

    if (!item) {
      throw new Error("Expected list item");
    }

    expect(list.compact).toBe(false);
    expect(item.compact).toBe(false);
    expect(item.children).toHaveLength(2);
    expect(item.children[0]?.plainText).toBe("alpha");
    expect(item.children[1]?.plainText).toBe("beta");
  });

  // Indented code is not part of the dialect, so over-indented lines parse as
  // paragraph text instead of ending their container and dropping what follows.
  test.each([
    ["the document root", "a\n\n    b\n\nc\n", ["a", "    b", "c"]],
    ["a blockquote", "> a\n>\n>     b\n>\n> c\n\nd\n", ["a\n    b\nc", "d"]],
    ["a list item", "- a\n\n      b\n\n  c\n\nd\n", ["a\n    b\nc", "d"]],
    ["a task item", "- [ ]     b\n- [x] c\n\nd\n", ["b\nc", "d"]],
  ])("keeps over-indented lines and the content after them in %s", (_, source, plainTexts) => {
    const document = parseDocument(source);
    const markdown = serializeDocument(document);

    expect(document.blocks.map((block) => block.plainText)).toEqual(plainTexts);
    expect(serializeDocument(parseDocument(markdown))).toBe(markdown);
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

  test("lets document construction own parsed comment thread ids", () => {
    const document = parseDocument(commentedParagraphMarkdown({ id: "persisted-comment-id" }));

    expect(document.comments[0]?.id).toMatch(/^commentThread-/);
    expect(document.comments[0]?.id).not.toBe("persisted-comment-id");
  });

  test("keeps generated comment thread ids stable across markdown round trips", () => {
    const first = parseDocument(commentedParagraphMarkdown());
    const second = parseDocument(serializeDocument(first));

    expect(second.comments[0]?.id).toBe(first.comments[0]?.id);
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

function collectInlineLinks(inlines: readonly Inline[]): Extract<Inline, { type: "link" }>[] {
  const links: Extract<Inline, { type: "link" }>[] = [];

  for (const inline of inlines) {
    if (inline.type === "link") {
      links.push(inline);
      links.push(...collectInlineLinks(inline.children));
    }
  }

  return links;
}
