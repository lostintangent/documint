// Integration tests for the canvas paint pipeline. Each test drives
// `paintCanvasEditorSurface` end to end with a recording context and asserts
// against the resulting operation sequence — covering pass ordering, pixel
// geometry, and inter-painter interactions that are hard to verify in
// isolation.

import { expect, test } from "bun:test";
import type { Block } from "@/document";
import { paintCanvasEditorSurface } from "@/editor/canvas";
import { createDocumentLayout } from "@/editor/layout";
import { setSelection, type EditorState } from "@/editor/state";
import { lightTheme } from "@/component/lib/themes";
import { setup } from "../helpers";
import {
  approximately,
  findFillTextOperation,
  findLastOperationIndex,
  findOperationIndex,
  RecordingCanvasContext,
  type RecordingOperation,
} from "./helpers";

test("paints active table highlights only within the active cell before text", () => {
  let state = setup(`| Left | Active | Right |
| --- | --- | --- |
| one | two | three |
`);
  const activeContainer = state.documentIndex.regions.find((entry) => entry.text === "Active");
  const rightContainer = state.documentIndex.regions.find((entry) => entry.text === "Right");

  if (!activeContainer || !rightContainer) {
    throw new Error("Expected table header cells");
  }

  state = setSelection(state, {
    regionId: activeContainer.id,
    offset: 1,
  });

  const { context, layout } = renderPaintOperations(state, { height: 240, width: 480 });
  const activeBounds = layout.regionBounds.get(activeContainer.id);
  const rightBounds = layout.regionBounds.get(rightContainer.id);

  if (!activeBounds || !rightBounds) {
    throw new Error("Expected active table cell bounds");
  }

  const rightCellBackgroundIndex = findOperationIndex(context.operations, (operation) => {
    return (
      operation.kind === "fillRect" &&
      operation.fillStyle === lightTheme.tableHeaderBackground &&
      approximately(operation.x, rightBounds.left) &&
      approximately(operation.y, rightBounds.top)
    );
  });
  const activeHighlightIndex = findOperationIndex(context.operations, (operation) => {
    return (
      operation.kind === "fillRect" &&
      operation.fillStyle === lightTheme.activeBlockBackground &&
      approximately(operation.x, activeBounds.left) &&
      approximately(operation.width, activeBounds.right - activeBounds.left)
    );
  });
  const activeHighlight = context.operations[activeHighlightIndex];
  const activeBorderIndex = findLastOperationIndex(context.operations, (operation) => {
    return (
      operation.kind === "strokeRect" &&
      operation.strokeStyle === lightTheme.tableBorder &&
      approximately(operation.x, activeBounds.left) &&
      approximately(operation.y, activeBounds.top)
    );
  });
  const activeCellTextIndex = findOperationIndex(context.operations, (operation) => {
    return operation.kind === "fillText" && operation.text === "Active";
  });

  expect(rightCellBackgroundIndex).toBeGreaterThanOrEqual(0);
  expect(activeHighlightIndex).toBeGreaterThan(rightCellBackgroundIndex);
  expect(activeBorderIndex).toBeGreaterThan(activeHighlightIndex);
  expect(activeCellTextIndex).toBeGreaterThan(activeBorderIndex);

  if (!activeHighlight || activeHighlight.kind !== "fillRect") {
    throw new Error("Expected active table highlight fill");
  }

  expect(activeHighlight.x + activeHighlight.width).toBeLessThanOrEqual(rightBounds.left);
});

test("keeps non-table active block highlights full width", () => {
  let state = setup("alpha beta gamma\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    regionId: container.id,
    offset: 1,
  });

  const { context } = renderPaintOperations(state, { height: 180, width: 240 });

  const activeHighlightIndex = findOperationIndex(context.operations, (operation) => {
    return (
      operation.kind === "fillRect" &&
      operation.fillStyle === lightTheme.activeBlockBackground &&
      approximately(operation.x, 0) &&
      approximately(operation.width, 240)
    );
  });
  const activeHighlight = context.operations[activeHighlightIndex];
  const textIndex = findOperationIndex(context.operations, (operation) => {
    return operation.kind === "fillText" && operation.text === "alpha beta gamma";
  });

  expect(activeHighlightIndex).toBeGreaterThanOrEqual(0);
  expect(textIndex).toBeGreaterThan(activeHighlightIndex);

  if (!activeHighlight || activeHighlight.kind !== "fillRect") {
    throw new Error("Expected paragraph highlight fill");
  }
});

test("paints selection highlights across every region the selection spans", () => {
  let state = setup("alpha\n\nbeta\n\ngamma\n");
  const [first, second, third] = state.documentIndex.regions;

  if (!first || !second || !third) {
    throw new Error("Expected three paragraph regions");
  }

  state = setSelection(state, {
    anchor: { regionId: first.id, offset: 2 },
    focus: { regionId: third.id, offset: 3 },
  });

  const { context, layout } = renderPaintOperations(state, { height: 240, width: 240 });

  const selectionFills = context.operations.filter(
    (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
      operation.kind === "fillRect" && operation.fillStyle === lightTheme.selectionBackground,
  );

  expect(selectionFills.length).toBe(3);

  const firstLine = layout.lines.find((line) => line.regionId === first.id);
  const secondLine = layout.lines.find((line) => line.regionId === second.id);
  const thirdLine = layout.lines.find((line) => line.regionId === third.id);

  if (!firstLine || !secondLine || !thirdLine) {
    throw new Error("Expected one line per paragraph region");
  }

  const fillForLine = (line: typeof firstLine) =>
    selectionFills.find(
      (operation) => operation.y >= line.top && operation.y <= line.top + line.height,
    );

  const firstFill = fillForLine(firstLine);
  const middleFill = fillForLine(secondLine);
  const lastFill = fillForLine(thirdLine);

  if (!firstFill || !middleFill || !lastFill) {
    throw new Error("Expected one selection fill per spanned region");
  }

  // The middle region paints whole-line; both boundary regions are clipped to
  // the selection offsets and therefore cover a strict subset of the middle.
  expect(firstFill.x).toBeGreaterThan(middleFill.x);
  expect(lastFill.x + lastFill.width).toBeLessThan(middleFill.x + middleFill.width);
});

test("does not paint a selection highlight when the selection is collapsed", () => {
  let state = setup("alpha\n\nbeta\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph region");
  }

  state = setSelection(state, { regionId: container.id, offset: 2 });

  const { context } = renderPaintOperations(state, { height: 180, width: 240 });

  const selectionFillIndex = findOperationIndex(
    context.operations,
    (operation) =>
      operation.kind === "fillRect" && operation.fillStyle === lightTheme.selectionBackground,
  );

  expect(selectionFillIndex).toBe(-1);
});

test("right-aligns ordered list markers without moving list text", () => {
  const orderedListMarkerGap = 8;
  const state = setup(`
1. one
2. two
3. three
4. four
5. five
6. six
7. seven
8. eight
9. nine
10. ten

- bullet
`);
  const { context } = renderPaintOperations(state, { height: 360, width: 320 });
  const markerOne = findFillTextOperation(context.operations, "1.");
  const markerTen = findFillTextOperation(context.operations, "10.");
  const textOne = findFillTextOperation(context.operations, "one");
  const textTen = findFillTextOperation(context.operations, "ten");
  const bulletMarker = findFillTextOperation(context.operations, "•");

  if (!markerOne || !markerTen || !textOne || !textTen || !bulletMarker) {
    throw new Error("Expected ordered and unordered list paint operations");
  }

  expect(markerTen.x).toBe(markerOne.x);
  expect(textTen.x).toBe(textOne.x);
  expect(markerOne.textAlign).toBe("right");
  expect(markerTen.textAlign).toBe("right");
  expect(markerOne.x).toBe(textOne.x - orderedListMarkerGap);
  expect(markerTen.x).toBe(textTen.x - orderedListMarkerGap);
  expect(bulletMarker.textAlign).toBe("start");
});

function renderPaintOperations(
  state: EditorState,
  options: {
    height: number;
    width: number;
  },
) {
  const layout = createDocumentLayout(state.documentIndex, { width: options.width });
  const context = new RecordingCanvasContext();

  paintCanvasEditorSurface({
    activeBlockId:
      state.documentIndex.regionIndex.get(state.selection.focus.regionId)?.blockId ?? null,
    activeRegionId: state.selection.focus.regionId,
    activeThreadIndex: null,
    containerLineBounds: new Map(layout.regionBounds),
    context: context as unknown as CanvasRenderingContext2D,
    devicePixelRatio: 1,
    editorState: state,
    height: options.height,
    layout,
    liveCommentRanges: [],
    normalizedSelection: {
      end: state.selection.focus,
      start: state.selection.anchor,
    },
    resources: { images: new Map() },
    runtimeBlockMap: createRuntimeBlockMap(state.documentIndex.document.blocks),
    theme: lightTheme,
    viewportTop: 0,
    width: options.width,
  });

  return {
    context,
    layout,
  };
}

function createRuntimeBlockMap(blocks: Block[]) {
  const entries = new Map<string, Block>();

  const visit = (candidateBlocks: Block[]) => {
    for (const block of candidateBlocks) {
      entries.set(block.id, block);

      if (block.type === "blockquote" || block.type === "listItem") {
        visit(block.children);
      } else if (block.type === "list") {
        visit(block.items);
      }
    }
  };

  visit(blocks);

  return entries;
}
