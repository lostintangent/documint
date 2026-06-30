import { indexedTextEntries } from "@test/editor/helpers";
import { expect, test } from "bun:test";
import { createLayoutCache } from "@/editor/layout/state/cache";
import {
  createDocumentIndex,
  createEditorState,
  insertLineBreak,
  setSelection,
  toggleMark,
} from "@/editor/state";
import { spliceText } from "@/editor/state/reducer/text";
import { measureCaretTarget, resolveTaskCheckboxBounds } from "@/editor/layout";
import { resolveDocumentLayoutOptions } from "@/editor/layout/lib/options";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { fixtureOptions } from "../../../playground/src/lib/data";
import type { DocumentResources } from "@/types";
import { getPath, setup } from "../helpers";

test("derives estimated character width from fontSize unless explicitly pinned", () => {
  const scaled = resolveDocumentLayoutOptions({ width: 400, fontSize: 20 });
  const pinned = resolveDocumentLayoutOptions({ width: 400, fontSize: 20, charWidth: 9 });

  expect(scaled.charWidth).toBe(11);
  expect(scaled.lineHeight).toBe(30);
  expect(pinned.charWidth).toBe(9);
});

test("paragraph honors explicit lineHeight while heading and code derive from fontSize", () => {
  // Embedders can pin paragraph spacing without forcing heading/code blocks
  // to inherit the same value: paragraphs use options.lineHeight as their
  // fallback, while heading and code typography derive purely from fontSize.
  // This test locks that asymmetry so a future "make headings inherit the
  // override" change doesn't sneak through.
  const runtime = createDocumentIndex(
    parseDocument("# Heading\n\nParagraph text\n\n```\ncode\n```\n"),
  );
  const layout = measureLayoutSlice(runtime, { width: 4000, fontSize: 16, lineHeight: 40 });
  const heading = layout.lines.find((line) => line.text === "Heading");
  const paragraph = layout.lines.find((line) => line.text === "Paragraph text");
  const code = layout.lines.find((line) => line.text === "code");

  if (!heading || !paragraph || !code) {
    throw new Error("Expected heading, paragraph, and code lines");
  }

  // Paragraph: uses the explicit override.
  expect(paragraph.height).toBe(40);
  // Heading: round(16 * 2.25) = 36, derived from fontSize only.
  expect(heading.height).toBe(36);
  // Code: round(15 * 22/15) = 22, derived from fontSize only.
  expect(code.height).toBe(22);
});

test("scales heading and paragraph line heights proportionally with fontSize", () => {
  // Picking a non-default fontSize must scale the entire typography hierarchy:
  // paragraphs use `fontSize * 1.5` (the resolver's derived lineHeight), and
  // heading line heights scale from the at-base-16 reference table.
  const runtime = createDocumentIndex(parseDocument("# Heading\n\nParagraph text\n"));
  const baseLayout = measureLayoutSlice(runtime, { width: 4000, fontSize: 16 });
  const scaledLayout = measureLayoutSlice(runtime, { width: 4000, fontSize: 14 });
  const baseHeading = baseLayout.lines.find((line) => line.text === "Heading");
  const scaledHeading = scaledLayout.lines.find((line) => line.text === "Heading");
  const baseParagraph = baseLayout.lines.find((line) => line.text === "Paragraph text");
  const scaledParagraph = scaledLayout.lines.find((line) => line.text === "Paragraph text");

  if (!baseHeading || !scaledHeading || !baseParagraph || !scaledParagraph) {
    throw new Error("Expected heading and paragraph lines");
  }

  // H1 lineHeightRatio = 2.25: round(16 * 2.25) = 36, round(14 * 2.25) = 32.
  expect(baseHeading.height).toBe(36);
  expect(scaledHeading.height).toBe(32);
  // Paragraph derives lineHeight at the default 1.5× ratio: 24, 21.
  expect(baseParagraph.height).toBe(24);
  expect(scaledParagraph.height).toBe(21);
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

    const bounds = resolveTaskCheckboxBounds(line);

    expect(line.height).toBe(expectation.lineHeight);
    expect(line.contentInset).toBe(expectation.size + 8);
    expect(bounds.size).toBe(expectation.size);
    expect(line.contentInset - bounds.size).toBe(8);
    expect(bounds.top - line.top).toBe(expectation.topOffset);
  }
});

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

test("forces a wrap on inline line break runs even at large widths", () => {
  // A paragraph with an inline `<br>` must split into two layout lines no
  // matter how wide the canvas is. Plain text paths with `lineBreak` runs
  // stay on the Pretext path, but switch to `whiteSpace: "pre-wrap"` so `\n`
  // remains a hard break.
  const state = setup("foo<br>\nbar\n");
  const path = getPath(state, "foo\nbar");
  const layout = measureLayoutSlice(state.documentIndex, { width: 4000 });
  const containerLines = layout.lines.filter((line) => line.path === path.path);

  expect(containerLines.length).toBe(2);
  expect(containerLines[0]?.text).toBe("foo");
  expect(containerLines[1]?.text).toBe("bar");
});

test("materializes a trailing empty line when the path ends on a soft break", () => {
  // After a Shift+Enter at end-of-content, the path's text ends with
  // `\n`. The line breaker would otherwise consume that newline as a pure
  // separator and produce only the prefix line, leaving the caret nowhere
  // visible to land. The post-loop fix in `layoutSegmentsIntoLines` emits
  // an explicit empty trailing line so the caret has a target.
  const state = setup("foo<br>\n");
  const path = getPath(state, "foo\n");
  const layout = measureLayoutSlice(state.documentIndex, { width: 4000 });
  const containerLines = layout.lines.filter((line) => line.path === path.path);

  expect(containerLines.length).toBe(2);
  expect(containerLines[0]?.text).toBe("foo");
  expect(containerLines[1]?.text).toBe("");
});

test("uses compact gaps between tight list items", () => {
  const runtime = createDocumentIndex(parseDocument("- alpha\n- beta\n"));
  const layout = measureLayoutSlice(runtime, { width: 4000 });
  const alphaLine = layout.lines.find((line) => line.text === "alpha");
  const betaLine = layout.lines.find((line) => line.text === "beta");

  if (!alphaLine || !betaLine) {
    throw new Error("Expected tight list lines");
  }

  const gap = betaLine.top - (alphaLine.top + alphaLine.height);

  expect(gap).toBe(6);
  expect(gap).toBeLessThan(layout.options.blockGap);
});

test("uses regular block gaps between loose list items", () => {
  const runtime = createDocumentIndex(parseDocument("- alpha\n\n- beta\n"));
  const layout = measureLayoutSlice(runtime, { width: 4000 });
  const alphaLine = layout.lines.find((line) => line.text === "alpha");
  const betaLine = layout.lines.find((line) => line.text === "beta");

  if (!alphaLine || !betaLine) {
    throw new Error("Expected loose list lines");
  }

  const gap = betaLine.top - (alphaLine.top + alphaLine.height);

  expect(gap).toBe(layout.options.blockGap);
});

test("measures explicit block slices against the full document index", () => {
  const runtime = createDocumentIndex(parseDocument("alpha\n\n---\n\nbeta\n\ngamma\n"));
  const throughDivider = measureLayoutSlice(
    runtime,
    { width: 4000 },
    undefined,
    null,
    undefined,
    0,
    3,
  );
  const beforeDivider = measureLayoutSlice(
    runtime,
    { width: 4000 },
    undefined,
    null,
    undefined,
    0,
    1,
  );
  const afterDivider = measureLayoutSlice(
    runtime,
    { width: 4000 },
    undefined,
    null,
    undefined,
    2,
    3,
  );

  expect(throughDivider.blocks.map((block) => block.type)).toEqual([
    "paragraph",
    "divider",
    "paragraph",
  ]);
  expect(beforeDivider.blocks.map((block) => block.type)).toEqual(["paragraph"]);
  expect(afterDivider.blocks.map((block) => block.type)).toEqual(["paragraph"]);
  expect(throughDivider.lines.map((line) => line.text)).toEqual(["alpha", "beta"]);
});

test("uses compact gaps between nested list items inside a loose parent item", () => {
  const runtime = createDocumentIndex(parseDocument("- alpha\n\n  - child one\n  - child two\n"));
  const layout = measureLayoutSlice(runtime, { width: 4000 });
  const alphaLine = layout.lines.find((line) => line.text === "alpha");
  const childOneLine = layout.lines.find((line) => line.text === "child one");
  const childTwoLine = layout.lines.find((line) => line.text === "child two");

  if (!alphaLine || !childOneLine || !childTwoLine) {
    throw new Error("Expected parent and nested list lines");
  }

  const parentGap = childOneLine.top - (alphaLine.top + alphaLine.height);
  const nestedGap = childTwoLine.top - (childOneLine.top + childOneLine.height);

  expect(parentGap).toBe(layout.options.blockGap);
  expect(nestedGap).toBe(6);
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

test.each([
  ["paragraph", "Paragraph\n"],
  ["heading", "# Heading\n"],
  ["paragraph ending on a soft break", "Paragraph<br>\n"],
])("keeps an empty layout line and caret target after Enter at end of a %s", (_label, source) => {
  let state = setup(source);
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editable path");
  }

  state = setSelection(state, { path: path.path, offset: path.text.length });
  state = insertLineBreak(state) ?? state;

  const layout = measureLayoutSlice(state.documentIndex, {
    width: 420,
  });
  const activePath = state.selection.focus.path;
  const emptyLine = layout.lines.find((line) => line.path === activePath);
  const caret = measureCaretTarget(layout, state.documentIndex, {
    path: state.selection.focus.path,
    offset: state.selection.focus.offset,
  });

  expect(emptyLine).toBeDefined();
  expect(emptyLine?.text).toBe("");
  expect(caret?.path).toBe(activePath);
  expect(caret?.offset).toBe(0);
});

test("uses matching outer spacing around h2 heading rules", () => {
  const runtime = createDocumentIndex(
    parseDocument(`Before

## Heading

After
`),
  );
  const layout = measureLayoutSlice(runtime, {
    width: 420,
  });
  const beforeLine = layout.lines.find((line) => line.text === "Before");
  const headingLine = layout.lines.find((line) => line.text === "Heading");
  const afterLine = layout.lines.find((line) => line.text === "After");

  if (!beforeLine || !headingLine || !afterLine) {
    throw new Error("Expected heading spacing fixture lines");
  }

  const leadingGap = headingLine.top - (beforeLine.top + beforeLine.height);
  const trailingGap = afterLine.top - (headingLine.top + headingLine.height);

  expect(leadingGap).toBe(trailingGap);
  expect(leadingGap).toBeGreaterThan(layout.options.blockGap);
});

test("uses larger trailing spacing around h1 headings between blocks", () => {
  const runtime = createDocumentIndex(
    parseDocument(`Before

# Heading

After
`),
  );
  const layout = measureLayoutSlice(runtime, {
    width: 420,
  });
  const beforeLine = layout.lines.find((line) => line.text === "Before");
  const headingLine = layout.lines.find((line) => line.text === "Heading");
  const afterLine = layout.lines.find((line) => line.text === "After");

  if (!beforeLine || !headingLine || !afterLine) {
    throw new Error("Expected h1 spacing fixture lines");
  }

  const leadingGap = headingLine.top - (beforeLine.top + beforeLine.height);
  const trailingGap = afterLine.top - (headingLine.top + headingLine.height);

  expect(leadingGap).toBe(layout.options.blockGap + 16);
  expect(trailingGap).toBe(layout.options.blockGap + 24);
});

test("uses smaller trailing spacing around h3 and deeper headings", () => {
  const runtime = createDocumentIndex(
    parseDocument(`Before

### Heading

After

#### Subheading

End
`),
  );
  const layout = measureLayoutSlice(runtime, {
    width: 420,
  });
  const beforeLine = layout.lines.find((line) => line.text === "Before");
  const headingLine = layout.lines.find((line) => line.text === "Heading");
  const afterLine = layout.lines.find((line) => line.text === "After");
  const subheadingLine = layout.lines.find((line) => line.text === "Subheading");
  const endLine = layout.lines.find((line) => line.text === "End");

  if (!beforeLine || !headingLine || !afterLine || !subheadingLine || !endLine) {
    throw new Error("Expected h3+ spacing fixture lines");
  }

  const h3LeadingGap = headingLine.top - (beforeLine.top + beforeLine.height);
  const h3TrailingGap = afterLine.top - (headingLine.top + headingLine.height);
  const h4LeadingGap = subheadingLine.top - (afterLine.top + afterLine.height);
  const h4TrailingGap = endLine.top - (subheadingLine.top + subheadingLine.height);

  expect(h3LeadingGap).toBe(layout.options.blockGap + 16);
  expect(h3TrailingGap).toBe(layout.options.blockGap + 6);
  expect(h4LeadingGap).toBe(layout.options.blockGap + 10);
  expect(h4TrailingGap).toBe(layout.options.blockGap);
});

test("recomputes cached line boundaries when inline mark state changes", () => {
  const cache = createLayoutCache();
  let state = setup("WWWWW WWWWW WWWWW");
  const container = indexedTextEntries(state)[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const plainLayout = measureLayoutSlice(
    state.documentIndex,
    {
      width: 180,
    },
    cache,
  );
  const plainBoundaries = plainLayout.lines[0]?.boundaries;

  state = setSelection(state, {
    anchor: {
      path: container.path,
      offset: 0,
    },
    focus: {
      path: container.path,
      offset: 5,
    },
  });
  state = toggleMark(state, "bold") ?? state;

  const markedLayout = measureLayoutSlice(
    state.documentIndex,
    {
      width: 180,
    },
    cache,
  );
  const markedBoundaries = markedLayout.lines[0]?.boundaries;

  expect(markedBoundaries).toBeDefined();
  expect(markedBoundaries).not.toBe(plainBoundaries);
});

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

test("does not reuse cached lines across different astral symbols", () => {
  const cache = createLayoutCache();
  const first = createDocumentIndex(parseDocument("😀\n"));
  const second = createDocumentIndex(parseDocument("😁\n"));

  measureLayoutSlice(first, { width: 420 }, cache);
  const secondLayout = measureLayoutSlice(second, { width: 420 }, cache);

  expect(secondLayout.lines[0]?.text).toBe("😁");
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
  const state = createEditorState(
    parseDocument("Open [Recording](demo-resource://recording/live) now\n", {
      resourceProtocols: ["demo-resource:"],
    }),
  );
  const path = getPath(state, "Open ￼ now");
  const resources: DocumentResources = {
    images: new Map(),
    resourceRegistry: {
      active: new Set(["demo-resource://recording/live"]),
      protocols: new Map([
        [
          "demo-resource:",
          {
            icon: "R",
            label: "Demo resource",
          },
        ],
      ]),
    },
  };
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

test("recomputes cached resource measurements when protocol icons change", () => {
  const cache = createLayoutCache();
  const state = createEditorState(
    parseDocument("Open [Recording](demo-resource://recording/live) now\n", {
      resourceProtocols: ["demo-resource:"],
    }),
  );
  const path = getPath(state, "Open ￼ now");
  const createResources = (icon: string): DocumentResources => ({
    images: new Map(),
    resourceRegistry: {
      active: new Set(["demo-resource://recording/live"]),
      protocols: new Map([["demo-resource:", { icon, label: "Demo resource" }]]),
    },
  });
  const shortLayout = measureLayoutSlice(
    state.documentIndex,
    { width: 420 },
    cache,
    createResources("R"),
  );
  const longLayout = measureLayoutSlice(
    state.documentIndex,
    { width: 420 },
    cache,
    createResources("Recording"),
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

test("lays out playground tutorial demo resources as single reference pill spans", () => {
  const tutorial = fixtureOptions.find((fixture) => fixture.id === "sample");

  if (!tutorial) {
    throw new Error("Expected playground tutorial fixture");
  }

  const state = createEditorState(
    parseDocument(tutorial.markdown, { resourceProtocols: ["demo-note:", "demo-resource:"] }),
  );
  const path = getPath(state, "Try the active ￼ resource and the inactive ￼ resource.");
  const resources: DocumentResources = {
    images: new Map(),
    resourceRegistry: {
      active: new Set(["demo-resource://recording/live"]),
      protocols: new Map([
        ["demo-note:", { icon: "N", label: "Demo note" }],
        ["demo-resource:", { icon: "R", label: "Demo resource" }],
      ]),
    },
  };
  const layout = measureLayoutSlice(state.documentIndex, { width: 900 }, undefined, resources);
  const line = layout.lines.find((line) => line.path === path.path);

  if (!line) {
    throw new Error("Expected playground resource paragraph line");
  }

  const firstBefore = line.boundaries.find((boundary) => boundary.offset === 15);
  const firstAfter = line.boundaries.find((boundary) => boundary.offset === 16);
  const secondBefore = line.boundaries.find((boundary) => boundary.offset === 43);
  const secondAfter = line.boundaries.find((boundary) => boundary.offset === 44);

  expect(firstBefore).toBeDefined();
  expect(firstAfter).toBeDefined();
  expect(secondBefore).toBeDefined();
  expect(secondAfter).toBeDefined();
  expect(firstAfter!.left - firstBefore!.left).toBeGreaterThan(120);
  expect(secondAfter!.left - secondBefore!.left).toBeGreaterThan(90);
  expect(line.boundaries.some((boundary) => boundary.offset > 15 && boundary.offset < 16)).toBe(
    false,
  );
  expect(line.boundaries.some((boundary) => boundary.offset > 43 && boundary.offset < 44)).toBe(
    false,
  );
});

test("uses authored image width when laying out image runs", () => {
  const runtime = createDocumentIndex(
    parseDocument("![Preview](https://example.com/preview.png){width=120}\n"),
  );
  const resources: DocumentResources = {
    images: new Map([
      [
        "https://example.com/preview.png",
        {
          intrinsicHeight: 540,
          intrinsicWidth: 960,
          source: null,
          status: "loaded",
        },
      ],
    ]),
    resourceRegistry: { active: new Set(), protocols: new Map() },
  };
  const layout = measureLayoutSlice(
    runtime,
    {
      width: 420,
    },
    createLayoutCache(),
    resources,
  );

  expect(layout.lines[0]?.width).toBe(120);
  expect(layout.lines[0]?.height).toBe(68);
  expect(layout.lines[0]?.inlineReferences).toEqual([
    {
      end: 1,
      kind: "image",
      start: 0,
      width: 120,
    },
  ]);
});
