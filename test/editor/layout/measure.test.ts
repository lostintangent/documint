import { expect, test } from "bun:test";
import { createCanvasRenderCache } from "@/editor/canvas/lib/cache";
import {
  createDocumentIndex,
  insertLineBreak,
  setSelection,
  toggleBold,
} from "@/editor/state";
import { spliceText } from "@/editor/state/reducer/text";
import { createDocumentLayout, measureCaretTarget } from "@/editor/layout";
import { parseDocument } from "@/markdown";
import type { DocumentResources } from "@/types";
import { getRegion, setup } from "../helpers";

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

test("forces a wrap on inline line break runs even at large widths", () => {
  // A paragraph with an inline `<br>` must split into two layout lines no
  // matter how wide the canvas is. The fast Pretext path doesn't honor `\n`
  // as a hard break under `whiteSpace: "normal"`, so the layout has to
  // route any region containing a `lineBreak` run through the measured
  // path that emits a forced break on `\n` segments.
  const state = setup("foo<br>\nbar\n");
  const region = getRegion(state, "foo\nbar");
  const layout = createDocumentLayout(state.documentIndex, { width: 4000 });
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
  const layout = createDocumentLayout(state.documentIndex, { width: 4000 });
  const containerLines = layout.lines.filter((line) => line.regionId === region.id);

  expect(containerLines.length).toBe(2);
  expect(containerLines[0]?.text).toBe("foo");
  expect(containerLines[1]?.text).toBe("");
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

test("keeps an empty layout line and caret target for inserted empty blocks", () => {
  let state = setup("# Heading\n");
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
  let state = setup("WWWWW WWWWW WWWWW");
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
