// Asserts on the markdown that `serializeDocument` emits for a given
// `Document`. Compound-fixture round-trips live in `roundtrip.test.ts`.

import { describe, expect, test } from "bun:test";
import { insertLineBreak } from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";
import { expectBlockAt } from "../document/helpers";
import { expectRoundTrip } from "./helpers";

describe("Inline canonicalization", () => {
  test("canonicalizes underscore italic to asterisks", () => {
    const document = parseDocument("_foo_\n");

    expect(serializeDocument(document)).toBe("*foo*\n");
  });

  test("emits underline marks as ins html", () => {
    expectRoundTrip("Paragraph with <ins>underline</ins> text.\n");
  });

  test("preserves unmatched ins html as authored markdown", () => {
    expectRoundTrip("Paragraph with <ins>unfinished underline text.\n");
  });

  test("emits hard line breaks as canonical <br> tags", () => {
    // All three CommonMark hard-break inputs canonicalize to bare `<br>`.
    // We don't append `\n` because that would break table cells (which
    // must stay single-line) and inflate diffs in any context where the
    // surrounding parser doesn't reflow paragraph lines.
    expect(serializeDocument(parseDocument("a<br>b\n"))).toBe("a<br>b\n");
    expect(serializeDocument(parseDocument("a<br>\nb\n"))).toBe("a<br>b\n");
    expect(serializeDocument(parseDocument("a  \nb\n"))).toBe("a<br>b\n");
    expect(serializeDocument(parseDocument("a\\\nb\n"))).toBe("a<br>b\n");
  });

  test("preserves bare intra-paragraph newlines as soft breaks", () => {
    // Soft breaks must not be promoted to `<br>` on serialize — that would
    // change the rendering in every external markdown renderer.
    const serialized = serializeDocument(parseDocument("a\nb\n"));

    expect(serialized).not.toContain("<br>");
  });

  test("defensively escapes intra-word underscores so the next parse stays plain text", () => {
    // Stabilizes after one round trip: the serializer escapes literal
    // underscores to `\_`; reparsing strips the backslashes; the second
    // serialize emits the escaped form again. Locks down that the escape
    // doesn't run away across repeated round trips.
    const serialized = serializeDocument(parseDocument("snake_case_identifier\n"));

    expect(serialized).toBe("snake\\_case\\_identifier\n");
    expect(serializeDocument(parseDocument(serialized))).toBe(serialized);
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

  test("preserves empty task list markers produced by an editor split", () => {
    // Constructed via the editor's line-break path to verify the serializer
    // preserves empty checkbox items that didn't come from parsed source.
    // This is the only test in the markdown subsystem that crosses into the
    // editor; it exists because the editor can produce Document shapes the
    // parser never would, and the serializer needs to handle them too.
    const editorState = createEditorState(parseDocument("- [ ] alpha\n"));
    const container = editorState.documentIndex.regions.find((entry) => entry.text === "alpha");

    if (!container) {
      throw new Error("Expected task container");
    }

    const splitState = insertLineBreak(
      setSelection(editorState, {
        regionId: container.id,
        offset: container.text.length,
      }),
    );

    if (!splitState) {
      throw new Error("Expected structural split to succeed");
    }

    const document = createDocumentFromEditorState(splitState);

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
