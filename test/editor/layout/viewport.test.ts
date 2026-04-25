import { expect, test } from "bun:test";
import { buildSyntheticLongFixture, sampleMarkdown } from "@test/utils";
import {
  createCanvasRenderCache,
  createEditorState,
  insertText,
  prepareViewport,
  setSelection,
} from "@/editor";
import { createDocumentIndex } from "@/editor/state";
import { createDocumentLayout, createDocumentViewport } from "@/editor/layout";
import { parseMarkdown } from "@/markdown";

test("creates a viewport layout slice smaller than the full long-document layout", () => {
  const snapshot = parseMarkdown(buildSyntheticLongFixture(sampleMarkdown, 80));
  const runtime = createDocumentIndex(snapshot);
  const fullLayout = createDocumentLayout(runtime, {
    width: 420,
  });
  const viewportLayout = createDocumentViewport(
    runtime,
    {
      width: 420,
    },
    {
      height: 720,
      overscan: 720,
      top: 0,
    },
  );

  expect(viewportLayout.layout.lines.length).toBeLessThan(fullLayout.lines.length);
  expect(viewportLayout.totalHeight).toBeGreaterThan(720);
});

test("keeps pinned regions in the viewport slice", () => {
  const snapshot = parseMarkdown(buildSyntheticLongFixture(sampleMarkdown, 40));
  const runtime = createDocumentIndex(snapshot);
  const pinnedContainer = runtime.regions.at(-1);

  if (!pinnedContainer) {
    throw new Error("Expected pinned runtime container");
  }

  const viewportLayout = createDocumentViewport(
    runtime,
    {
      width: 420,
    },
    {
      height: 720,
      overscan: 720,
      top: 0,
    },
    [pinnedContainer.id],
  );

  expect(viewportLayout.layout.regionLineIndices.has(pinnedContainer.id)).toBeTrue();
  expect(viewportLayout.estimateRegionBounds(pinnedContainer.id)).not.toBeNull();
});

test("keeps post-table content in the initial viewport after text edits warm table caches", () => {
  const renderCache = createCanvasRenderCache();
  let state = createEditorState(
    parseMarkdown(`# Sample Document

This sample shows the core Documint editing surface in one short document.

It stays rendered like a document, then turns locally editable when you activate a block or span.

Use *emphasis*, **strong text**, ~~strikethrough~~, <ins>underline</ins>, and [links](https://example.com) inside the active span.

| Block | Status | Width | Notes |
| :---- | :----- | ----: | :---- |
| Heading | stable | 640 | stays semantic |
| Table | active | 320 | edits locally |
| Comments | anchored | 3 | remain durable |

> A sample blockquote should still read naturally in the default fixture.

## Lists
`),
  );
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
  const initialViewport = prepareViewport(state, viewportOptions, renderCache);

  expect(initialViewport.layout.lines.some((line) => line.text === "Lists")).toBeTrue();

  const stateAfterInsert = insertText(state, "<");

  if (!stateAfterInsert) {
    throw new Error("Expected text insertion to update state");
  }

  const editedViewport = prepareViewport(stateAfterInsert, viewportOptions, renderCache);

  expect(editedViewport.layout.lines.some((line) => line.text === "Lists")).toBeTrue();
  expect(editedViewport.totalHeight).toBeLessThan(1000);
});
