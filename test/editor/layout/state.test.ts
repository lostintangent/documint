import { indexedTextEntries, placeAt } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import {
  createEditorLayoutState,
  createLayoutCache,
  insertLineBreak,
  insertText,
  setSelection,
  type EditorState,
} from "@/editor";
import { createEditorState, metadataValuePath } from "@/editor/state";
import { measureLayoutSlice } from "@/editor/layout/measure";
import {
  cacheMeasuredContainerHeight,
  getMeasuredContainerHeight,
} from "@/editor/layout/state/cache";
import type { DocumentResources } from "@/editor/resources";
import { parseDocument } from "@/markdown";
import { createResources, setup } from "../helpers";

const repeatedSampleMarkdown = `# Sample Document

This is the bootstrap fixture for the editable preview editor.

- one
- two
- three
`;

const tallImageResources = createResources({
  images: { "https://example.com/tall.png": { height: 600, width: 200 } },
});

const tallImageTableMarkdown = `| Image | Notes |
| --- | --- |
| ![tall](https://example.com/tall.png) | notes |
`;

const wrappedTextTableMarkdown = `| A | B |
| --- | --- |
| short | ${"word ".repeat(40).trim()} |
| ${"long ".repeat(30).trim()} | x |
`;

const tableRebuildCases = [
  { label: "wrapped-text", resources: undefined, table: wrappedTextTableMarkdown },
  { label: "tall-image", resources: tallImageResources, table: tallImageTableMarkdown },
];

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
    expect(viewportLayout.layout.height).toBe(fullLayout.height);
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
    expect(viewportLayout.layout.height).toBeGreaterThan(720);
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

  test("estimates an unmeasured image table row from the image's size, not its text", () => {
    const state = setup(
      `${createMeasurementSkewFixture(110)}\n${tallImageTableMarkdown}\n${createMeasurementSkewFixture(10)}`,
    );
    const options = { height: 400, width: 420 };
    const imageCell = indexedTextEntries(state).find((entry) => entry.tableCell?.rowIndex === 1)!;
    const fullBounds = measureLayoutSlice(
      state.documentIndex,
      options,
      undefined,
      tallImageResources,
    ).pathBounds.get(imageCell.path)!;
    const topViewport = createEditorLayoutState(
      state,
      { ...options, top: 0 },
      createLayoutCache(),
      tallImageResources,
    );
    const estimate = topViewport.estimatePathBounds(imageCell.path)!;

    expect(topViewport.layout.pathBounds.has(imageCell.path)).toBeFalse();
    expect(estimate.bottom - estimate.top).toBe(fullBounds.bottom - fullBounds.top);
  });

  test("keeps code blocks aligned with full layout while a virtualized document scrolls", () => {
    const state = setup(createCodeBlockVirtualizationFixture(130));
    const cache = createLayoutCache();
    const options = { height: 400, width: 420 };
    const fullLayout = measureLayoutSlice(state.documentIndex, options);
    const fullLineTops = new Map(
      fullLayout.lines.map((line) => [`${line.path}:${line.start}`, line.top]),
    );
    const lastCodeEntry = indexedTextEntries(state)
      .filter((entry) => entry.text.startsWith("code "))
      .at(-1);

    if (!lastCodeEntry) {
      throw new Error("Expected a code block path");
    }

    const initialViewport = createEditorLayoutState(state, { ...options, top: 0 }, cache);
    const lastCodeBounds = fullLayout.pathBounds.get(lastCodeEntry.path)!;

    expect(initialViewport.estimatePathBounds(lastCodeEntry.path)).toEqual({
      bottom: lastCodeBounds.bottom,
      top: lastCodeBounds.top,
    });

    const drifts: { heightDrift: number; lineDrift: number; missingLines: number; top: number }[] =
      [];

    for (let top = 0; top < fullLayout.height; top += 37) {
      const viewport = createEditorLayoutState(state, { ...options, top }, cache);
      const sliceLineKeys = new Set(
        viewport.layout.lines.map((line) => `${line.path}:${line.start}`),
      );
      const heightDrift = viewport.layout.height - fullLayout.height;
      const lineDrift = Math.max(
        ...viewport.layout.lines.map((line) =>
          Math.abs(line.top - fullLineTops.get(`${line.path}:${line.start}`)!),
        ),
      );
      const missingLines = fullLayout.lines.filter(
        (line) =>
          line.top < top + options.height &&
          line.top + line.height > top &&
          !sliceLineKeys.has(`${line.path}:${line.start}`),
      ).length;

      if (heightDrift !== 0 || lineDrift !== 0 || missingLines !== 0) {
        drifts.push({ heightDrift, lineDrift, missingLines, top });
      }
    }

    expect(drifts).toEqual([]);
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

    expect(virtualized.layout.height).toBe(exact.height);
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
    const initialTotalHeight = initialLayout.layout.height;

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
    expect(measuredLayout.layout.height).not.toBe(initialTotalHeight);
  });

  test("keeps measured code-block heights exact when an edit rebuilds the virtual layout", () => {
    let state = setup(createCodeBlockVirtualizationFixture(130));
    const cache = createLayoutCache();
    const options = { height: 400, width: 420 };
    const initialHeight = measureLayoutSlice(state.documentIndex, options).height;

    // Measure every block so the height cache holds each code block.
    for (let top = 0; top < initialHeight; top += 300) {
      createEditorLayoutState(state, { ...options, top }, cache);
    }

    const [firstEntry] = indexedTextEntries(state);
    const lastEntry = indexedTextEntries(state).at(-1);

    if (!firstEntry || !lastEntry) {
      throw new Error("Expected text paths");
    }

    state = insertText(setSelection(state, { offset: 0, path: firstEntry.path }), "x")!;

    const fullLayout = measureLayoutSlice(state.documentIndex, options);
    const editedViewport = createEditorLayoutState(state, { ...options, top: 0 }, cache);
    const lastBounds = fullLayout.pathBounds.get(lastEntry.path)!;

    expect(editedViewport.layout.height).toBe(fullLayout.height);
    expect(editedViewport.estimatePathBounds(lastEntry.path)).toEqual({
      bottom: lastBounds.bottom,
      top: lastBounds.top,
    });
  });

  test.each(tableRebuildCases)(
    "keeps measured $label table rows exact when typing in a mid-document cell",
    ({ resources, table }) => {
      let state = setup(createTableRebuildFixture(table));
      const cache = createLayoutCache();
      const options = { height: 400, width: 420 };

      sweepVirtualizedLayout(state, cache, options, resources);

      const cells = indexedTextEntries(state).filter(
        (entry) => entry.tableCell?.rowIndex === 1 && entry.tableCell.cellIndex === 1,
      );
      const editedCell = cells[Math.floor(cells.length / 2)]!;

      state = insertText(placeAt(state, editedCell, "end"), " typed")!;

      const fullLayout = measureLayoutSlice(state.documentIndex, options, undefined, resources);
      const top = fullLayout.pathBounds.get(editedCell.path)!.top - 120;

      expectVirtualizedLayoutToMatchFullLayout(
        createEditorLayoutState(state, { ...options, top }, cache, resources),
        fullLayout,
      );
    },
  );

  test.each(tableRebuildCases)(
    "keeps measured heights exact below an Enter near the top of a document with $label tables",
    ({ resources, table }) => {
      let state = setup(createTableRebuildFixture(table));
      const cache = createLayoutCache();
      const options = { height: 400, width: 420 };

      sweepVirtualizedLayout(state, cache, options, resources);

      const [firstEntry] = indexedTextEntries(state);

      state = insertLineBreak(placeAt(state, firstEntry!, 4))!;

      const fullLayout = measureLayoutSlice(state.documentIndex, options, undefined, resources);

      expectVirtualizedLayoutToMatchFullLayout(
        createEditorLayoutState(state, { ...options, top: 0 }, cache, resources),
        fullLayout,
      );
      expectVirtualizedLayoutToMatchFullLayout(
        createEditorLayoutState(
          state,
          { ...options, top: fullLayout.height / 2 },
          cache,
          resources,
        ),
        fullLayout,
      );
    },
  );

  test("keeps same-text paragraphs, headings, list items, and table cells at their own measured heights", () => {
    const shared = "Shared words wrap differently by width and by font. ".repeat(4).trim();
    let state = setup(
      `${shared}\n\n## ${shared}\n\n- ${shared}\n\n| A | B | C | D |\n| - | - | - | - |\n| ${shared} | x | y | z |\n\n${createMeasurementSkewFixture(110)}`,
    );
    const cache = createLayoutCache();
    const options = { height: 400, width: 420 };

    sweepVirtualizedLayout(state, cache, options);

    const sharedPaths = indexedTextEntries(state)
      .filter((entry) => entry.text === shared)
      .map((entry) => entry.path);
    const lastEntry = indexedTextEntries(state).at(-1)!;

    state = insertText(placeAt(state, lastEntry, "end"), " typed")!;

    const fullLayout = measureLayoutSlice(state.documentIndex, options);
    const bottomViewport = createEditorLayoutState(
      state,
      { ...options, top: fullLayout.height - options.height },
      cache,
    );

    expect(sharedPaths).toHaveLength(4);
    expect(sharedPaths.map((path) => bottomViewport.layout.pathBounds.has(path))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(sharedPaths.map((path) => bottomViewport.estimatePathBounds(path))).toEqual(
      sharedPaths.map((path) => {
        const { bottom, top } = fullLayout.pathBounds.get(path)!;

        return { bottom, top };
      }),
    );
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
    expect(editedViewport.layout.height).toBeLessThan(1000);
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

  test.each([
    ["keeps", "a scroll", { height: 480, top: 200 }, null, false],
    ["replaces", "a width change", { width: 360 }, null, false],
    ["replaces", "new resources", {}, createResources(), false],
    ["replaces", "an edit", {}, null, true],
  ] as const)(
    "%s a small document's full layout after %s",
    (outcome, _, viewport, resources, edit) => {
      const state = setup(createVirtualizationFixture(10));
      const cache = createLayoutCache();
      const options = { height: 320, top: 0, width: 420 };
      const initial = createEditorLayoutState(state, options, cache);
      const next = createEditorLayoutState(
        edit ? insertText(state, "x")! : state,
        { ...options, ...viewport },
        cache,
        resources,
      );

      expect(next.layout === initial.layout).toBe(outcome === "keeps");
      expect(next.viewport).toEqual({ ...options, ...viewport });
    },
  );

  test("keeps unchanged containers' caret boundaries when a long document relays out", () => {
    const state = setup(createLongParagraphFixture(80));
    const cache = createLayoutCache();
    const options = { height: 800, top: 0, width: 640 };
    const first = createEditorLayoutState(state, options, cache);
    const second = createEditorLayoutState(insertText(state, "x")!, options, cache);
    const firstBoundaries = new Set(first.layout.lines.map((line) => line.boundaries));
    const unchangedLines = second.layout.lines.filter(
      (line) => line.path !== state.selection.focus.path,
    );

    expect(indexedTextEntries(state).length).toBeLessThanOrEqual(96);
    expect(unchangedLines.length).toBeGreaterThan(1024);
    expect(unchangedLines.every((line) => firstBoundaries.has(line.boundaries))).toBe(true);
  });

  test("trims caret boundaries back to the budget once a layout stops using them", () => {
    const cache = createLayoutCache();
    const options = { height: 800, top: 0, width: 640 };

    createEditorLayoutState(setup(createLongParagraphFixture(80)), options, cache);
    createEditorLayoutState(setup(createVirtualizationFixture(4)), options, cache);

    const retainedLines = [...cache.lineBoundaries.values()].reduce(
      (total, boundaries) => total + boundaries.length,
      0,
    );

    expect(retainedLines).toBeLessThanOrEqual(1024);
  });

  test("never evicts a height re-measured unchanged within half the budget", () => {
    const cache = createLayoutCache();
    const evictedAtWrites: number[] = [];

    cacheMeasuredContainerHeight(cache, "visible", 48);
    cacheMeasuredContainerHeight(cache, "scrolled-past", 24);

    for (let write = 1; write <= 4096; write += 1) {
      cacheMeasuredContainerHeight(cache, `scrolled-${write}`, 24);

      if (write % 256 === 0) {
        if (getMeasuredContainerHeight(cache, "visible") === undefined) {
          evictedAtWrites.push(write);
        }

        cacheMeasuredContainerHeight(cache, "visible", 48);
      }
    }

    expect(evictedAtWrites).toEqual([]);
    expect(getMeasuredContainerHeight(cache, "scrolled-past")).toBeUndefined();
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

// Every tenth block is a two-line code block between one-line paragraphs, so
// estimates match exact layout until code-block padding goes astray.
function createCodeBlockVirtualizationFixture(blockCount: number) {
  return (
    Array.from({ length: blockCount }, (_, index) =>
      index % 10 === 5 ? `\`\`\`\ncode ${index}\nmore\n\`\`\`` : `Para ${index}`,
    ).join("\n\n") + "\n"
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

// Each paragraph wraps to 13 lines at 640px, so 80 of them stay on the
// full-layout path with over a thousand lines.
function createLongParagraphFixture(paragraphCount: number) {
  const paragraph =
    "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ".repeat(13);

  return Array.from({ length: paragraphCount }, (_, index) => `${paragraph}${index}`).join("\n\n");
}

// Every sixth block is a table between wide-glyph paragraphs. Text estimates
// miss both measured heights, so only cached heights keep a rebuild exact.
function createTableRebuildFixture(table: string) {
  return (
    Array.from({ length: 120 }, (_, index) =>
      index % 6 === 3 ? table.trim() : `Paragraph ${index} ${"WWWWWWWWWW ".repeat(6)}`,
    ).join("\n\n") + "\n"
  );
}

// Scrolls top to bottom so every block and table row is measured once.
function sweepVirtualizedLayout(
  state: EditorState,
  cache: ReturnType<typeof createLayoutCache>,
  options: { height: number; width: number },
  resources?: DocumentResources,
) {
  let height = Number.POSITIVE_INFINITY;

  for (let top = 0; top < height; top += options.height / 2) {
    height = createEditorLayoutState(state, { ...options, top }, cache, resources).layout.height;
  }
}

function expectVirtualizedLayoutToMatchFullLayout(
  layoutState: ReturnType<typeof createEditorLayoutState>,
  fullLayout: ReturnType<typeof measureLayoutSlice>,
) {
  const fullTops = new Map(
    fullLayout.lines.map((line) => [`${line.path}:${line.start}`, line.top]),
  );
  const { lines } = layoutState.layout;

  expect(lines.length).toBeGreaterThan(0);
  expect(layoutState.layout.height).toBe(fullLayout.height);
  // A line missing from the full layout maps to undefined and fails the match.
  expect(lines.map((line) => line.top)).toEqual(
    lines.map((line) => fullTops.get(`${line.path}:${line.start}`)!),
  );
}
