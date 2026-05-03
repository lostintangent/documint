// Inline command coverage: mark toggles, soft line breaks, and images.

import { describe, expect, test } from "bun:test";
import {
  deleteBackward,
  deleteForward,
  insertImage,
  insertSoftLineBreak,
  resizeImage,
  toggleBold,
  toggleCode,
  toggleItalic,
  toggleStrikethrough,
  toggleUnderline,
} from "@/editor/state";
import { getRegion, placeAt, selectSubstring, setup, toMarkdown } from "../../helpers";

describe("Inline mark toggles", () => {
  test("toggles strong and emphasis marks on a single-container selection", () => {
    const base = setup("Plain text here.\n");
    const region = getRegion(base, "Plain text here.");
    let state = selectSubstring(base, region, "text");
    state = toggleBold(state) ?? state;

    expect(toMarkdown(state)).toBe("Plain **text** here.\n");

    state = toggleBold(state) ?? state;

    expect(toMarkdown(state)).toBe("Plain text here.\n");

    state = toggleItalic(state) ?? state;

    expect(toMarkdown(state)).toBe("Plain *text* here.\n");
  });

  test("routes mod-b and mod-i through inline mark toggles", () => {
    const base = setup("Paragraph body.\n");
    const region = getRegion(base, "Paragraph body.");
    let state = selectSubstring(base, region, "Paragraph");
    state = toggleBold(state) ?? state;

    expect(toMarkdown(state)).toBe("**Paragraph** body.\n");

    state = toggleItalic(state) ?? state;

    expect(toMarkdown(state)).toBe("***Paragraph*** body.\n");
  });

  test("toggles strikethrough on and off", () => {
    const base = setup("Hello world\n");
    const region = getRegion(base, "Hello world");
    const selected = selectSubstring(base, region, "world");
    const on = toggleStrikethrough(selected) ?? selected;

    expect(toMarkdown(on)).toBe("Hello ~~world~~\n");

    const off = toggleStrikethrough(on) ?? on;

    expect(toMarkdown(off)).toBe("Hello world\n");
  });

  test("routes mod-u through inline underline toggles", () => {
    const base = setup("Paragraph body.\n");
    const region = getRegion(base, "Paragraph body.");
    const state = toggleUnderline(selectSubstring(base, region, "body"));

    expect(toMarkdown(state ?? base)).toBe("Paragraph <ins>body</ins>.\n");
  });

  test("toggles inline code on and off for a single-container selection", () => {
    const base = setup("Paragraph body.\n");
    const region = getRegion(base, "Paragraph body.");
    let state = selectSubstring(base, region, "body");
    state = toggleCode(state) ?? state;

    expect(toMarkdown(state)).toBe("Paragraph `body`.\n");

    state = toggleCode(state) ?? state;

    expect(toMarkdown(state)).toBe("Paragraph body.\n");
  });

  test("routes mod-e through inline code toggles", () => {
    const base = setup("Call fn here.\n");
    const region = getRegion(base, "Call fn here.");
    const state = toggleCode(selectSubstring(base, region, "fn"));

    expect(toMarkdown(state ?? base)).toBe("Call `fn` here.\n");
  });
});

describe("Soft line breaks", () => {
  // Insertion path: every inline-bearing block routes through
  // `insertInlineNode` and produces a `replace-block` action that splices
  // a `LineBreak` into the host's inline tree. Code blocks are the one
  // exception — their content is source text, so the command falls back
  // to a `splice-text` action with a literal `\n`.
  //
  // Block kinds are covered in roughly the order users encounter them:
  // paragraph and heading are the everyday containers; list-item and
  // blockquote test the descendant-paragraph resolution path; table-cell
  // exercises the table rebuild path; code block is the fallback.

  test("inserts a soft line break inside a paragraph", () => {
    const base = setup("foobar\n");
    const region = getRegion(base, "foobar");
    const placed = placeAt(base, region, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("foo<br>bar\n");
  });

  test("inserts a soft line break inside a heading", () => {
    const base = setup("# foobar\n");
    const region = getRegion(base, "foobar");
    const placed = placeAt(base, region, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("# foo<br>bar\n");
  });

  test("inserts a soft line break inside a list item paragraph", () => {
    const base = setup("- foobar\n");
    // The cursor in a list item lives inside the item's descendant
    // paragraph, so `insertInlineNode` resolves to that paragraph's inline
    // tree.
    const region = getRegion(base, "foobar");
    const placed = placeAt(base, region, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("- foo<br>bar\n");
  });

  test("inserts a soft line break inside a blockquote paragraph", () => {
    const base = setup("> foobar\n");
    const region = getRegion(base, "foobar");
    const placed = placeAt(base, region, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("> foo<br>bar\n");
  });

  test("inserts a soft line break inside a table cell", () => {
    const base = setup("| h1 | h2 |\n| -- | -- |\n| foobar | other |\n");
    const region = getRegion(base, "foobar");
    const placed = placeAt(base, region, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toContain("foo<br>bar");
  });

  test("inserts a soft line break inside a code block as a literal newline", () => {
    // Code block content is source text, not an inline tree, so the
    // command falls back to a `splice-text` action with a `\n`. The
    // serialized output keeps the newline inside the fenced block.
    const base = setup("```\nfoobar\n```\n");
    const region = getRegion(base, "foobar");
    const placed = placeAt(base, region, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("```\nfoo\nbar\n```\n");
  });

  test("backspace immediately after a soft break removes the line break", () => {
    // Caret at offset 4 sits at the start of "bar" — i.e. one position
    // past the `\n` contributed by the `lineBreak` run. Backspace must
    // delete that single inline node and rejoin the surrounding text.
    const base = setup("foo<br>bar\n");
    const region = getRegion(base, "foo\nbar");
    const placed = placeAt(base, region, 4);
    const next = deleteBackward(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("foobar\n");
  });

  test("forward delete from immediately before a soft break removes the line break", () => {
    // Caret at offset 3 sits at the end of "foo", immediately before the
    // `\n`. Forward delete must remove the `lineBreak` inline.
    const base = setup("foo<br>bar\n");
    const region = getRegion(base, "foo\nbar");
    const placed = placeAt(base, region, 3);
    const next = deleteForward(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("foobar\n");
  });
});

describe("Images", () => {
  test("inserts an image inline at the current caret position", () => {
    const base = setup("caption\n");
    const region = getRegion(base, "caption");
    const placed = placeAt(base, region, "end");
    const next = insertImage(placed, "https://example.com/img.png", "alt text");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toContain("![alt text](https://example.com/img.png)");
  });

  test("resizes an image by replacing it with a new width attribute", () => {
    const state = setup("before ![alt](https://example.com/img.png) after\n");
    const region = getRegion(state, "before ￼ after");
    const imageRun = region.inlines.find((r) => r.kind === "image");

    if (!imageRun?.image) {
      throw new Error("Expected image run");
    }

    const next = resizeImage(
      state,
      region.id,
      { start: imageRun.start, end: imageRun.end, image: imageRun.image },
      320,
    );

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toContain("![alt](https://example.com/img.png)");
  });
});
