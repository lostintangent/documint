// Asserts on the markdown that `serializeDocument` emits for a given
// `Document`. Compound-fixture round-trips live in `roundtrip.test.ts`.

import { describe, expect, test } from "bun:test";
import {
  createCommentThread,
  createDocument,
  createLink,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createResource,
  createText,
  type Inline,
  type MetadataValue,
} from "@/document";
import { parseDocument, serializeDocument, serializeMetadataPreamble } from "@/markdown";
import { serializeCommentAppendix } from "@/markdown/serializer";
import { expectBlockAt, expectInlineAt } from "../document/helpers";
import { commentedParagraphMarkdown, expectRoundTrip, expectStableRoundTrip } from "./helpers";

describe("Inline marks", () => {
  test.each([
    ["underscore italic", "_foo_\n", "*foo*\n"],
    ["u underline html", "A <u>b</u> c.\n", "A <ins>b</ins> c.\n"],
  ])("canonicalizes %s", (_label, source, canonical) => {
    expect(serializeDocument(parseDocument(source))).toBe(canonical);
  });

  test("emits nested marks in canonical semantic mark order", () => {
    const document = createParagraphDocument([
      createText("marked", ["superscript", "underline", "bold"]),
    ]);

    expect(serializeDocument(document)).toBe("<sup><ins>**marked**</ins></sup>\n");
  });

  test("emits inline code as the innermost composable mark", () => {
    const document = createParagraphDocument([
      createText("code", ["italic", "code"]),
      createText(" and "),
      createText("underlined", ["underline", "code"]),
    ]);

    expect(serializeDocument(document)).toBe("*`code`* and <ins>`underlined`</ins>\n");
  });

  test.each([
    [
      "underscores only where they could open or close emphasis",
      "snake_case 1_000 :white_check_mark: \\_\\_init\\_\\_ a\\_ *a*\\_b\n",
    ],
    ["a literal tilde run", "\\~\\~not struck\\~\\~, ~5ms, ~~~\n"],
    ["a brace only where it would open directive attributes", ":a\\{b} ::tip\\{x} a{b} :1{b}\n"],
    ["nothing in unmatched ins html", "Paragraph with <ins>unfinished underline text.\n"],
  ])("escapes %s", (_label, source) => {
    expectRoundTrip(source);
  });

  test.each([
    [
      "*see `code` here*",
      [
        createText("see ", ["italic"]),
        createText("code", ["code", "italic"]),
        createText(" here", ["italic"]),
      ],
    ],
    [
      "**see [docs](https://x.dev) here**",
      [
        createText("see ", ["bold"]),
        createLink({ children: [createText("docs", ["bold"])], url: "https://x.dev" }),
        createText(" here", ["bold"]),
      ],
    ],
    [
      "**x [a*b*](https://x.dev) y**",
      [
        createText("x ", ["bold"]),
        createLink({
          children: [createText("a", ["bold"]), createText("b", ["bold", "italic"])],
          url: "https://x.dev",
        }),
        createText(" y", ["bold"]),
      ],
    ],
    [
      "[**do**cs](https://x.dev)",
      [
        createLink({
          children: [createText("do", ["bold"]), createText("cs")],
          url: "https://x.dev",
        }),
      ],
    ],
    // The longer-running mark opens outside.
    ["***a*b**", [createText("a", ["bold", "italic"]), createText("b", ["bold"])]],
    // The rule of 3 keeps the inner `*` from closing the `**`.
    ["**a*b***", [createText("a", ["bold"]), createText("b", ["bold", "italic"])]],
    // `*` can't open after a letter and before punctuation.
    ['a<strong>"b"</strong>', [createText("a"), createText('"b"', ["bold"])]],
    // `**` can't close after punctuation and before a letter.
    ["<strong>「加粗」</strong>中文", [createText("「加粗」", ["bold"]), createText("中文")]],
    // The `*` before `z` would close the italic that `***` opened.
    [
      "***x*y<em>z</em>**",
      [
        createText("x", ["bold", "italic"]),
        createText("y", ["bold"]),
        createText("z", ["bold", "italic"]),
      ],
    ],
    // A `****` that closes and reopens trips the rule of 3.
    [
      "**a*b***<em>c</em>",
      [createText("a", ["bold"]), createText("b", ["bold", "italic"]), createText("c", ["italic"])],
    ],
    // A colon before a word starts a directive only with a label or attributes.
    ["*Note:Use* :heart:", [createText("Note:Use", ["italic"]), createText(" :heart:")]],
  ] as const)("writes %s and reads back the same marks", (markdown, children) => {
    const document = createParagraphDocument([...children]);

    expect(serializeDocument(document)).toBe(`${markdown}\n`);
    expect(expectBlockAt(parseDocument(`${markdown}\n`), 0, "paragraph").children).toEqual([
      ...children,
    ]);
  });

  test("moves whitespace at the edge of bold text outside the delimiters", () => {
    const document = createParagraphDocument([
      createText("a"),
      createText(" b ", ["bold"]),
      createText("c"),
    ]);

    expect(serializeDocument(document)).toBe("a **b** c\n");
  });
});

describe("Inline references", () => {
  test("preserves user mention identity through markdown export", () => {
    expectRoundTrip("Hello @[Jane Doe](user-123).\n");
  });

  test("emits resource inlines as markdown links", () => {
    const document = createParagraphDocument([
      createText("Use "),
      createResource({
        label: "Recording",
        protocol: "demo-resource:",
        url: "demo-resource://recording/live",
      }),
      createText(" now."),
    ]);

    expect(serializeDocument(document)).toBe(
      "Use [Recording](demo-resource://recording/live) now.\n",
    );
  });

  test("defensively escapes plain text that looks like a user mention", () => {
    // `\@[label](dest)` must survive a round trip as itself — otherwise
    // the reparse would promote the escaped text to a real mention.
    expectStableRoundTrip("Literal \\@[Jane Doe](user-123).\n");
  });

  test.each([
    ["`!` before a link", "Wow!", "link", "Wow\\![docs](u)\n"],
    ["`!` before a resource", "Wow!", "resource", "Wow\\![docs](demo-resource://x)\n"],
    ["`@` before a resource", "ask @", "resource", "ask \\@[docs](demo-resource://x)\n"],
  ] as const)(
    "escapes %s so it doesn't reparse as an image or mention",
    (_label, text, kind, markdown) => {
      const options = { resourceProtocols: ["demo-resource:"] };
      const reference =
        kind === "link"
          ? createLink({ children: [createText("docs")], url: "u" })
          : createResource({ label: "docs", protocol: "demo-resource:", url: "demo-resource://x" });
      const document = createParagraphDocument([createText(text), reference]);
      const reparsed = expectBlockAt(parseDocument(markdown, options), 0, "paragraph");

      expect(serializeDocument(document, options)).toBe(markdown);
      expect(reparsed.children.map((child) => child.type)).toEqual(["text", kind]);
    },
  );

  test.each([
    ["an unbalanced `[`", "[a \\[b](u)\n"],
    ["an unbalanced `]`", "[a \\]b](u)\n"],
    ["a bracket inside a code span", "[`]` and `[`](u)\n"],
  ])("keeps link text with %s a link through a save", (_label, markdown) => {
    const paragraph = expectBlockAt(parseDocument(markdown), 0, "paragraph");

    expect(paragraph.children.map((child) => child.type)).toEqual(["link"]);
    expectStableRoundTrip(markdown);
  });
});

describe("Link destinations", () => {
  test.each<[string, string, string, (string | null)?]>([
    ["an unbalanced closing parenthesis", "https://x.dev/a)b", "https://x.dev/a\\)b"],
    ["an unbalanced opening parenthesis", "https://x.dev/a(b", "https://x.dev/a\\(b"],
    ["a space", "my file.md", "<my file.md>"],
    ["no url", "", ""],
    ["no url before a title", "", '<> "t"', "t"],
    ["angle brackets", "<u>", "\\<u\\>"],
  ])("emits %s", (_, url, destination, title = null) => {
    const markdown = serializeDocument(
      createParagraphDocument([createLink({ children: [createText("x")], title, url })]),
    );

    expect(markdown).toBe(`[x](${destination})\n`);
    expect(expectBlockAt(parseDocument(markdown), 0, "paragraph").children[0]).toMatchObject({
      title,
      url,
    });
  });
});

describe("Lists", () => {
  test("keeps an authored start and numbering through a save", () => {
    expectRoundTrip("9. alpha\n10. beta\n    - gamma\n");
  });

  test("preserves empty task list markers", () => {
    // Pressing Enter at the end of a task item builds this shape.
    const document = createDocument([
      createListBlock({
        items: [
          createListItemBlock({
            checked: false,
            children: [createParagraphBlock([createText("alpha")])],
          }),
          createListItemBlock({ checked: false, children: [createParagraphBlock([])] }),
        ],
        ordered: false,
      }),
    ]);

    expect(serializeDocument(document)).toBe("- [ ] alpha\n- [ ] \n");
  });

  test.each([
    ["a later paragraph", "- one\n\n  two\n  three\n"],
    ["a nested item", "- one\n  - two\n    three\n"],
    ["an ordered item", "1. one\n   two\n"],
    ["a task item", "- [x] one\n  two\n"],
    ["a quoted item", "> - one\n>   two\n"],
  ])("keeps the item indent on every wrapped line of %s", (_, source) => {
    expectStableRoundTrip(source);
  });
});

describe("Images", () => {
  test("preserves authored image widths through markdown export", () => {
    const source = '![Preview](https://example.com/preview.png "Host fit"){width=320}\n';
    const paragraph = expectBlockAt(parseDocument(source), 0, "paragraph");

    expect(expectInlineAt(paragraph.children, 0, "image").width).toBe(320);
    expectRoundTrip(source);
  });

  test("preserves invalid image-width syntax as plain markdown text", () => {
    expectRoundTrip("![Preview](https://example.com/preview.png){width=0}\n");
  });
});

describe("Tables", () => {
  test("pads table cells to the widest column when requested", () => {
    expectRoundTrip(
      `| Block    | Status   | Width | Notes          |
| :------- | :------- | ----: | :------------- |
| Heading  | stable   |   640 | stays semantic |
| Comments | anchored |     3 | remain durable |
`,
      { padTableColumns: true },
    );
  });

  test("preserves escaped pipes inside table cells", () => {
    const source = `| Query |
| ----- |
| alpha \\| beta |
`;

    const table = expectBlockAt(parseDocument(source), 0, "table");
    const cell = table.rows[1]?.cells[0];

    expect(cell?.plainText).toBe("alpha | beta");
    expectStableRoundTrip(source);
  });
});

describe("Comments", () => {
  test("serializes the trailing comment appendix without a document newline", () => {
    const document = parseDocument(commentedParagraphMarkdown());

    expect(serializeCommentAppendix(document.comments)).toBe(`:::documint-comments
[
  {
    "quote": " with ",
    "anchor": {
      "prefix": "Paragraph",
      "suffix": " with a comment."
    },
    "comments": [
      {
        "body": "Reviewing this.",
        "updatedAt": "2026-04-05T12:00:00.000Z"
      }
    ]
  }
]
:::`);
  });

  test("saves a new thread the same way after a reload", () => {
    const thread = createCommentThread({
      anchor: { prefix: "A ", suffix: " line." },
      body: "Reviewing this.",
      createdAt: "2026-04-05T12:00:00.000Z",
      quote: "commented",
    });
    const markdown = serializeDocument(
      createDocument([createParagraphBlock([createText("A commented line.")])], [thread]),
    );

    expect(serializeDocument(parseDocument(markdown))).toBe(markdown);
  });
});

describe("Document metadata", () => {
  test("serializes absent, structured, and raw metadata preambles independently", () => {
    const structured = new Map<string, MetadataValue>([
      ["title", "Sample"],
      ["release channel", "stable"],
      ["draft", false],
      ["tags", "docs, sample"],
    ]);

    expect(serializeMetadataPreamble(null)).toBe("");
    expect(serializeMetadataPreamble(structured)).toBe(`---
title: "Sample"
"release channel": "stable"
draft: false
tags: "docs, sample"
---`);
    expect(
      serializeMetadataPreamble({
        raw: "title: First\ntitle: Second",
      }),
    ).toBe(`---
title: First
title: Second
---`);
  });

  test.each([
    "|",
    "> quote",
    "# comment",
    "a: b",
    " leading",
    "trailing ",
    "a # comment",
    "- item",
    "true",
    "false",
    "\n",
    "\n\n",
    " indented\nlines",
  ])("keeps edited string value %p structured across serialization", (value) => {
    const metadata = new Map<string, MetadataValue>([["title", value]]);
    const markdown = serializeDocument(createDocument([], [], metadata));

    expect(parseDocument(markdown).metadata).toEqual(metadata);
  });
});

describe("Paragraph block-start escapes", () => {
  // A paragraph whose first child text begins with a block-trigger sequence
  // must escape that sequence on emit, otherwise the next parse would
  // promote the line to a different block kind. The canonical form below is
  // the escaped output; round-tripping it confirms both that the serializer
  // applied the escape and that the parser's unescape covers each trigger.
  test.each([
    ["blockquote marker", "\\> not a quote\n"],
    ["ATX heading", "\\# not a heading\n"],
    ["bare ATX marker", "\\##\n"],
    ["bullet marker (-)", "\\- not a list\n"],
    ["bullet marker (*)", "\\* not a list\n"],
    ["bullet marker (+)", "\\+ not a list\n"],
    ["ordered list marker", "1\\. not a list\n"],
    ["container directive", "\\:::callout\n"],
    ["fenced code marker", "\\`\\`\\`not code\n"],
    ["fenced code, for code spans at line start", "``` `` ```\n```` ``` ````\n"],
    ["thematic break", "\\*\\*\\*\n"],
    ["table row", "\\| not | a table |\n"],
    ["setext underline (=)", "Title\n\\===\n"],
    ["setext underline (-)", "Title\n\\--\n"],
    ["HTML", "\\<div> and Array\\<string>\n"],
  ])("round-trips a paragraph that would otherwise reparse as %s", (_label, canonical) => {
    expectRoundTrip(canonical);
  });

  test.each([
    ["intra-line block-start characters", "Text with > inside and 1. mid-line markers.\n"],
    ["bold delimiters at line start", "**bold** at line start.\n"],
  ])("leaves %s unescaped", (_label, canonical) => {
    expectRoundTrip(canonical);
  });

  test.each([
    ["ordinary text", "&#x20;leading\n"],
    ["a block marker, which needs no backslash", "&#x20;1. not a list\n"],
  ])("round-trips a paragraph line with leading space before %s", (_label, canonical) => {
    expectRoundTrip(canonical);
  });
});

function createParagraphDocument(children: Inline[]) {
  return createDocument([createParagraphBlock(children)]);
}
