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
import { measureCaretTarget } from "@/editor/layout";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { fixtureOptions } from "../../../playground/src/lib/data";
import type { DocumentResources } from "@/types";
import { getRegion, setup } from "../helpers";

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
  // matter how wide the canvas is. Plain text regions with `lineBreak` runs
  // stay on the Pretext path, but switch to `whiteSpace: "pre-wrap"` so `\n`
  // remains a hard break.
  const state = setup("foo<br>\nbar\n");
  const region = getRegion(state, "foo\nbar");
  const layout = measureLayoutSlice(state.documentIndex, { width: 4000 });
  const containerLines = layout.lines.filter((line) => line.regionId === region.id);

  expect(containerLines.length).toBe(2);
  expect(containerLines[0]?.text).toBe("foo");
  expect(containerLines[1]?.text).toBe("bar");
});

test("materializes a trailing empty line when the region ends on a soft break", () => {
  // After a Shift+Enter at end-of-content, the region's text ends with
  // `\n`. The line breaker would otherwise consume that newline as a pure
  // separator and produce only the prefix line, leaving the caret nowhere
  // visible to land. The post-loop fix in `layoutSegmentsIntoLines` emits
  // an explicit empty trailing line so the caret has a target.
  const state = setup("foo<br>\n");
  const region = getRegion(state, "foo\n");
  const layout = measureLayoutSlice(state.documentIndex, { width: 4000 });
  const containerLines = layout.lines.filter((line) => line.regionId === region.id);

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
  expect(layout.regionBounds.get(headerName.regionId)?.bottom).toBeGreaterThan(
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
  const editedCell = runtime.regions[0];

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
        regionId: editedCell.id,
        offset: 0,
      },
      focus: {
        regionId: editedCell.id,
        offset: editedCell.text.length,
      },
    },
    "Label",
  );

  measureLayoutSlice(
    replaced.documentIndex,
    {
      width: 420,
    },
    cache,
  );

  expect(cache.measuredLines.size).toBe(initialMeasuredLineCount + 1);
});

test("keeps an empty layout line and caret target for inserted empty blocks", () => {
  let state = setup("# Heading\n");
  state = insertLineBreak(state) ?? state;

  const layout = measureLayoutSlice(state.documentIndex, {
    width: 420,
  });
  const activeRegionId = state.selection.focus.regionId;
  const emptyLine = layout.lines.find((line) => line.regionId === activeRegionId);
  const caret = measureCaretTarget(layout, state.documentIndex, state.selection.focus);

  expect(emptyLine).toBeDefined();
  expect(emptyLine?.text).toBe("");
  expect(caret?.regionId).toBe(activeRegionId);
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
  const container = state.documentIndex.regions[0];

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
      regionId: container.id,
      offset: 0,
    },
    focus: {
      regionId: container.id,
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
  const region = getRegion(state, "a ✈️b");
  const layout = measureLayoutSlice(state.documentIndex, { width: 420 });
  const line = layout.lines.find((line) => line.regionId === region.id);

  if (!line) {
    throw new Error("Expected paragraph line");
  }

  expect(line.boundaries.map((boundary) => boundary.offset)).toEqual([0, 1, 2, 4, 5]);
});

test("wraps repeated color emoji without losing text past the line edge", () => {
  const emojiText = `x ${"🔥".repeat(30)}`;
  const state = setup(`${emojiText}\n`);
  const region = getRegion(state, emojiText);
  const layout = measureLayoutSlice(state.documentIndex, { width: 220 });
  const lines = layout.lines.filter((line) => line.regionId === region.id);
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
  const region = getRegion(state, "Hi ￼!");
  const layout = measureLayoutSlice(state.documentIndex, { width: 420 });
  const line = layout.lines.find((line) => line.regionId === region.id);

  if (!line) {
    throw new Error("Expected paragraph line");
  }

  expect(line.boundaries.map((boundary) => boundary.offset)).toEqual([0, 1, 2, 3, 4, 5]);

  const beforeMention = line.boundaries.find((boundary) => boundary.offset === 3);
  const afterMention = line.boundaries.find((boundary) => boundary.offset === 4);

  expect(beforeMention).toBeDefined();
  expect(afterMention).toBeDefined();
  expect(afterMention!.left - beforeMention!.left).toBeGreaterThan(60);
});

test("measures registered resources as single pill units", () => {
  const state = createEditorState(
    parseDocument("Open [Recording](demo-resource://recording/live) now\n", {
      resourceProtocols: ["demo-resource:"],
    }),
  );
  const region = getRegion(state, "Open ￼ now");
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
  const line = layout.lines.find((line) => line.regionId === region.id);

  if (!line) {
    throw new Error("Expected paragraph line");
  }

  const beforeResource = line.boundaries.find((boundary) => boundary.offset === 5);
  const afterResource = line.boundaries.find((boundary) => boundary.offset === 6);

  expect(beforeResource).toBeDefined();
  expect(afterResource).toBeDefined();
  expect(afterResource!.left - beforeResource!.left).toBeGreaterThan(80);
  expect(afterResource!.left - beforeResource!.left).toBeLessThan(130);
});

test("recomputes cached resource measurements when protocol icons change", () => {
  const cache = createLayoutCache();
  const state = createEditorState(
    parseDocument("Open [Recording](demo-resource://recording/live) now\n", {
      resourceProtocols: ["demo-resource:"],
    }),
  );
  const region = getRegion(state, "Open ￼ now");
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
    const line = layout.lines.find((line) => line.regionId === region.id);

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
  const region = getRegion(state, "Try the active ￼ resource and the inactive ￼ resource.");
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
  const line = layout.lines.find((line) => line.regionId === region.id);

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
});
