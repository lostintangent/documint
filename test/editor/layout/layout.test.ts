import { expect, test } from "bun:test";
import { createDocument, createParagraphTextBlock } from "@/document";
import { createCanvasRenderCache } from "@/editor/canvas/cache";
import {
  createDocumentIndex,
  createEditorState,
  insertLineBreak,
  setSelection,
  toggleBold,
} from "@/editor/state";
import { spliceText } from "@/editor/state/reducer/text";
import {
  createDocumentLayout,
  measureCaretTarget,
  resolveCaretVisualLeft,
  resolveEditorHitAtPoint,
  resolveSelectionHit,
} from "@/editor/layout";
import type { DocumentResources } from "@/types";
import { parseDocument } from "@/markdown";

test("wraps runtime text into deterministic canvas layout lines", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Layout

Paragraph text that wraps across multiple visual lines in the canvas layout.
`),
  );
  const wideLayout = createDocumentLayout(runtime, {
    width: 420,
  });
  const narrowLayout = createDocumentLayout(runtime, {
    width: 140,
  });

  expect(wideLayout.lines.length).toBeLessThan(narrowLayout.lines.length);
  expect(narrowLayout.height).toBeGreaterThan(wideLayout.height);
  expect(narrowLayout.lines[1]?.text.length).toBeGreaterThan(0);
  expect(wideLayout.lines[0]?.left).toBe(wideLayout.options.paddingX);
  expect(wideLayout.lines[0]?.top).toBe(wideLayout.options.paddingY);
});

test("hit-tests canvas layout coordinates back to semantic offsets", () => {
  const runtime = createDocumentIndex(parseDocument(`Paragraph with semantic offsets.\n`));
  const layout = createDocumentLayout(runtime, {
    width: 320,
  });
  const paragraphContainer = runtime.regions[0];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const hit = resolveSelectionHit(layout, runtime, {
    x: measureCaretTarget(layout, runtime, {
      regionId: paragraphContainer.id,
      offset: 10,
    })!.left,
    y: layout.lines[0]!.top + 2,
  });

  expect(hit?.regionId).toBe(paragraphContainer.id);
  expect(hit?.offset).toBe(10);
});

test("hit-tests the second line of a multi-line wrapped paragraph", () => {
  const runtime = createDocumentIndex(
    parseDocument(
      `This is a long paragraph that will wrap to multiple lines when laid out at a narrow width for testing.\n`,
    ),
  );
  const state = createEditorState(runtime.document);
  const layout = createDocumentLayout(runtime, {
    width: 200,
  });
  const container = runtime.regions[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const regionLines = layout.lines.filter((line) => line.regionId === container.id);

  expect(regionLines.length).toBeGreaterThan(1);

  const secondLine = regionLines[1]!;

  // Use resolveEditorHitAtPoint — the same two-phase path the click handler
  // takes — to verify that clicking in the middle of line 2 resolves to an
  // offset within line 2, not line 1.
  const hit = resolveEditorHitAtPoint(layout, state, {
    x: secondLine.left + 20,
    y: secondLine.top + secondLine.height / 2,
  });

  expect(hit?.regionId).toBe(container.id);
  expect(hit?.offset).toBeGreaterThanOrEqual(secondLine.start);
  expect(hit?.offset).toBeLessThanOrEqual(secondLine.end);
});

test("measures caret geometry for a container offset", () => {
  const runtime = createDocumentIndex(
    parseDocument(`# Caret

Paragraph for caret metrics.
`),
  );
  const layout = createDocumentLayout(runtime, {
    width: 220,
  });
  const paragraphContainer = runtime.regions[1];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const caret = measureCaretTarget(layout, runtime, {
    regionId: paragraphContainer.id,
    offset: 8,
  });

  expect(caret?.regionId).toBe(paragraphContainer.id);
  expect(caret?.offset).toBe(8);
  expect(caret?.left).toBeGreaterThan(layout.lines[1]!.left);
  expect(caret?.height).toBe(layout.options.lineHeight);
});

test("advances the active caret across collapsed trailing spaces", () => {
  const state = createEditorState(
    createDocument([
      createParagraphTextBlock({
        text: "alpha ",
      }),
    ]),
  );
  const layout = createDocumentLayout(state.documentIndex, {
    width: 320,
  });
  const paragraphContainer = state.documentIndex.regions[0];

  if (!paragraphContainer) {
    throw new Error("Expected paragraph container");
  }

  const beforeSpace = measureCaretTarget(layout, state.documentIndex, {
    regionId: paragraphContainer.id,
    offset: 5,
  });
  const afterSpace = measureCaretTarget(layout, state.documentIndex, {
    regionId: paragraphContainer.id,
    offset: 6,
  });

  if (!beforeSpace || !afterSpace) {
    throw new Error("Expected paragraph carets");
  }

  expect(resolveCaretVisualLeft(state, layout, afterSpace)).toBeGreaterThan(
    resolveCaretVisualLeft(state, layout, beforeSpace),
  );
});

test("lays out table cells side by side within the same row", () => {
  const runtime = createDocumentIndex(
    parseDocument(`| Name | Value |
| ---- | ----- |
| One  | Two   |
`),
  );
  const layout = createDocumentLayout(runtime, {
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
  const cache = createCanvasRenderCache();
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

  createDocumentLayout(
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

  createDocumentLayout(
    replaced.documentIndex,
    {
      width: 420,
    },
    cache,
  );

  expect(cache.measuredLines.size).toBe(initialMeasuredLineCount + 1);
});

test("hit-tests the correct table column within the same row band", () => {
  const runtime = createDocumentIndex(
    parseDocument(`| Layer | Narrow host | Wide host |
| :---- | :---------- | --------: |
| Editor | stable | 640 |
`),
  );
  const layout = createDocumentLayout(runtime, {
    width: 640,
  });
  const headerValue = layout.lines.find((line) => line.text === "Wide host");

  if (!headerValue) {
    throw new Error("Expected wide-host header line");
  }

  const extent = layout.regionBounds.get(headerValue.regionId);

  if (!extent) {
    throw new Error("Expected table cell bounds");
  }

  const hit = resolveSelectionHit(layout, runtime, {
    x: extent.left + 8,
    y: headerValue.top + 4,
  });

  expect(hit?.regionId).toBe(headerValue.regionId);
});

test("hit-tests the clicked table cell even below its text content", () => {
  const runtime = createDocumentIndex(
    parseDocument(`| Short | Much wider content that wraps |
| :---- | :---------------------------- |
| One | Two three four five six seven |
`),
  );
  const layout = createDocumentLayout(runtime, {
    width: 360,
  });
  const shortCellLine = layout.lines.find((line) => line.text === "One");

  if (!shortCellLine) {
    throw new Error("Expected short cell line");
  }

  const extent = layout.regionBounds.get(shortCellLine.regionId);

  if (!extent) {
    throw new Error("Expected short cell bounds");
  }

  const hit = resolveSelectionHit(layout, runtime, {
    x: extent.left + 8,
    y: extent.bottom - 6,
  });

  expect(hit?.regionId).toBe(shortCellLine.regionId);
  expect(hit?.offset).toBe(0);
});

test("keeps an empty layout line and caret target for inserted empty blocks", () => {
  let state = createEditorState(parseDocument("# Heading\n"));
  state = insertLineBreak(state) ?? state;

  const layout = createDocumentLayout(state.documentIndex, {
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

test("recomputes cached line boundaries when inline mark state changes", () => {
  const cache = createCanvasRenderCache();
  let state = createEditorState(parseDocument("WWWWW WWWWW WWWWW"));
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  const plainLayout = createDocumentLayout(
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
  state = toggleBold(state) ?? state;

  const markedLayout = createDocumentLayout(
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
  };
  const layout = createDocumentLayout(
    runtime,
    {
      width: 420,
    },
    createCanvasRenderCache(),
    resources,
  );

  expect(layout.lines[0]?.width).toBe(120);
  expect(layout.lines[0]?.height).toBe(68);
});

test("hit-tests image runs as atomic before-or-after caret stops", () => {
  const runtime = createDocumentIndex(
    parseDocument("before ![alt](https://example.com/image.png) after\n"),
  );
  const resources: DocumentResources = {
    images: new Map([
      [
        "https://example.com/image.png",
        {
          intrinsicHeight: 120,
          intrinsicWidth: 160,
          source: null,
          status: "loaded",
        },
      ],
    ]),
  };
  const layout = createDocumentLayout(runtime, { width: 520 }, undefined, resources);
  const line = layout.lines[0];
  const paragraph = runtime.regions[0];

  if (!line || !paragraph) {
    throw new Error("Expected image paragraph layout");
  }

  const imageRun = paragraph.inlines.find((run) => run.kind === "image");

  if (!imageRun) {
    throw new Error("Expected image run");
  }

  const beforeImage = measureCaretTarget(layout, runtime, {
    regionId: paragraph.id,
    offset: imageRun.start,
  });
  const afterImage = measureCaretTarget(layout, runtime, {
    regionId: paragraph.id,
    offset: imageRun.end,
  });

  if (!beforeImage || !afterImage) {
    throw new Error("Expected image caret targets");
  }

  const leftHit = resolveSelectionHit(layout, runtime, {
    x: beforeImage.left + (afterImage.left - beforeImage.left) * 0.25,
    y: line.top + line.height / 2,
  });
  const rightHit = resolveSelectionHit(layout, runtime, {
    x: beforeImage.left + (afterImage.left - beforeImage.left) * 0.75,
    y: line.top + line.height / 2,
  });

  expect(leftHit?.offset).toBe(imageRun.start);
  expect(rightHit?.offset).toBe(imageRun.end);
});
