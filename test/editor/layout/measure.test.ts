import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { createLayoutCache } from "@/editor/layout/state/cache";
import { CODE_BLOCK_BACKGROUND_PADDING_Y } from "@/editor";
import { createDocumentIndex, insertLineBreak, toggleMark } from "@/editor/state";
import { spliceText } from "@/editor/state/reducer/text";
import {
  measureCaretTarget,
  resolveTaskCheckboxBounds,
  type DocumentLayout,
} from "@/editor/layout";
import { resolveDocumentLayoutOptions } from "@/editor/layout/lib/options";
import { measureBodyLayoutSlice, measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { createResources, getPath, placeAt, selectIn, setup } from "../helpers";

describe("Typography", () => {
  test("derives estimated character width from fontSize unless explicitly pinned", () => {
    const scaled = resolveDocumentLayoutOptions({ width: 400, fontSize: 20 });
    const pinned = resolveDocumentLayoutOptions({ width: 400, fontSize: 20, charWidth: 9 });

    expect(scaled.charWidth).toBe(11);
    expect(scaled.lineHeight).toBe(30);
    expect(pinned.charWidth).toBe(9);
  });

  test.each([
    {
      code: 22,
      fontSize: 16,
      heading: 36,
      label: "fontSize 16 with the default lineHeight",
      lineHeight: undefined,
      paragraph: 24,
    },
    {
      code: 19,
      fontSize: 14,
      heading: 32,
      label: "fontSize 14 with the default lineHeight",
      lineHeight: undefined,
      paragraph: 21,
    },
    {
      code: 22,
      fontSize: 16,
      heading: 36,
      label: "fontSize 16 with paragraph lineHeight 40",
      lineHeight: 40,
      paragraph: 40,
    },
  ])("derives line heights from $label", ({ code, fontSize, heading, lineHeight, paragraph }) => {
    // Embedders can pin paragraph spacing without forcing heading/code blocks
    // to inherit the same value: paragraphs use options.lineHeight as their
    // fallback, while heading and code typography derive purely from fontSize.
    const state = setup("# Heading\n\nParagraph text\n\n```\ncode\n```\n");
    const layout = measureLayoutSlice(state.documentIndex, { fontSize, lineHeight, width: 4000 });

    expect(lineWithText(layout, "Heading").height).toBe(heading);
    expect(lineWithText(layout, "Paragraph text").height).toBe(paragraph);
    expect(lineWithText(layout, "code").height).toBe(code);
  });

  test("scales task checkbox bounds with paragraph font size", () => {
    const runtime = createDocumentIndex(parseDocument("- [ ] task\n"));

    for (const expectation of [
      { fontSize: 12, lineHeight: 18, size: 11, topOffset: 2.5 },
      { fontSize: 14, lineHeight: 21, size: 12, topOffset: 3 },
      { fontSize: 16, lineHeight: 24, size: 14, topOffset: 4 },
      { fontSize: 20, lineHeight: 30, size: 18, topOffset: 5 },
    ]) {
      const layout = measureLayoutSlice(runtime, {
        fontSize: expectation.fontSize,
        width: 4000,
      });
      const line = layout.lines[0];

      if (!line) {
        throw new Error("Expected task list line");
      }

      const bounds = resolveTaskCheckboxBounds(line, line.left);

      expect(line.height).toBe(expectation.lineHeight);
      expect(line.contentInset).toBe(expectation.size + 8);
      expect(bounds.width).toBe(expectation.size);
      expect(line.contentInset - bounds.width).toBe(8);
      expect(bounds.top - line.top).toBe(expectation.topOffset);
    }
  });
});

describe("Line wrapping and breaks", () => {
  test("wraps runtime text into deterministic canvas layout lines", () => {
    const runtime = createDocumentIndex(
      parseDocument(`# Layout

Paragraph text that wraps across multiple visual lines in the canvas layout.
`),
    );
    const wideLayout = measureLayoutSlice(runtime, {
      width: 420,
    });
    const narrowLayout = measureLayoutSlice(runtime, {
      width: 140,
    });

    expect(wideLayout.lines.length).toBeLessThan(narrowLayout.lines.length);
    expect(narrowLayout.height).toBeGreaterThan(wideLayout.height);
    expect(narrowLayout.lines[1]?.text.length).toBeGreaterThan(0);
    expect(wideLayout.lines[0]?.left).toBe(wideLayout.options.paddingX);
    expect(wideLayout.lines[0]?.top).toBe(wideLayout.options.paddingY);
  });

  test.each([
    {
      label: "an inline line break",
      lines: ["foo", "bar"],
      markdown: "foo<br>\nbar\n",
      text: "foo\nbar",
    },
    {
      label: "a line break after rich inline content",
      lines: ["foo", "bar"],
      markdown: "`foo`<br>\nbar\n",
      text: "foo\nbar",
    },
    {
      label: "a trailing soft break",
      lines: ["foo", ""],
      markdown: "foo<br>\n",
      text: "foo\n",
    },
    {
      label: "a trailing empty code line",
      lines: ["const value = 1;", ""],
      markdown: "```ts\nconst value = 1;\n\n```\n",
      text: "const value = 1;\n",
    },
    {
      label: "a multi-line HTML block",
      lines: ["<div>", "  <b>hi</b>", "</div>"],
      markdown: "<div>\n  <b>hi</b>\n</div>\n",
      text: "<div>\n  <b>hi</b>\n</div>",
    },
  ])(
    "splits $label into hard-break lines with a caret on the last one",
    ({ lines, markdown, text }) => {
      // Hard breaks split lines at any width. A path ending on `\n` would
      // otherwise collapse its final newline into a separator and leave the
      // caret nowhere to land, so layout materializes an empty trailing line.
      const state = setup(markdown);
      const path = getPath(state, text);
      const layout = measureLayoutSlice(state.documentIndex, { width: 4000 });
      const pathLines = layout.lines.filter((line) => line.path === path.path);
      const caret = measureCaretTarget(layout, { offset: text.length, path: path.path });

      expect(pathLines.map((line) => line.text)).toEqual([...lines]);
      expect(caret?.top).toBe(pathLines.at(-1)!.top);
    },
  );

  test.each([
    ["paragraph", "Paragraph\n"],
    ["heading", "# Heading\n"],
    ["paragraph ending on a soft break", "Paragraph<br>\n"],
  ])("keeps an empty layout line and caret target after Enter at end of a %s", (_label, source) => {
    let state = setup(source);
    state = placeAt(state, indexedTextEntries(state)[0]!, "end");
    state = insertLineBreak(state) ?? state;

    const layout = measureLayoutSlice(state.documentIndex, {
      width: 420,
    });
    const activePath = state.selection.focus.path;
    const emptyLine = layout.lines.find((line) => line.path === activePath);
    const caret = measureCaretTarget(layout, {
      path: state.selection.focus.path,
      offset: state.selection.focus.offset,
    });

    expect(emptyLine).toBeDefined();
    expect(emptyLine?.text).toBe("");
    expect(caret?.path).toBe(activePath);
    expect(caret?.offset).toBe(0);
  });

  test("wraps repeated color emoji without losing text past the line edge", () => {
    const emojiText = `x ${"🔥".repeat(30)}`;
    const state = setup(`${emojiText}\n`);
    const path = getPath(state, emojiText);
    const layout = measureLayoutSlice(state.documentIndex, { width: 220 });
    const lines = layout.lines.filter((line) => line.path === path.path);
    const availableWidth = layout.width - layout.options.paddingX * 2;

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join("")).toBe(emojiText);
    expect(lines.every((line) => line.width <= availableWidth)).toBe(true);
  });
});

describe("Whitespace", () => {
  // Every source character gets geometry and a caret stop, as in a `pre-wrap`
  // editor, while a lone soft newline still reads as one space.
  test.each([
    [
      "doubled spaces in a paragraph",
      "Two spaces.  After a period end.\n",
      "Two spaces.  After a period end.",
    ],
    ["leading spaces in a paragraph", "&#x20;&#x20;&#x20;&#x20;npm install\n", "    npm install"],
    ["trailing spaces in a paragraph", "foo&#x20;&#x20;\n", "foo  "],
    ["doubled spaces in a heading", "# Two  spaces end\n", "Two  spaces end"],
    ["doubled spaces in a table cell", "| a  b | c |\n| --- | --- |\n| x | y |\n", "a  b"],
    ["doubled spaces after bold text", "**Two  spaces** end.  Done\n", "Two  spaces end.  Done"],
    ["leading spaces before inline code", "&#x20;&#x20;`code`  after\n", "  code  after"],
    ["trailing spaces after a link", "a  [link](https://example.com)&#x20;&#x20;\n", "a  link  "],
    ["a soft newline", "line one\nline two\n", "line one\nline two"],
  ])("lays out every character of %s on one line", (_label, markdown, text) => {
    const state = setup(markdown);
    const path = getPath(state, text);
    const layout = measureLayoutSlice(state.documentIndex, { width: 4000 });
    const lines = layout.lines.filter((line) => line.path === path.path);

    expect(lines.map((line) => line.text)).toEqual([text]);
  });

  test.each([
    ["plain text", "aaaa bbbb  cccc    dddd eeee\n"],
    ["rich text", "**aaaa** bbbb  cccc    dddd eeee\n"],
  ])("tiles wrapped %s across its lines without dropping whitespace", (_label, markdown) => {
    const text = "aaaa bbbb  cccc    dddd eeee";
    const state = setup(markdown);
    const path = getPath(state, text);
    const layout = measureLayoutSlice(state.documentIndex, { width: 120 });
    const lines = layout.lines.filter((line) => line.path === path.path);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join("")).toBe(text);
  });

  test("hangs a trailing space typed at the line edge instead of wrapping", () => {
    // "aaaa bbbb" exactly fills the line, so the typed space hangs past the
    // edge, as it does in `pre-wrap`, and the caret can land after it.
    const state = setup("aaaa bbbb&#x20;\n");
    const path = getPath(state, "aaaa bbbb ");
    const { paddingX } = resolveDocumentLayoutOptions({ width: 4000 });
    const layout = measureLayoutSlice(state.documentIndex, { width: 68 + paddingX * 2 });
    const lines = layout.lines.filter((line) => line.path === path.path);

    expect(lines.map((line) => line.text)).toEqual(["aaaa bbbb "]);
  });
});

describe("Block gaps", () => {
  const { blockGap } = resolveDocumentLayoutOptions({ width: 420 });

  test.each([
    {
      above: "alpha",
      below: "beta",
      gap: blockGap,
      label: "paragraphs",
      markdown: "alpha\n\nbeta\n",
    },
    {
      above: "const value = 1;",
      below: "beta",
      gap: blockGap + CODE_BLOCK_BACKGROUND_PADDING_Y,
      label: "a code block background and the next paragraph",
      markdown: "```ts\nconst value = 1;\n```\n\nbeta\n",
    },
    {
      above: "alpha",
      below: "beta",
      gap: 6,
      label: "tight list items",
      markdown: "- alpha\n- beta\n",
    },
    {
      above: "alpha",
      below: "beta",
      gap: blockGap,
      label: "loose list items",
      markdown: "- alpha\n\n- beta\n",
    },
    {
      above: "alpha",
      below: "child one",
      gap: blockGap,
      label: "a loose parent item and its nested list",
      markdown: "- alpha\n\n  - child one\n  - child two\n",
    },
    {
      above: "child one",
      below: "child two",
      gap: 6,
      label: "tight nested list items",
      markdown: "- alpha\n\n  - child one\n  - child two\n",
    },
  ])("separates $label by $gap", ({ above, below, gap, markdown }) => {
    const layout = measureLayoutSlice(setup(markdown).documentIndex, { width: 420 });
    const aboveLine = lineWithText(layout, above);

    expect(lineWithText(layout, below).top - (aboveLine.top + aboveLine.height)).toBe(gap);
  });

  test.each([
    { leading: 16, level: 1, trailing: 24 },
    { leading: 16, level: 2, trailing: 16 },
    { leading: 16, level: 3, trailing: 6 },
    { leading: 10, level: 4, trailing: 0 },
  ])(
    "adds $leading above and $trailing below h$level headings on top of the block gap",
    ({ leading, level, trailing }) => {
      const state = setup(`Before\n\n${"#".repeat(level)} Heading\n\nAfter\n`);
      const layout = measureLayoutSlice(state.documentIndex, { width: 420 });
      const before = lineWithText(layout, "Before");
      const heading = lineWithText(layout, "Heading");

      expect(heading.top - (before.top + before.height)).toBe(blockGap + leading);
      expect(lineWithText(layout, "After").top - (heading.top + heading.height)).toBe(
        blockGap + trailing,
      );
    },
  );
});

describe("Block slices and tables", () => {
  test("measures explicit block slices against the full document index", () => {
    const runtime = createDocumentIndex(parseDocument("alpha\n\n---\n\nbeta\n\ngamma\n"));
    const measureBlocks = (start: number, end: number) =>
      measureBodyLayoutSlice(runtime, { width: 4000 }, undefined, null, undefined, start, end);
    const throughDivider = measureBlocks(0, 3);
    const beforeDivider = measureBlocks(0, 1);
    const afterDivider = measureBlocks(2, 3);

    expect(throughDivider.blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "divider",
      "paragraph",
    ]);
    expect(beforeDivider.blocks.map((block) => block.type)).toEqual(["paragraph"]);
    expect(afterDivider.blocks.map((block) => block.type)).toEqual(["paragraph"]);
    expect(throughDivider.lines.map((line) => line.text)).toEqual(["alpha", "beta"]);
  });

  test("lays out table cells side by side within the same row", () => {
    const runtime = createDocumentIndex(
      parseDocument(`| Name | Value |
| ---- | ----- |
| One  | Two   |
`),
    );
    const layout = measureLayoutSlice(runtime, {
      width: 420,
    });
    const headerName = layout.lines.find((line) => line.text === "Name");
    const headerValue = layout.lines.find((line) => line.text === "Value");

    if (!headerName || !headerValue) {
      throw new Error("Expected table header lines");
    }

    expect(headerValue.left).toBeGreaterThan(headerName.left);
    expect(headerValue.top).toBe(headerName.top);
    expect(layout.pathBounds.get(headerName.path)?.bottom).toBeGreaterThan(
      headerName.top + headerName.height,
    );
  });
});

describe("Inline atoms", () => {
  test("treats emoji variation sequences as single caret boundary units", () => {
    const state = setup("a ✈️b\n");
    const path = getPath(state, "a ✈️b");
    const layout = measureLayoutSlice(state.documentIndex, { width: 420 });
    const line = layout.lines.find((line) => line.path === path.path);

    if (!line) {
      throw new Error("Expected paragraph line");
    }

    expect(line.boundaries.map((boundary) => boundary.offset)).toEqual([0, 1, 2, 4, 5]);
  });

  test("treats user mentions as single caret boundary units", () => {
    const state = setup("Hi @[Jane Doe](user-123)!\n");
    const path = getPath(state, "Hi ￼!");
    const layout = measureLayoutSlice(state.documentIndex, { width: 420 });
    const line = layout.lines.find((line) => line.path === path.path);

    if (!line) {
      throw new Error("Expected paragraph line");
    }

    expect(line.boundaries.map((boundary) => boundary.offset)).toEqual([0, 1, 2, 3, 4, 5]);

    const beforeMention = line.boundaries.find((boundary) => boundary.offset === 3);
    const afterMention = line.boundaries.find((boundary) => boundary.offset === 4);

    expect(beforeMention).toBeDefined();
    expect(afterMention).toBeDefined();
    expect(afterMention!.left - beforeMention!.left).toBeGreaterThan(60);
    expect(line.inlineReferences).toEqual([
      {
        end: 4,
        kind: "mention",
        start: 3,
        width: afterMention!.left - beforeMention!.left,
      },
    ]);
  });

  test("measures registered resources as single pill units", () => {
    const state = setup("Open [Recording](demo-resource://recording/live) now\n", {
      resourceProtocols: ["demo-resource:"],
    });
    const path = getPath(state, "Open ￼ now");
    const resources = createResources({ active: ["demo-resource://recording/live"] });
    const layout = measureLayoutSlice(state.documentIndex, { width: 420 }, undefined, resources);
    const line = layout.lines.find((line) => line.path === path.path);

    if (!line) {
      throw new Error("Expected paragraph line");
    }

    const beforeResource = line.boundaries.find((boundary) => boundary.offset === 5);
    const afterResource = line.boundaries.find((boundary) => boundary.offset === 6);

    expect(beforeResource).toBeDefined();
    expect(afterResource).toBeDefined();
    expect(afterResource!.left - beforeResource!.left).toBeGreaterThan(80);
    expect(afterResource!.left - beforeResource!.left).toBeLessThan(130);
    const resourceReference = line.inlineReferences?.[0];

    if (resourceReference?.kind !== "resource") {
      throw new Error("Expected resource inline reference metric");
    }

    expect(line.inlineReferences).toHaveLength(1);
    expect(resourceReference).toMatchObject({
      end: 6,
      kind: "resource",
      start: 5,
      width: afterResource!.left - beforeResource!.left,
    });
    expect(resourceReference.iconSegmentWidth).toBeGreaterThan(0);
  });

  test("wraps after a minimum-width resource pill at its painted width", () => {
    const state = setup("[i](demo-resource://tiny) xxxx\n", {
      resourceProtocols: ["demo-resource:"],
    });
    const path = getPath(state, "￼ xxxx");
    const resources = createResources({
      active: ["demo-resource://tiny"],
      protocols: { "demo-resource:": undefined },
    });
    const layout = measureLayoutSlice(state.documentIndex, { width: 90 }, undefined, resources);
    const paragraphLines = layout.lines.filter((line) => line.path === path.path);

    expect(paragraphLines).toHaveLength(2);
    expect(paragraphLines[0]?.inlineReferences?.[0]).toMatchObject({ kind: "resource", width: 30 });
  });

  test.each([
    {
      attributes: "{width=120}",
      height: 68,
      intrinsic: { height: 540, width: 960 },
      lineHeight: 68,
      width: 120,
    },
    // Badges keep their intrinsic size, so the line keeps its text height.
    { attributes: "", height: 20, intrinsic: { height: 20, width: 98 }, lineHeight: 24, width: 98 },
  ])(
    "lays out a loaded $intrinsic.width by $intrinsic.height image at $width by $height",
    ({ attributes, height, intrinsic, lineHeight, width }) => {
      const url = "https://example.com/preview.png";
      const runtime = createDocumentIndex(parseDocument(`![Preview](${url})${attributes}\n`));
      const resources = createResources({ images: { [url]: intrinsic } });
      const layout = measureLayoutSlice(runtime, { width: 420 }, createLayoutCache(), resources);

      expect(layout.lines[0]?.height).toBe(lineHeight);
      expect(layout.lines[0]?.inlineReferences).toEqual([
        { end: 1, height, kind: "image", start: 0, width },
      ]);
    },
  );

  test("keeps text below a badge row in place while the badges load", () => {
    const urls = ["ci", "npm", "license"].map((name) => `https://example.com/${name}.svg`);
    const state = setup(
      `${urls.map((url) => `[![badge](${url})](https://ci)`).join(" ")}\n\nBelow\n`,
    );
    const below = getPath(state, "Below");
    const loaded = createResources({
      images: Object.fromEntries(urls.map((url) => [url, { height: 20, width: 98 }])),
    });
    const measureTopOfBelow = (resources: ReturnType<typeof createResources>) =>
      measureLayoutSlice(
        state.documentIndex,
        { width: 420 },
        createLayoutCache(),
        resources,
      ).lines.find((line) => line.path === below.path)?.top;
    const loadingTop = measureTopOfBelow(createResources());

    expect(loadingTop).toBeGreaterThan(0);
    expect(loadingTop).toBe(measureTopOfBelow(loaded));
  });
});

describe("Layout cache", () => {
  test("reuses cached sibling table measurements when one cell changes", () => {
    const cache = createLayoutCache();
    const runtime = createDocumentIndex(
      parseDocument(`| Name | Value |
| ---- | ----- |
| One  | Two   |
`),
    );
    const editedCell = indexedTextEntries(runtime)[0];

    if (!editedCell) {
      throw new Error("Expected editable table cell");
    }

    measureLayoutSlice(
      runtime,
      {
        width: 420,
      },
      cache,
    );
    const initialMeasuredLineCount = cache.measuredLines.size;
    const replaced = spliceText(
      runtime,
      {
        anchor: {
          path: editedCell.path,
          offset: 0,
        },
        focus: {
          path: editedCell.path,
          offset: editedCell.text.length,
        },
      },
      "Label",
    )!;

    measureLayoutSlice(
      replaced.documentIndex,
      {
        width: 420,
      },
      cache,
    );

    expect(cache.measuredLines.size).toBe(initialMeasuredLineCount + 1);
  });

  test("recomputes cached line boundaries when inline mark state changes", () => {
    const cache = createLayoutCache();
    let state = setup("WWWWW WWWWW WWWWW");
    const container = getPath(state, "WWWWW WWWWW WWWWW");

    const plainLayout = measureLayoutSlice(
      state.documentIndex,
      {
        width: 180,
      },
      cache,
    );
    const plainBoundaries = plainLayout.lines[0]?.boundaries;

    // Bold the whole run so only its marks, not its range, change.
    state = selectIn(state, container, 0, container.text.length);
    state = toggleMark(state, "bold") ?? state;

    const markedLayout = measureLayoutSlice(
      state.documentIndex,
      {
        width: 180,
      },
      cache,
    );
    const markedBoundaries = markedLayout.lines[0]?.boundaries;
    const freshBoundaries = measureLayoutSlice(state.documentIndex, { width: 180 }).lines[0]
      ?.boundaries;

    expect(markedBoundaries).toBeDefined();
    expect(markedBoundaries).toEqual(freshBoundaries);
    expect(markedBoundaries).not.toEqual(plainBoundaries);
  });

  test("does not reuse cached lines across different astral symbols", () => {
    const cache = createLayoutCache();
    const first = createDocumentIndex(parseDocument("😀\n"));
    const second = createDocumentIndex(parseDocument("😁\n"));

    measureLayoutSlice(first, { width: 420 }, cache);
    const secondLayout = measureLayoutSlice(second, { width: 420 }, cache);

    expect(secondLayout.lines[0]?.text).toBe("😁");
  });

  test.each([
    { change: "width", options: { width: 180 } },
    { change: "font size", options: { fontSize: 24, width: 420 } },
  ])("re-wraps cached text when the $change changes", ({ options }) => {
    const cache = createLayoutCache();
    const runtime = createDocumentIndex(parseDocument(`${"WWWWW ".repeat(12)}\n`));
    const initial = measureLayoutSlice(runtime, { width: 420 }, cache);
    const cached = measureLayoutSlice(runtime, options, cache);
    const fresh = measureLayoutSlice(runtime, options);

    expect(fresh.lines).not.toEqual(initial.lines);
    expect(cached.lines).toEqual(fresh.lines);
  });

  test("recomputes cached resource measurements when protocol icons change", () => {
    const cache = createLayoutCache();
    const state = setup("Open [Recording](demo-resource://recording/live) now\n", {
      resourceProtocols: ["demo-resource:"],
    });
    const path = getPath(state, "Open ￼ now");
    const resourcesWithIcon = (icon: string) =>
      createResources({
        active: ["demo-resource://recording/live"],
        protocols: { "demo-resource:": icon },
      });
    const shortLayout = measureLayoutSlice(
      state.documentIndex,
      { width: 420 },
      cache,
      resourcesWithIcon("R"),
    );
    const longLayout = measureLayoutSlice(
      state.documentIndex,
      { width: 420 },
      cache,
      resourcesWithIcon("Recording"),
    );
    const readResourceWidth = (layout: typeof shortLayout) => {
      const line = layout.lines.find((line) => line.path === path.path);

      if (!line) {
        throw new Error("Expected paragraph line");
      }

      const beforeResource = line.boundaries.find((boundary) => boundary.offset === 5);
      const afterResource = line.boundaries.find((boundary) => boundary.offset === 6);

      if (!beforeResource || !afterResource) {
        throw new Error("Expected resource boundaries");
      }

      return afterResource.left - beforeResource.left;
    };

    expect(readResourceWidth(longLayout)).toBeGreaterThan(readResourceWidth(shortLayout) + 50);
  });
});

function lineWithText(layout: DocumentLayout, text: string) {
  const line = layout.lines.find((candidate) => candidate.text === text);

  if (!line) {
    throw new Error(`Expected layout line "${text}"`);
  }

  return line;
}
