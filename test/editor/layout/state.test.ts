import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { createEditorLayoutState, createLayoutCache, insertText, setSelection } from "@/editor";
import { createEditorState, metadataValuePath } from "@/editor/state";
import { measureLayoutSlice } from "@/editor/layout/measure";
import { parseDocument } from "@/markdown";
import { setup } from "../helpers";

const repeatedSampleMarkdown = `# Sample Document

This is the bootstrap fixture for the editable preview editor.

- one
- two
- three
`;

describe("Viewport slicing", () => {
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

    expect(indexedTextEntries(state).length).toBeLessThanOrEqual(96);
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

    expect(indexedTextEntries(state).length).toBeGreaterThan(96);
    expect(viewportLayout.layout.lines.length).toBeLessThan(fullLayout.lines.length);
    expect(viewportLayout.totalHeight).toBeGreaterThan(720);
  });

  test("keeps near pinned paths in the viewport slice", () => {
    const snapshot = parseDocument(createVirtualizationFixture(40));
    const initialState = createEditorState(snapshot);
    const pinnedContainer = indexedTextEntries(initialState).at(-1);

    if (!pinnedContainer) {
      throw new Error("Expected pinned runtime container");
    }

    const state = setSelection(initialState, {
      offset: 0,
      path: pinnedContainer.path,
    });
    const initialViewportLayout = createEditorLayoutState(state, {
      height: 720,
      top: 0,
      width: 420,
    });
    const pinnedBounds = initialViewportLayout.estimatePathBounds(pinnedContainer.path);

    if (!pinnedBounds) {
      throw new Error("Expected pinned path estimate");
    }

    const viewportLayout = createEditorLayoutState(state, {
      height: 720,
      top: Math.max(0, pinnedBounds.top - 120),
      width: 420,
    });

    expect(viewportLayout.layout.pathLineIndices.has(pinnedContainer.path)).toBeTrue();
    expect(viewportLayout.estimatePathBounds(pinnedContainer.path)).not.toBeNull();
  });

  test("does not expand virtualized slices to far offscreen pinned paths", () => {
    const snapshot = parseDocument(createVirtualizationFixture(40));
    const initialState = createEditorState(snapshot);
    const pinnedContainer = indexedTextEntries(initialState).at(-1);

    if (!pinnedContainer) {
      throw new Error("Expected pinned runtime container");
    }

    const state = setSelection(initialState, {
      offset: 0,
      path: pinnedContainer.path,
    });
    const viewportLayout = createEditorLayoutState(state, {
      height: 720,
      top: 0,
      width: 420,
    });

    expect(viewportLayout.layout.pathLineIndices.has(pinnedContainer.path)).toBeFalse();
    expect(viewportLayout.estimatePathBounds(pinnedContainer.path)).not.toBeNull();
  });
});

describe("Exact and estimated parity", () => {
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

    expect(indexedTextEntries(state).length).toBeGreaterThan(96);
    expect(viewportLayout.layout.lines.length).toBeLessThan(fullLayout.lines.length);

    for (const viewportLine of viewportLayout.layout.lines) {
      const matchingFullLine = fullLayout.lines.find(
        (line) =>
          line.path === viewportLine.path &&
          line.start === viewportLine.start &&
          line.end === viewportLine.end,
      );

      expect(matchingFullLine?.top).toBe(viewportLine.top);
      expect(matchingFullLine?.left).toBe(viewportLine.left);
    }
  });

  test("keeps virtualized middle-table slices aligned with full layout", () => {
    const snapshot = parseDocument(createLargeTableFixture(140));
    const state = createEditorState(snapshot);
    const cache = createLayoutCache();
    const options = {
      height: 220,
      paddingX: 12,
      paddingY: 12,
      top: 0,
      width: 420,
    };
    const fullLayout = measureLayoutSlice(state.documentIndex, options);
    const initialViewport = createEditorLayoutState(state, options, cache);
    const target = indexedTextEntries(state).find((entry) => entry.text === "R090A");

    if (!target) {
      throw new Error("Expected middle table cell path");
    }

    const targetEstimate = initialViewport.estimatePathBounds(target.path);
    const targetFullBounds = fullLayout.pathBounds.get(target.path);

    if (!targetEstimate || !targetFullBounds) {
      throw new Error("Expected target table cell bounds");
    }

    const middleViewport = createEditorLayoutState(
      state,
      {
        ...options,
        top: targetEstimate.top,
      },
      cache,
    );
    const targetViewportBounds = middleViewport.layout.pathBounds.get(target.path);
    const targetViewportLine = middleViewport.layout.lines.find(
      (line) => line.path === target.path,
    );
    const targetFullLine = fullLayout.lines.find((line) => line.path === target.path);

    expect(targetViewportBounds?.top).toBe(targetFullBounds.top);
    expect(targetViewportBounds?.bottom).toBe(targetFullBounds.bottom);
    expect(targetViewportLine?.top).toBe(targetFullLine?.top);
  });

  test("keeps exact and virtualized body geometry aligned with an expanded metadata prefix", () => {
    const state = setup(createMetadataVirtualizationFixture(140));
    const options = {
      height: 240,
      metadataExpanded: true,
      paddingX: 12,
      paddingY: 12,
      width: 640,
    };
    const exact = measureLayoutSlice(state.documentIndex, options);
    const virtualized = createEditorLayoutState(state, { ...options, top: 0 }, createLayoutCache());
    const target = indexedTextEntries(state).find((entry) => entry.text === "Paragraph 110");

    if (!target) {
      throw new Error("Expected off-screen body target");
    }

    const estimatedTarget = virtualized.estimatePathBounds(target.path);
    const exactTarget = exact.pathBounds.get(target.path);
    const metadataBounds = exact.pathBounds.get(metadataValuePath(0));

    if (!estimatedTarget || !exactTarget || !metadataBounds) {
      throw new Error("Expected exact and estimated bounds");
    }

    expect(virtualized.totalHeight).toBe(exact.height);
    expect(estimatedTarget).toEqual({
      bottom: exactTarget.bottom,
      top: exactTarget.top,
    });
    expect(virtualized.estimatePathBounds(metadataValuePath(0))).toEqual({
      bottom: metadataBounds.bottom,
      top: metadataBounds.top,
    });
  });
});

describe("Layout cache reuse", () => {
  test("refines virtualized layout estimates after measuring slices", () => {
    const cache = createLayoutCache();
    const snapshot = parseDocument(createMeasurementSkewFixture(220));
    const initialState = createEditorState(snapshot);
    const targetPath = indexedTextEntries(initialState).find((path) =>
      path.text.startsWith("Paragraph 180 "),
    );

    if (!targetPath) {
      throw new Error("Expected target path");
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
    const initialEstimate = initialLayout.estimatePathBounds(targetPath.path);

    if (!initialEstimate) {
      throw new Error("Expected initial target estimate");
    }

    const initialEstimateHeight = initialEstimate.bottom - initialEstimate.top;
    const initialTotalHeight = initialLayout.totalHeight;

    const targetState = setSelection(initialState, {
      offset: Math.floor(targetPath.text.length / 2),
      path: targetPath.path,
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
    const measuredBounds = measuredLayout.layout.pathBounds.get(targetPath.path);

    if (!measuredBounds) {
      throw new Error("Expected target path to be measured");
    }

    const refinedEstimate = measuredLayout.estimatePathBounds(targetPath.path);

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
    const editedPath = indexedTextEntries(state).find((path) =>
      path.text.startsWith("It stays rendered"),
    );

    if (!editedPath) {
      throw new Error("Expected editable paragraph path");
    }

    state = setSelection(state, {
      offset: editedPath.text.length,
      path: editedPath.path,
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

  test("reuses the body virtual layout when metadata height changes", () => {
    let state = setup(createMetadataVirtualizationFixture(140));
    const cache = createLayoutCache();
    const options = {
      height: 240,
      metadataExpanded: true,
      top: 0,
      width: 420,
    };
    const before = createEditorLayoutState(state, options, cache);
    const cachedBefore = cache.virtualLayouts
      .get(state.documentIndex.blocks)
      ?.values()
      .next().value;
    const target = indexedTextEntries(state).find((entry) => entry.text === "Paragraph 110");

    if (!cachedBefore || !target || !before.layout.metadata) {
      throw new Error("Expected cached body layout and metadata prefix");
    }

    state = setSelection(state, {
      path: metadataValuePath(1),
      offset: "First line\nSecond line".length,
    });
    const edited = insertText(state, ` ${"wrapping metadata ".repeat(20)}`);

    if (!edited) {
      throw new Error("Expected metadata edit");
    }

    const after = createEditorLayoutState(edited, options, cache);
    const cachedAfter = cache.virtualLayouts
      .get(edited.documentIndex.blocks)
      ?.values()
      .next().value;
    const beforeTarget = before.estimatePathBounds(target.path);
    const afterTarget = after.estimatePathBounds(target.path);

    if (!after.layout.metadata || !beforeTarget || !afterTarget) {
      throw new Error("Expected composed metadata and body bounds");
    }

    const offsetDelta = after.layout.metadata.bodyOffset - before.layout.metadata.bodyOffset;

    expect(cachedAfter).toBe(cachedBefore);
    expect(afterTarget.top - beforeTarget.top).toBe(offsetDelta);
    expect(afterTarget.bottom - beforeTarget.bottom).toBe(offsetDelta);
  });
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

function createLargeTableFixture(rowCount: number) {
  return `| A | B |
| - | - |
${Array.from(
  { length: rowCount },
  (_, index) =>
    `| R${String(index + 1).padStart(3, "0")}A | R${String(index + 1).padStart(3, "0")}B |`,
).join("\n")}
`;
}

function createMetadataVirtualizationFixture(paragraphCount: number) {
  return `---
title: Virtual
description: |-
  First line
  Second line
draft: true
---
${Array.from({ length: paragraphCount }, (_, index) => `Paragraph ${index + 1}`).join("\n\n")}
`;
}
