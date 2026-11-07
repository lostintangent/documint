// Inline command coverage: mark toggles, soft line breaks, and images.

import { describe, expect, test } from "bun:test";
import {
  createImage,
  createLineBreak,
  createLink,
  createMention,
  createRaw,
  createText,
} from "@/document";
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

  test("keeps line breaks inside a link it slices around an insertion", () => {
    const url = "https://example.com";
    const link = createLink({
      children: [createText("a"), createLineBreak(), createText("bc")],
      url,
    });
    const image = createImage({ url: "chart.png" });

    expect(spliceInlineNodes([link], 3, 3, [image])).toEqual([
      createLink({ children: [createText("a"), createLineBreak(), createText("b")], url }),
      image,
      createLink({ children: [createText("c")], url }),
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

  test.each([
    ["strikethrough", "Hello world\n", "world", "Hello ~~world~~\n"],
    ["underline", "Paragraph body.\n", "body", "Paragraph <ins>body</ins>.\n"],
    ["superscript", "Area of x2.\n", "2", "Area of x<sup>2</sup>.\n"],
    ["code", "Paragraph body.\n", "body", "Paragraph `body`.\n"],
  ] as const)("toggles %s on and off", (mark, markdown, text, marked) => {
    const base = setup(markdown);
    const on = toggleMark(selectSubstring(base, getPath(base, markdown.trimEnd()), text), mark)!;

    expect(toMarkdown(on)).toBe(marked);
    expect(toMarkdown(toggleMark(on, mark)!)).toBe(markdown);
  });

  test("composes code with other inline marks", () => {
    const base = setup("Call fn here.\n");
    const path = getPath(base, "Call fn here.");
    let state = selectSubstring(base, path, "fn");
    state = toggleMark(state, "code") ?? state;
    state = toggleMark(state, "bold") ?? state;
    state = toggleMark(state, "italic") ?? state;
    state = toggleMark(state, "underline") ?? state;

    expect(toMarkdown(state)).toBe("Call <ins>***`fn`***</ins> here.\n");
  });
});

describe("Soft line breaks", () => {
  // Insertion path: every inline-bearing block routes through
  // `insertInlines` and produces a `replace-block` action that splices
  // a `LineBreak` into the host's inline tree. Code blocks are the one
  // exception — their content is source text, so the command falls back
  // to a `splice-text` action with a literal `\n`.
  //
  // Block kinds are covered in roughly the order users encounter them:
  // paragraph and heading are the everyday containers; list-item and
  // blockquote test the descendant-paragraph resolution path; table-cell
  // exercises the table rebuild path; code block is the fallback.

  test.each([
    ["paragraph", "foobar\n", "foo<br>bar\n"],
    ["heading", "# foobar\n", "# foo<br>bar\n"],
    ["list item paragraph", "- foobar\n", "- foo<br>bar\n"],
    ["blockquote paragraph", "> foobar\n", "> foo<br>bar\n"],
    [
      "table cell",
      "| h1 | h2 |\n| -- | -- |\n| foobar | other |\n",
      "| h1 | h2 |\n| --- | --- |\n| foo<br>bar | other |\n",
    ],
    ["code block as a literal newline", "```\nfoobar\n```\n", "```\nfoo\nbar\n```\n"],
  ])("inserts a soft line break inside a %s", (_, markdown, expected) => {
    const base = setup(markdown);
    const next = insertSoftLineBreak(placeAt(base, getPath(base, "foobar"), 3));

    expect(toMarkdown(next!)).toBe(expected);
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

    expect(toMarkdown(next!)).toBe("before ![alt](https://example.com/img.png){width=320} after\n");
    expect(next!.selection).toBe(placed.selection);
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
