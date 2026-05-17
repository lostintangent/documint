import { expect, test } from "bun:test";
import { buildSyntheticLongFixture, sampleMarkdown } from "@test/utils";
import { createEditorLayoutState, createLayoutCache, insertText, setSelection } from "@/editor";
import { createEditorState } from "@/editor/state";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { setup } from "../helpers";

test("creates a viewport layout slice smaller than the full long-document layout", () => {
  const snapshot = parseDocument(buildSyntheticLongFixture(sampleMarkdown, 80));
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
  const snapshot = parseDocument(buildSyntheticLongFixture(sampleMarkdown, 40));
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
  const snapshot = parseDocument(buildSyntheticLongFixture(sampleMarkdown, 40));
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
  const snapshot = parseDocument(buildSyntheticLongFixture(sampleMarkdown, 10));
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
  const snapshot = parseDocument(buildSyntheticLongFixture(sampleMarkdown, 40));
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

test("aligns the initial virtualized slice with full-layout document coordinates", () => {
  const snapshot = parseDocument(buildSyntheticLongFixture(sampleMarkdown, 40));
  const state = createEditorState(snapshot);
  const fullLayout = measureLayoutSlice(state.documentIndex, {
    paddingY: 12,
    width: 420,
  });
  const viewportLayout = createEditorLayoutState(state, {
    height: 720,
    paddingY: 12,
    top: 0,
    width: 420,
  });
  const firstViewportLine = viewportLayout.layout.lines[0];

  if (!firstViewportLine) {
    throw new Error("Expected a visible line in the virtualized viewport");
  }

  const matchingFullLine = fullLayout.lines.find(
    (line) =>
      line.regionId === firstViewportLine.regionId &&
      line.start === firstViewportLine.start &&
      line.end === firstViewportLine.end,
  );

  expect(state.documentIndex.regions.length).toBeGreaterThan(96);
  expect(matchingFullLine?.top).toBe(firstViewportLine.top);
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

function createMeasurementSkewFixture(paragraphCount: number) {
  return (
    Array.from(
      { length: paragraphCount },
      (_, index) =>
        `Paragraph ${index + 1} ${"WWWWWWWWWW ".repeat(36)}wide glyphs make exact measurement diverge from the cheap char-width estimate.`,
    ).join("\n\n") + "\n"
  );
}
