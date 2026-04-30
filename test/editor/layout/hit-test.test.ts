import { expect, test } from "bun:test";
import { createCanvasRenderCache, createEditorState, prepareViewport, resolveHoverTarget } from "@/editor";
import {
  createDocumentLayout,
  resolveDragFocusPoint,
  resolveLinkHitAtPoint,
} from "@/editor/layout";
import { parseDocument } from "@/markdown";

test("resolves link hits from document-space coordinates over linked text", () => {
  const state = createEditorState(parseDocument("[alpha](https://example.com) tail\n"));
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
  const state = createEditorState(parseDocument("alpha beta\n"));
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
  const state = createEditorState(parseDocument("alpha\n\nbeta\n"));
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
  const state = createEditorState(parseDocument("alpha beta\n"));
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

test("resolves task-toggle hover targets ahead of text hits", () => {
  const renderCache = createCanvasRenderCache();
  const state = createEditorState(parseDocument("- [ ] Review task\n"));
  const viewport = prepareViewport(state, { height: 320, top: 0, width: 520 }, renderCache);
  const line = viewport.layout.lines[0];
  const listItem = state.documentIndex.blocks.find((block) => block.type === "listItem");

  if (!line || !listItem) throw new Error("Expected task list line");

  const hover = resolveHoverTarget(state, viewport, { x: line.left + 6, y: line.top + line.height / 2 }, []);

  expect(hover).toEqual({ kind: "task-toggle", listItemId: listItem.id });
});
