import { expect, test } from "bun:test";
import { createCanvasRenderCache, prepareLayout, resolveHoverTarget } from "@/editor";
import { createDocumentIndex } from "@/editor/state";
import {
  createDocumentLayout,
  measureCaretTarget,
  resolveDragFocusPoint,
  resolveEditorHitAtPoint,
  resolveLinkHitAtPoint,
  resolveSelectionHit,
} from "@/editor/layout";
import { parseDocument } from "@/markdown";
import type { DocumentResources } from "@/types";
import { getRegion, setup } from "../../helpers";

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
  const state = setup(
    `This is a long paragraph that will wrap to multiple lines when laid out at a narrow width for testing.\n`,
  );
  const layout = createDocumentLayout(state.documentIndex, {
    width: 200,
  });
  const container = state.documentIndex.regions[0];

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

test("resolves link hits from document-space coordinates over linked text", () => {
  const state = setup("[alpha](https://example.com) tail\n");
  const layout = createDocumentLayout(state.documentIndex, {
    width: 320,
  });
  const line = layout.lines[0];

  if (!line) {
    throw new Error("Expected first layout line");
  }

  expect(
    resolveLinkHitAtPoint(layout, state, {
      x: line.left + 4,
      y: line.top + 4,
    })?.url,
  ).toBe("https://example.com");
});

test("resolves drag focus to the anchor start above the prepared layout", () => {
  const state = setup("alpha beta\n");
  const layout = createDocumentLayout(state.documentIndex, {
    width: 320,
  });
  const region = state.documentIndex.regions[0];
  const firstLine = layout.lines[0];

  if (!region || !firstLine) {
    throw new Error("Expected first region and first layout line");
  }

  expect(
    resolveDragFocusPoint(
      layout,
      state,
      {
        x: firstLine.left,
        y: firstLine.top - 40,
      },
      {
        regionId: region.id,
        offset: 4,
      },
    ),
  ).toEqual({
    offset: 0,
    regionId: region.id,
  });
});

test("resolves drag focus into a different region instead of clamping to the anchor", () => {
  const state = setup("alpha\n\nbeta\n");
  const layout = createDocumentLayout(state.documentIndex, {
    width: 320,
  });
  const [firstRegion, secondRegion] = state.documentIndex.regions;

  if (!firstRegion || !secondRegion) {
    throw new Error("Expected two paragraph regions");
  }

  const secondLine = layout.lines.find((line) => line.regionId === secondRegion.id);

  if (!secondLine) {
    throw new Error("Expected a layout line for the second region");
  }

  expect(
    resolveDragFocusPoint(
      layout,
      state,
      {
        x: secondLine.left + 4,
        y: secondLine.top + secondLine.height / 2,
      },
      {
        regionId: firstRegion.id,
        offset: 2,
      },
    ),
  ).toEqual({
    offset: expect.any(Number),
    regionId: secondRegion.id,
  });
});

test("resolves drag focus to the anchor end below the prepared layout", () => {
  const state = setup("alpha beta\n");
  const layout = createDocumentLayout(state.documentIndex, {
    width: 320,
  });
  const region = state.documentIndex.regions[0];
  const lastLine = layout.lines.at(-1);

  if (!region || !lastLine) {
    throw new Error("Expected first region and last layout line");
  }

  expect(
    resolveDragFocusPoint(
      layout,
      state,
      {
        x: lastLine.left,
        y: lastLine.top + lastLine.height + 40,
      },
      {
        regionId: region.id,
        offset: 4,
      },
    ),
  ).toEqual({
    offset: region.text.length,
    regionId: region.id,
  });
});

test("resolves a click on the trailing empty line below a soft break to its post-break offset", () => {
  // After Shift+Enter at end-of-content, the layout materializes an empty
  // trailing line at `[lastSegment.end, lastSegment.end]` so the caret has
  // somewhere to land. This locks down that clicking on that visible empty
  // line resolves to the offset just past the soft break — anything else
  // would leave the caret unable to follow the user's click.
  const state = setup("foo<br>\n");
  const region = getRegion(state, "foo\n");
  const layout = createDocumentLayout(state.documentIndex, { width: 320 });

  const trailingLine = layout.lines.find(
    (line) => line.regionId === region.id && line.text === "",
  );

  if (!trailingLine) {
    throw new Error("Expected a trailing empty line for the soft break");
  }

  const hit = resolveSelectionHit(layout, state.documentIndex, {
    x: trailingLine.left + 4,
    y: trailingLine.top + trailingLine.height / 2,
  });

  expect(hit?.regionId).toBe(region.id);
  expect(hit?.offset).toBe(region.text.length);
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

test("resolves task-toggle hover targets ahead of text hits", () => {
  const renderCache = createCanvasRenderCache();
  const state = setup("- [ ] Review task\n");
  const viewport = prepareLayout(state, { height: 320, top: 0, width: 520 }, renderCache);
  const line = viewport.layout.lines[0];
  const listItem = state.documentIndex.blocks.find((block) => block.type === "listItem");

  if (!line || !listItem) throw new Error("Expected task list line");

  const hover = resolveHoverTarget(state, viewport, { x: line.left + 6, y: line.top + line.height / 2 }, []);

  expect(hover).toEqual({ kind: "task-toggle", listItemId: listItem.id });
});

test("clicks on an inert leaf block redirect to the start of the next region in flow", () => {
  // The divider is an inert leaf — it has no region, so it can't be a
  // caret target itself. A click anywhere in its geometry slot should
  // land the caret at the beginning of the next region rather than
  // returning null (which would feel like a dead area). Goes through
  // `resolveEditorHitAtPoint` — the editor-level path that the user-
  // facing pointer handler uses (`usePointer` → `resolveSelectionHit`
  // → `resolveLayoutSelectionHit` → `resolveEditorHitAtPoint`).
  const state = setup("First paragraph.\n\n---\n\nSecond paragraph.\n");
  const layout = createDocumentLayout(state.documentIndex, { width: 480 });
  const dividerBlock = layout.blocks.find((b) => b.type === "divider");
  const second = getRegion(state, "Second paragraph.");

  if (!dividerBlock) throw new Error("Expected divider block in layout");

  const dividerCenterY = (dividerBlock.top + dividerBlock.bottom) / 2;
  const hit = resolveEditorHitAtPoint(layout, state, { x: 200, y: dividerCenterY });

  expect(hit?.regionId).toBe(second.id);
  expect(hit?.offset).toBe(0);
});
