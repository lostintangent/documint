// Asserts on the markdown that `serializeDocument` emits for a given
// `Document`. Compound-fixture round-trips live in `roundtrip.test.ts`.

import { describe, expect, test } from "bun:test";
import {
  createDocument,
  createListBlock,
  createListItemBlock,
  createParagraphBlock,
  createResource,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
} from "@/document";
import { parseDocument, serializeDocument } from "@/markdown";
import { expectBlockAt } from "../document/helpers";
import { expectRoundTrip, expectStableRoundTrip } from "./helpers";

describe("Inline marks", () => {
  test("canonicalizes underscore italic to asterisks", () => {
    expect(serializeDocument(parseDocument("_foo_\n"))).toBe("*foo*\n");
  });

  test("emits underline marks as ins html", () => {
    expectRoundTrip("Paragraph with <ins>underline</ins> text.\n");
  });

  test("canonicalizes u underline html to ins", () => {
    expect(serializeDocument(parseDocument("Paragraph with <u>underline</u> text.\n"))).toBe(
      "Paragraph with <ins>underline</ins> text.\n",
    );
  });

  test("emits superscript marks as sup html", () => {
    expectRoundTrip("Area x<sup>2</sup>\n");
  });

  test("emits nested marks in canonical semantic mark order", () => {
    const document = createDocument([
      createParagraphBlock([createText("marked", ["superscript", "underline", "bold"])]),
    ]);

    expect(serializeDocument(document)).toBe("<sup><ins>**marked**</ins></sup>\n");
  });

  test("emits inline code as the innermost composable mark", () => {
    const document = createDocument([
      createParagraphBlock([
        createText("code", ["italic", "code"]),
        createText(" and "),
        createText("underlined", ["underline", "code"]),
      ]),
    ]);

    expect(serializeDocument(document)).toBe("*`code`* and <ins>`underlined`</ins>\n");
  });

  test("defensively escapes intra-word underscores so the next parse stays plain text", () => {
    // The serializer escapes literal underscores to `\_`; reparsing strips
    // the backslashes; the second serialize emits the escaped form again.
    // Locks down that the escape doesn't run away across round trips.
    expect(serializeDocument(parseDocument("snake_case_identifier\n"))).toBe(
      "snake\\_case\\_identifier\n",
    );
    expectStableRoundTrip("snake\\_case\\_identifier\n");
  });

  test("preserves unmatched ins html as authored markdown", () => {
    expectRoundTrip("Paragraph with <ins>unfinished underline text.\n");
  });
});

describe("Line breaks", () => {
  // All four hard-break input forms canonicalize to a bare `<br>`. Omitting
  // a trailing `\n` keeps table cells single-line and avoids inflating
  // diffs in any renderer that doesn't reflow paragraph lines.
  test.each([
    ["bare <br>", "a<br>b\n"],
    ["<br>\\n (parser absorbs trailing newline)", "a<br>\nb\n"],
    ["two-or-more trailing spaces", "a  \nb\n"],
    ["backslash-newline", "a\\\nb\n"],
  ])("emits %s as canonical <br>", (_label, source) => {
    expect(serializeDocument(parseDocument(source))).toBe("a<br>b\n");
  });

  test("preserves bare intra-paragraph newlines as soft breaks", () => {
    // Soft breaks must not be promoted to `<br>` on serialize — that would
    // change the rendering in every external markdown renderer.
    expect(serializeDocument(parseDocument("a\nb\n"))).not.toContain("<br>");
  });
});

describe("Inline references", () => {
  test("preserves user mention identity through markdown export", () => {
    expectRoundTrip("Hello @[Jane Doe](user-123).\n");
  });

  test("emits resource inlines as markdown links", () => {
    const document = createDocument([
      createParagraphBlock([
        createText("Use "),
        createResource({
          label: "Recording",
          protocol: "demo-resource:",
          url: "demo-resource://recording/live",
        }),
        createText(" now."),
      ]),
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
});

describe("Lists", () => {
  test("normalizes authored ordered list starts to the canonical first marker by default", () => {
    const document = parseDocument("3. alpha\n3. beta\n");
    const list = expectBlockAt(document, 0, "list");

    expect(list.start).toBeNull();
    expect(serializeDocument(document)).toBe("1. alpha\n1. beta\n");
  });

  test("preserves authored ordered list starts when requested", () => {
    const source = "3. alpha\n3. beta\n";
    const document = parseDocument(source, { preserveOrderedListStart: true });
    const list = expectBlockAt(document, 0, "list");

    expect(list.start).toBe(3);
    expectRoundTrip(source, { preserveOrderedListStart: true });
  });

  test("preserves empty task list markers", () => {
    // A task list whose second item has no content is a shape the parser
    // would never produce on its own (an empty `- [ ]` line is normalized
    // through the list parser into an empty-paragraph child), but the
    // editor's structural-split path can — pressing Enter at the end of a
    // task item creates exactly this Document. The serializer must keep
    // both checkbox markers intact.
    const document = createDocument([
      createListBlock({
        items: [
          createListItemBlock({
            checked: false,
            children: [createParagraphBlock([createText("alpha")])],
          }),
          createListItemBlock({
            checked: false,
            children: [createParagraphBlock([])],
          }),
        ],
        ordered: false,
      }),
    ]);

    expect(serializeDocument(document)).toBe("- [ ] alpha\n- [ ] \n");
  });
});

describe("Images", () => {
  test("preserves authored image widths through markdown export", () => {
    const source = '![Preview](https://example.com/preview.png "Host fit"){width=320}\n';
    const document = parseDocument(source);
    const paragraph = expectBlockAt(document, 0, "paragraph");
    const image = paragraph.children[0];

    if (!image || image.type !== "image") {
      throw new Error("Expected image node");
    }

    expect(image.width).toBe(320);
    expectRoundTrip(source);
  });

  test("preserves invalid image-width syntax as plain markdown text", () => {
    expectRoundTrip("![Preview](https://example.com/preview.png){width=0}\n");
  });
});

describe("Tables", () => {
  test("emits compact table cells by default", () => {
    expectRoundTrip(`| Block | Status | Width | Notes |
| :---- | :----- | ----: | :---- |
| Heading | stable | 640 | stays semantic |
| Comments | anchored | 3 | remain durable |
`);
  });

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

  test("escapes semantic table cell pipes", () => {
    const document = createTableDocument([["Query"], ["alpha | beta"]]);

    expect(serializeDocument(document)).toBe(`| Query |
| ----- |
| alpha \\| beta |
`);
  });
});

describe("Comments", () => {
  test("omits runtime comment thread ids from markdown output", () => {
    const document = parseDocument(`Paragraph with a comment.

:::documint-comments
[
  {
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
    expect(serializeDocument(document)).not.toContain('"id"');
  });
});

describe("Front matter", () => {
  test("emits front matter cleanly when the document has no body blocks", () => {
    expectRoundTrip("---\ntitle: Stub\n---\n");
  });
});

describe("Unsupported preservation", () => {
  test("preserves unsupported semantic nodes during markdown export", async () => {
    const source = await Bun.file("test/goldens/unsupported-html.md").text();

    expectRoundTrip(source);
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
    ["bullet marker (-)", "\\- not a list\n"],
    ["bullet marker (*)", "\\* not a list\n"],
    ["bullet marker (+)", "\\+ not a list\n"],
    ["ordered list marker", "1\\. not a list\n"],
    ["container directive", "\\:::callout\n"],
    ["fenced code marker", "\\`\\`\\`not code\n"],
    ["thematic break", "\\*\\*\\*\n"],
    ["table row", "\\| not | a table |\n"],
  ])("round-trips a paragraph that would otherwise reparse as %s", (_label, canonical) => {
    expectRoundTrip(canonical);
  });

  test("leaves intra-line block-start characters alone", () => {
    // The escapes are line-start only; embedded `>`, `#`, etc. stay plain.
    expectRoundTrip("Text with > inside and 1. mid-line markers.\n");
  });

  test("does not escape bold delimiters as bullet markers", () => {
    // `**bold**` shares its lead character with bullet `*` but has no
    // following space, so the parser would never read it as a list.
    expectRoundTrip("**bold** at line start.\n");
  });
});

function createTableDocument(rows: string[][]) {
  return createDocument([
    createTableBlock({
      align: rows[0]?.map(() => null) ?? [],
      rows: rows.map((row) =>
        createTableRow(row.map((cell) => createTableCell([createText(cell)]))),
      ),
    }),
  ]);
}
