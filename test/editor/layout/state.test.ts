import { expect, test } from "bun:test";
import {
  CODE_BLOCK_BACKGROUND_PADDING_Y,
  createEditorLayoutState,
  createLayoutCache,
  insertText,
  setSelection,
} from "@/editor";
import { createEditorState } from "@/editor/state";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { setup } from "../helpers";

const repeatedSampleMarkdown = `# Sample Document

This is the bootstrap fixture for the editable preview editor.

- one
- two
- three
`;

test("creates a viewport layout slice smaller than the full long-document layout", () => {
  const snapshot = parseDocument(createVirtualizationFixture(80));
  const state = createEditorState(snapshot);
  const fullLayout = measureLayoutSlice(state.documentIndex, {
    width: 420,
  });
  const viewportLayout = createEditorLayoutState(state, {
    height: 720,
    top: 0,
    width: 420,
  });

  expect(viewportLayout.layout.lines.length).toBeLessThan(fullLayout.lines.length);
  expect(viewportLayout.totalHeight).toBeGreaterThan(720);
});

test("keeps near pinned regions in the viewport slice", () => {
  const snapshot = parseDocument(createVirtualizationFixture(40));
  const initialState = createEditorState(snapshot);
  const pinnedContainer = initialState.documentIndex.regions.at(-1);

  if (!pinnedContainer) {
    throw new Error("Expected pinned runtime container");
  }

  const state = setSelection(initialState, {
    offset: 0,
    regionId: pinnedContainer.id,
  });
  const initialViewportLayout = createEditorLayoutState(state, {
    height: 720,
    top: 0,
    width: 420,
  });
  const pinnedBounds = initialViewportLayout.estimateRegionBounds(pinnedContainer.id);

  if (!pinnedBounds) {
    throw new Error("Expected pinned region estimate");
  }

  const viewportLayout = createEditorLayoutState(state, {
    height: 720,
    top: Math.max(0, pinnedBounds.top - 120),
    width: 420,
  });

  expect(viewportLayout.layout.regionLineIndices.has(pinnedContainer.id)).toBeTrue();
  expect(viewportLayout.estimateRegionBounds(pinnedContainer.id)).not.toBeNull();
});

test("does not expand virtualized slices to far offscreen pinned regions", () => {
  const snapshot = parseDocument(createVirtualizationFixture(40));
  const initialState = createEditorState(snapshot);
  const pinnedContainer = initialState.documentIndex.regions.at(-1);

  if (!pinnedContainer) {
    throw new Error("Expected pinned runtime container");
  }

  const state = setSelection(initialState, {
    offset: 0,
    regionId: pinnedContainer.id,
  });
  const viewportLayout = createEditorLayoutState(state, {
    height: 720,
    top: 0,
    width: 420,
  });

  expect(viewportLayout.layout.regionLineIndices.has(pinnedContainer.id)).toBeFalse();
  expect(viewportLayout.estimateRegionBounds(pinnedContainer.id)).not.toBeNull();
});

test("uses exact full-document layout for small documents", () => {
  const snapshot = parseDocument(createVirtualizationFixture(10));
  const state = createEditorState(snapshot);
  const fullLayout = measureLayoutSlice(state.documentIndex, {
    width: 420,
  });
  const viewportLayout = createEditorLayoutState(state, {
    height: 720,
    top: 0,
    width: 420,
  });

  expect(state.documentIndex.regions.length).toBeLessThanOrEqual(96);
  expect(viewportLayout.totalHeight).toBe(fullLayout.height);
  expect(viewportLayout.layout.lines.length).toBe(fullLayout.lines.length);
});

test("keeps large documents on sliced viewport layout", () => {
  const snapshot = parseDocument(createVirtualizationFixture(40));
  const state = createEditorState(snapshot);
  const fullLayout = measureLayoutSlice(state.documentIndex, {
    width: 420,
  });
  const viewportLayout = createEditorLayoutState(state, {
    height: 720,
    top: 0,
    width: 420,
  });

  expect(state.documentIndex.regions.length).toBeGreaterThan(96);
  expect(viewportLayout.layout.lines.length).toBeLessThan(fullLayout.lines.length);
});

test("refines virtualized layout estimates after measuring slices", () => {
  const cache = createLayoutCache();
  const snapshot = parseDocument(createMeasurementSkewFixture(220));
  const initialState = createEditorState(snapshot);
  const targetRegion = initialState.documentIndex.regions.find((region) =>
    region.text.startsWith("Paragraph 180 "),
  );

  if (!targetRegion) {
    throw new Error("Expected target region");
  }

  const viewportOptions = {
    charWidth: 20,
    height: 720,
    width: 420,
  };
  const initialLayout = createEditorLayoutState(
    initialState,
    {
      ...viewportOptions,
      top: 0,
    },
    cache,
  );
  const initialEstimate = initialLayout.estimateRegionBounds(targetRegion.id);

  if (!initialEstimate) {
    throw new Error("Expected initial target estimate");
  }

  const initialEstimateHeight = initialEstimate.bottom - initialEstimate.top;
  const initialTotalHeight = initialLayout.totalHeight;

  const targetState = setSelection(initialState, {
    offset: Math.floor(targetRegion.text.length / 2),
    regionId: targetRegion.id,
  });
  const targetViewportTop = Math.max(0, initialEstimate.top - 120);
  const measuredLayout = createEditorLayoutState(
    targetState,
    {
      ...viewportOptions,
      top: targetViewportTop,
    },
    cache,
  );
  const measuredBounds = measuredLayout.layout.regionBounds.get(targetRegion.id);

  if (!measuredBounds) {
    throw new Error("Expected target region to be measured");
  }

  const refinedEstimate = measuredLayout.estimateRegionBounds(targetRegion.id);

  if (!refinedEstimate) {
    throw new Error("Expected refined target estimate");
  }

  expect(initialEstimateHeight).not.toBe(measuredBounds.bottom - measuredBounds.top);
  expect(refinedEstimate).toEqual({
    bottom: measuredBounds.bottom,
    top: measuredBounds.top,
  });
  expect(measuredLayout.totalHeight).not.toBe(initialTotalHeight);
});

test("keeps the initial mixed-block virtualized slice aligned with full layout", () => {
  const snapshot = parseDocument(createMixedVirtualizationFixture(24));
  const state = createEditorState(snapshot);
  const fullLayout = measureLayoutSlice(state.documentIndex, {
    paddingX: 12,
    paddingY: 12,
    width: 420,
  });
  const viewportLayout = createEditorLayoutState(state, {
    height: 900,
    paddingX: 12,
    paddingY: 12,
    top: 0,
    width: 420,
  });

  expect(state.documentIndex.regions.length).toBeGreaterThan(96);
  expect(viewportLayout.layout.lines.length).toBeLessThan(fullLayout.lines.length);

  for (const viewportLine of viewportLayout.layout.lines) {
    const matchingFullLine = fullLayout.lines.find(
      (line) =>
        line.regionId === viewportLine.regionId &&
        line.start === viewportLine.start &&
        line.end === viewportLine.end,
    );

    expect(matchingFullLine?.top).toBe(viewportLine.top);
    expect(matchingFullLine?.left).toBe(viewportLine.left);
  }
});

test("keeps post-table content in the initial viewport after text edits warm table caches", () => {
  const layoutCache = createLayoutCache();
  let state = setup(`# Sample Document

This sample shows the core Documint editing surface in one short document.

It stays rendered like a document, then turns locally editable when you activate a block or span.

The word sparkle uses an animated decoration so the playground can exercise paint-only effects.

Use *emphasis*, **strong text**, ~~strikethrough~~, <ins>underline</ins>, \`inline code\`, and [links](https://example.com) inside the active span.

| Block | Status | Width | Notes |
| :---- | :----- | ----: | :---- |
| Heading | stable | 640 | stays semantic |
| Table | active | 320 | edits locally |
| Comments | anchored | 3 | remain durable |

> A sample blockquote should still read naturally in the default fixture.

## Lists
`);
  const editedRegion = state.documentIndex.regions.find((region) =>
    region.text.startsWith("It stays rendered"),
  );

  if (!editedRegion) {
    throw new Error("Expected editable paragraph region");
  }

  state = setSelection(state, {
    offset: editedRegion.text.length,
    regionId: editedRegion.id,
  });

  const viewportOptions = {
    height: 540,
    paddingX: 12,
    paddingY: 12,
    top: 0,
    width: 312,
  };
  const initialViewport = createEditorLayoutState(state, viewportOptions, layoutCache);

  expect(initialViewport.layout.lines.some((line) => line.text === "Lists")).toBeTrue();

  const stateAfterInsert = insertText(state, "<");

  if (!stateAfterInsert) {
    throw new Error("Expected text insertion to update state");
  }

  const editedViewport = createEditorLayoutState(stateAfterInsert, viewportOptions, layoutCache);

  expect(editedViewport.layout.lines.some((line) => line.text === "Lists")).toBeTrue();
  expect(editedViewport.totalHeight).toBeLessThan(1000);
});

test("keeps visual block gaps consistent after code block backgrounds", () => {
  const paragraphState = setup("alpha\n\nbeta\n");
  const paragraphLayout = createEditorLayoutState(paragraphState, {
    height: 320,
    top: 0,
    width: 320,
  }).layout;
  const [firstParagraph, secondParagraph] = paragraphLayout.lines;

  if (!firstParagraph || !secondParagraph) {
    throw new Error("Expected paragraph lines");
  }

  const codeState = setup("```ts\nconst value = 1;\n```\n\nbeta\n");
  const codeLayout = createEditorLayoutState(codeState, { height: 320, top: 0, width: 320 }).layout;
  const codeLine = codeLayout.lines.find((line) => line.text === "const value = 1;");
  const paragraphAfterCode = codeLayout.lines.find((line) => line.text === "beta");

  if (!codeLine || !paragraphAfterCode) {
    throw new Error("Expected code and paragraph lines");
  }

  const paragraphGap = secondParagraph.top - (firstParagraph.top + firstParagraph.height);
  const codeGap =
    paragraphAfterCode.top - (codeLine.top + codeLine.height + CODE_BLOCK_BACKGROUND_PADDING_Y);

  expect(codeGap).toBe(paragraphGap);
});

function createMeasurementSkewFixture(paragraphCount: number) {
  return (
    Array.from(
      { length: paragraphCount },
      (_, index) =>
        `Paragraph ${index + 1} ${"WWWWWWWWWW ".repeat(36)}wide glyphs make exact measurement diverge from the cheap char-width estimate.`,
    ).join("\n\n") + "\n"
  );
}

function createVirtualizationFixture(repeatedSections: number) {
  return (
    Array.from({ length: repeatedSections }, () => repeatedSampleMarkdown.trimEnd()).join("\n\n") +
    "\n"
  );
}

function createMixedVirtualizationFixture(repeatedSections: number) {
  return (
    Array.from(
      { length: repeatedSections },
      (_, index) => `## Section ${index + 1}

Paragraph ${index + 1} wraps enough text to exercise regular block measurement and estimation.

- task ${index + 1}
- another item
- final item

\`\`\`ts
const value${index + 1} = ${index + 1};
\`\`\`

| Name | Value |
| ---- | ----- |
| A${index + 1} | B${index + 1} |

---
`,
    ).join("\n") + "\n"
  );
}
