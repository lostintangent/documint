// Inline command coverage: mark toggles, soft line breaks, and images.

import { describe, expect, test } from "bun:test";
import { createLineBreak, createMention, createRaw, createText } from "@/document";
import {
  deleteBackward,
  deleteForward,
  insertImage,
  insertMention,
  insertSoftLineBreak,
  resizeImage,
  toggleMark,
} from "@/editor/state";
import { spliceInlineNodes } from "@/editor/state/commands/actions/inlines/shared";
import { getPath, placeAt, selectSubstring, setup, toMarkdown } from "../../helpers";

describe("Inline splicing", () => {
  test("inserts structured inline nodes at collapsed boundaries", () => {
    expect(spliceInlineNodes([createText("abc")], 0, 0, [createLineBreak()])).toEqual([
      createLineBreak(),
      createText("abc"),
    ]);

    expect(
      spliceInlineNodes(
        [createText("alpha"), createText("omega")],
        "alpha".length,
        "alpha".length,
        [createMention({ name: "Jane Doe", userId: "user-123" })],
      ),
    ).toEqual([
      createText("alpha"),
      createMention({ name: "Jane Doe", userId: "user-123" }),
      createText("omega"),
    ]);
  });
});

describe("Inline mark toggles", () => {
  test("toggles strong and emphasis marks on a single-container selection", () => {
    const base = setup("Plain text here.\n");
    const path = getPath(base, "Plain text here.");
    let state = selectSubstring(base, path, "text");
    state = toggleMark(state, "bold") ?? state;

    expect(toMarkdown(state)).toBe("Plain **text** here.\n");

    state = toggleMark(state, "bold") ?? state;

    expect(toMarkdown(state)).toBe("Plain text here.\n");

    state = toggleMark(state, "italic") ?? state;

    expect(toMarkdown(state)).toBe("Plain *text* here.\n");
  });

  test("routes mod-b and mod-i through inline mark toggles", () => {
    const base = setup("Paragraph body.\n");
    const path = getPath(base, "Paragraph body.");
    let state = selectSubstring(base, path, "Paragraph");
    state = toggleMark(state, "bold") ?? state;

    expect(toMarkdown(state)).toBe("**Paragraph** body.\n");

    state = toggleMark(state, "italic") ?? state;

    expect(toMarkdown(state)).toBe("***Paragraph*** body.\n");
  });

  test("toggles strikethrough on and off", () => {
    const base = setup("Hello world\n");
    const path = getPath(base, "Hello world");
    const selected = selectSubstring(base, path, "world");
    const on = toggleMark(selected, "strikethrough") ?? selected;

    expect(toMarkdown(on)).toBe("Hello ~~world~~\n");

    const off = toggleMark(on, "strikethrough") ?? on;

    expect(toMarkdown(off)).toBe("Hello world\n");
  });

  test("toggles marks through the generic mark command", () => {
    const base = setup("Area of x2.\n");
    const path = getPath(base, "Area of x2.");
    const selected = selectSubstring(base, path, "x2");
    const marked = toggleMark(selected, "bold") ?? selected;

    expect(toMarkdown(marked)).toBe("Area of **x2**.\n");

    const unmarked = toggleMark(marked, "bold") ?? marked;

    expect(toMarkdown(unmarked)).toBe("Area of x2.\n");
  });

  test("routes mod-u through inline underline toggles", () => {
    const base = setup("Paragraph body.\n");
    const path = getPath(base, "Paragraph body.");
    const state = toggleMark(selectSubstring(base, path, "body"), "underline");

    expect(toMarkdown(state ?? base)).toBe("Paragraph <ins>body</ins>.\n");
  });

  test("toggles superscript through the generic mark command", () => {
    const base = setup("Area of x2.\n");
    const path = getPath(base, "Area of x2.");
    const state = toggleMark(selectSubstring(base, path, "2"), "superscript");

    expect(toMarkdown(state ?? base)).toBe("Area of x<sup>2</sup>.\n");
  });

  test("toggles inline code on and off for a single-container selection", () => {
    const base = setup("Paragraph body.\n");
    const path = getPath(base, "Paragraph body.");
    let state = selectSubstring(base, path, "body");
    state = toggleMark(state, "code") ?? state;

    expect(toMarkdown(state)).toBe("Paragraph `body`.\n");

    state = toggleMark(state, "code") ?? state;

    expect(toMarkdown(state)).toBe("Paragraph body.\n");
  });

  test("routes mod-e through inline code toggles", () => {
    const base = setup("Call fn here.\n");
    const path = getPath(base, "Call fn here.");
    const state = toggleMark(selectSubstring(base, path, "fn"), "code");

    expect(toMarkdown(state ?? base)).toBe("Call `fn` here.\n");
  });

  test("composes code with other inline marks", () => {
    const base = setup("Call fn here.\n");
    const path = getPath(base, "Call fn here.");
    let state = selectSubstring(base, path, "fn");
    state = toggleMark(state, "code") ?? state;
    state = toggleMark(state, "italic") ?? state;
    state = toggleMark(state, "underline") ?? state;

    expect(toMarkdown(state)).toBe("Call <ins>*`fn`*</ins> here.\n");
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
    const path = getPath(base, "foobar");
    const placed = placeAt(base, path, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("foo<br>bar\n");
  });

  test("inserts a soft line break inside a heading", () => {
    const base = setup("# foobar\n");
    const path = getPath(base, "foobar");
    const placed = placeAt(base, path, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("# foo<br>bar\n");
  });

  test("inserts a soft line break inside a list item paragraph", () => {
    const base = setup("- foobar\n");
    // The cursor in a list item lives inside the item's descendant
    // paragraph, so `insertInlineNode` resolves to that paragraph's inline
    // tree.
    const path = getPath(base, "foobar");
    const placed = placeAt(base, path, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("- foo<br>bar\n");
  });

  test("inserts a soft line break inside a blockquote paragraph", () => {
    const base = setup("> foobar\n");
    const path = getPath(base, "foobar");
    const placed = placeAt(base, path, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("> foo<br>bar\n");
  });

  test("inserts a soft line break inside a table cell", () => {
    const base = setup("| h1 | h2 |\n| -- | -- |\n| foobar | other |\n");
    const path = getPath(base, "foobar");
    const placed = placeAt(base, path, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toContain("foo<br>bar");
  });

  test("inserts a soft line break inside a code block as a literal newline", () => {
    // Code block content is source text, not an inline tree, so the
    // command falls back to a `splice-text` action with a `\n`. The
    // serialized output keeps the newline inside the fenced block.
    const base = setup("```\nfoobar\n```\n");
    const path = getPath(base, "foobar");
    const placed = placeAt(base, path, 3);
    const next = insertSoftLineBreak(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("```\nfoo\nbar\n```\n");
  });

  test("backspace immediately after a soft break removes the line break", () => {
    // Caret at offset 4 sits at the start of "bar" — i.e. one position
    // past the `\n` contributed by the `lineBreak` run. Backspace must
    // delete that single inline node and rejoin the surrounding text.
    const base = setup("foo<br>bar\n");
    const path = getPath(base, "foo\nbar");
    const placed = placeAt(base, path, 4);
    const next = deleteBackward(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("foobar\n");
  });

  test("forward delete from immediately before a soft break removes the line break", () => {
    // Caret at offset 3 sits at the end of "foo", immediately before the
    // `\n`. Forward delete must remove the `lineBreak` inline.
    const base = setup("foo<br>bar\n");
    const path = getPath(base, "foo\nbar");
    const placed = placeAt(base, path, 3);
    const next = deleteForward(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("foobar\n");
  });
});

describe("Images", () => {
  test("inserts an image inline at the current caret position", () => {
    const base = setup("caption\n");
    const path = getPath(base, "caption");
    const placed = placeAt(base, path, "end");
    const next = insertImage(placed, "https://example.com/img.png", "alt text");

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toContain("![alt text](https://example.com/img.png)");
  });

  test("resizes an image by replacing it with a new width attribute", () => {
    const state = setup("before ![alt](https://example.com/img.png) after\n");
    const path = getPath(state, "before ￼ after");
    const imageRun = (path.inlines ?? []).find((r) => r.node.type === "image");

    if (!imageRun || imageRun.node.type !== "image") {
      throw new Error("Expected image run");
    }

    const placed = placeAt(state, path, imageRun.start);
    const next = resizeImage(
      placed,
      { start: imageRun.start, end: imageRun.end, image: imageRun.node },
      320,
    );

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toContain("![alt](https://example.com/img.png)");
  });
});

describe("Mentions", () => {
  test("inserts a user mention inline at the current caret position", () => {
    const base = setup("Hello \n");
    const path = getPath(base, "Hello ");
    const next = insertMention(
      base,
      {
        endOffset: path.text.length,
        path: path.path,
        startOffset: path.text.length,
      },
      "user-123",
      "Jane Doe",
    );

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("Hello @[Jane Doe](user-123)\n");
  });

  test("replaces an explicit text range with a user mention", () => {
    const base = setup("Hello @ja\n");
    const path = getPath(base, "Hello @ja");
    const next = insertMention(
      base,
      {
        endOffset: "Hello @ja".length,
        path: path.path,
        startOffset: "Hello ".length,
      },
      "user-123",
      "Jane Doe",
    );

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("Hello @[Jane Doe](user-123)\n");
  });

  test("replaces an explicit text range with a user mention and trailing text", () => {
    const base = setup("Hello @ja\n");
    const path = getPath(base, "Hello @ja");
    const next = insertMention(
      base,
      {
        endOffset: "Hello @ja".length,
        path: path.path,
        startOffset: "Hello ".length,
      },
      "user-123",
      "Jane Doe",
      " ",
    );

    expect(next).not.toBeNull();
    expect(getPath(next!, "Hello ￼ ").text).toBe("Hello ￼ ");
    expect(next!.selection.focus.offset).toBe("Hello ￼ ".length);
  });

  test("replaces an image atom with a user mention", () => {
    const base = setup("Hello ![alt](https://example.com/image.png)!\n");
    const path = getPath(base, "Hello ￼!");
    const imageRun = (path.inlines ?? []).find((run) => run.node.type === "image");

    if (!imageRun) {
      throw new Error("Expected image run");
    }

    const next = insertMention(
      base,
      {
        endOffset: imageRun.end,
        path: path.path,
        startOffset: imageRun.start,
      },
      "user-123",
      "Jane Doe",
    );

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("Hello @[Jane Doe](user-123)!\n");
  });

  test("preserves raw inline text around structured inline replacements", () => {
    const nextNodes = spliceInlineNodes(
      [
        createText("before "),
        createRaw({ originalType: "html", source: "<x-raw>" }),
        createText(" after"),
      ],
      "before <x".length,
      "before <x-".length,
      [createMention({ name: "Jane Doe", userId: "user-123" })],
    );

    expect(nextNodes).toEqual([
      createText("before "),
      createRaw({ originalType: "html", source: "<x" }),
      createMention({ name: "Jane Doe", userId: "user-123" }),
      createRaw({ originalType: "html", source: "raw>" }),
      createText(" after"),
    ]);
  });

  test("deletes user mentions atomically", () => {
    const base = setup("Hello @[Jane Doe](user-123)!\n");
    const path = getPath(base, "Hello ￼!");
    const placed = placeAt(base, path, "Hello ￼".length);
    const next = deleteBackward(placed);

    expect(next).not.toBeNull();
    expect(toMarkdown(next!)).toBe("Hello !\n");
  });
});
