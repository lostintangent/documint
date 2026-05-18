// Integration tests for the canvas paint pipeline. Each test drives
// `paintContent` end to end with a recording context and asserts against
// the resulting operation sequence — covering pass ordering, pixel
// geometry, and inter-painter interactions that are hard to verify in
// isolation.

import { expect, test } from "bun:test";
import { paintContent } from "@/renderer";
import { createEditorLayoutState } from "@/editor/layout";
import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import {
  insertText,
  normalizeSelection,
  setSelection,
  type EditorState,
} from "@/editor/state";
import { lightTheme } from "@/component/lib/themes";
import type { EditorTheme } from "@/types";
import { setup } from "../editor/helpers";
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

test("paints insert highlights as a glyph overlay without splitting text runs", () => {
  let state = setup("alpha\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph region");
  }

  state = setSelection(state, { regionId: container.id, offset: container.text.length });
  state = insertText(state, "!") ?? state;

  const { context } = renderPaintOperations(state, { height: 180, width: 240 });
  const textOperations = context.operations.filter(
    (operation): operation is Extract<RecordingOperation, { kind: "fillText" }> =>
      operation.kind === "fillText",
  );
  const insertedCharacterPaint = textOperations.find((operation) => operation.text === "!");
  const baseTextPaint = textOperations.find(
    (operation) => operation.text === "alpha!" && operation.fillStyle === lightTheme.paragraphText,
  );
  const highlightOverlayPaint = textOperations.find(
    (operation) =>
      operation.text === "alpha!" && operation.fillStyle === lightTheme.insertHighlightText,
  );

  expect(insertedCharacterPaint).toBeUndefined();
  expect(baseTextPaint).toBeDefined();
  expect(highlightOverlayPaint).toBeDefined();
  expect(highlightOverlayPaint?.globalAlpha).toBeGreaterThan(0);
  expect(highlightOverlayPaint?.globalAlpha).toBeLessThanOrEqual(1);
});

test("paints text color decorations as a glyph overlay without splitting text runs", () => {
  const state = setup("alpha beta\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph region");
  }

  const { context } = renderPaintOperations(state, {
    height: 180,
    textDecorations: new Map([
      [
        container.path,
        [
          {
            color: "#c026d3",
            endOffset: 10,
            path: container.path,
            startOffset: 6,
          },
        ],
      ],
    ]),
    width: 240,
  });
  const textOperations = context.operations.filter(
    (operation): operation is Extract<RecordingOperation, { kind: "fillText" }> =>
      operation.kind === "fillText",
  );
  const splitDecorationPaint = textOperations.find((operation) => operation.text === "beta");
  const baseTextPaint = textOperations.find(
    (operation) =>
      operation.text === "alpha beta" &&
      operation.fillStyle === lightTheme.paragraphText &&
      operation.globalCompositeOperation === "source-over",
  );
  const decorationMaskPaint = textOperations.find(
    (operation) =>
      operation.text === "alpha beta" && operation.globalCompositeOperation === "destination-out",
  );
  const decorationOverlayPaint = textOperations.find(
    (operation) =>
      operation.text === "alpha beta" &&
      operation.fillStyle === "#c026d3" &&
      operation.globalCompositeOperation === "source-over",
  );

  expect(splitDecorationPaint).toBeUndefined();
  expect(baseTextPaint).toBeDefined();
  expect(decorationMaskPaint).toBeDefined();
  expect(decorationOverlayPaint).toBeDefined();
});

test("paints text color decorations in table cells", () => {
  const state = setup(`| A | B |
| --- | --- |
| Cell target | Other |
`);
  const container = state.documentIndex.regions.find((region) => region.text === "Cell target");

  if (!container) {
    throw new Error("Expected table cell region");
  }

  const { context } = renderPaintOperations(state, {
    height: 240,
    textDecorations: new Map([
      [
        container.path,
        [
          {
            color: "#c026d3",
            endOffset: 11,
            path: container.path,
            startOffset: 5,
          },
        ],
      ],
    ]),
    width: 360,
  });
  const decorationOverlayPaint = context.operations.find((operation) => {
    return (
      operation.kind === "fillText" &&
      operation.text === "Cell target" &&
      operation.fillStyle === "#c026d3" &&
      operation.globalCompositeOperation === "source-over"
    );
  });

  expect(decorationOverlayPaint).toBeDefined();
});

test("paints decoration background colors behind text", () => {
  let state = setup("alpha TODO\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph region");
  }

  state = setSelection(state, {
    anchor: { regionId: container.id, offset: 6 },
    focus: { regionId: container.id, offset: 10 },
  });

  const { context, layout } = renderPaintOperations(state, {
    height: 180,
    textDecorations: new Map([
      [
        container.path,
        [
          {
            backgroundColor: "#fde047",
            color: "#111827",
            endOffset: 10,
            path: container.path,
            startOffset: 6,
          },
        ],
      ],
    ]),
    width: 240,
  });
  const backgroundPaintIndex = context.operations.findIndex(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === "#fde047",
  );
  const baseTextPaintIndex = context.operations.findIndex(
    (operation) =>
      operation.kind === "fillText" &&
      operation.text === "alpha TODO" &&
      operation.fillStyle === lightTheme.paragraphText,
  );
  const selectionPaintIndex = context.operations.findIndex(
    (operation) =>
      operation.kind === "fillRect" && operation.fillStyle === lightTheme.selectionBackground,
  );
  const textOverlayPaintIndex = context.operations.findIndex(
    (operation) =>
      operation.kind === "fillText" &&
      operation.text === "alpha TODO" &&
      operation.fillStyle === "#111827",
  );

  const line = layout.lines[0];
  const backgroundPaint = context.operations[backgroundPaintIndex];

  if (!line || !backgroundPaint || backgroundPaint.kind !== "fillRect") {
    throw new Error("Expected decoration background paint");
  }

  expect(backgroundPaintIndex).toBeGreaterThanOrEqual(0);
  expect(selectionPaintIndex).toBeGreaterThan(backgroundPaintIndex);
  expect(baseTextPaintIndex).toBeGreaterThan(backgroundPaintIndex);
  expect(textOverlayPaintIndex).toBeGreaterThan(baseTextPaintIndex);
  expect(backgroundPaint.y).toBeGreaterThanOrEqual(line.top);
  expect(backgroundPaint.height).toBeLessThan(line.height);
});

test("pulses animated decoration backgrounds with paint-time alpha", () => {
  const state = setup("alpha sparkle\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph region");
  }

  const textDecorations = new Map([
    [
      container.path,
      [
        {
          backgroundColor: "#facc15",
          pulse: true,
          color: "#713f12",
          endOffset: 13,
          path: container.path,
          startOffset: 6,
        },
      ],
    ],
  ]);
  const { context } = renderPaintOperations(state, {
    height: 180,
    now: 550,
    textDecorations,
    width: 240,
  });
  const pulsingBackground = context.operations.find(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === "#facc15",
  );
  const pulsingTextOverlay = context.operations.find(
    (operation) =>
      operation.kind === "fillText" &&
      operation.text.includes("sparkle") &&
      operation.fillStyle !== lightTheme.paragraphText &&
      operation.globalCompositeOperation === "source-over",
  );

  if (!pulsingBackground || pulsingBackground.kind !== "fillRect") {
    throw new Error("Expected pulsing decoration background");
  }
  if (!pulsingTextOverlay || pulsingTextOverlay.kind !== "fillText") {
    throw new Error("Expected pulsing decoration text color");
  }

  expect(pulsingBackground.globalAlpha).toBeCloseTo(0.71);
  expect(pulsingTextOverlay.globalAlpha).toBe(1);
  expect(pulsingTextOverlay.globalCompositeOperation).toBe("source-over");
  expect(pulsingTextOverlay.fillStyle).not.toBe("#713f12");
  expect(pulsingTextOverlay.fillStyle).not.toBe(lightTheme.paragraphText);

  const { context: transparentContext } = renderPaintOperations(state, {
    height: 180,
    now: 1100,
    textDecorations,
    width: 240,
  });
  const transparentTextOverlay = transparentContext.operations.find(
    (operation) =>
      operation.kind === "fillText" &&
      operation.text.includes("sparkle") &&
      operation.fillStyle !== lightTheme.paragraphText &&
      operation.globalCompositeOperation === "source-over",
  );
  const transparentBackground = transparentContext.operations.find(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === "#facc15",
  );

  if (!transparentBackground || transparentBackground.kind !== "fillRect") {
    throw new Error("Expected pulsing decoration background at pulse floor");
  }
  if (!transparentTextOverlay || transparentTextOverlay.kind !== "fillText") {
    throw new Error("Expected pulsing decoration text color at pulse floor");
  }

  expect(transparentBackground.globalAlpha).toBeCloseTo(0.42);
  expect(transparentTextOverlay.globalAlpha).toBe(1);
  expect(transparentTextOverlay.fillStyle).not.toBe("#713f12");
  expect(transparentTextOverlay.fillStyle).not.toBe(lightTheme.paragraphText);

  const { context: pausedContext } = renderPaintOperations(state, {
    ambientAnimationTime: 1100,
    height: 180,
    now: 1650,
    textDecorations,
    width: 240,
  });
  const pausedBackground = pausedContext.operations.find(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === "#facc15",
  );

  if (!pausedBackground || pausedBackground.kind !== "fillRect") {
    throw new Error("Expected paused decoration background");
  }

  expect(pausedBackground.globalAlpha).toBeCloseTo(0.42);

  const { context: resumedContext } = renderPaintOperations(state, {
    ambientAnimationTime: 1100,
    height: 180,
    now: 2200,
    textDecorations,
    width: 240,
  });
  const resumedBackground = resumedContext.operations.find(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === "#facc15",
  );

  if (!resumedBackground || resumedBackground.kind !== "fillRect") {
    throw new Error("Expected resumed decoration background");
  }

  expect(resumedBackground.globalAlpha).toBeCloseTo(pausedBackground.globalAlpha);
});

test("pulses presence-active comment highlights with the ambient animation clock", () => {
  const state = setup("alpha comment\n");
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected paragraph region");
  }

  const { context } = renderPaintOperations(state, {
    ambientAnimationTime: 1100,
    height: 180,
    commentRanges: [
      {
        endOffset: 13,
        regionId: region.id,
        resolution: { match: null, repair: null, status: "stale" },
        resolved: false,
        startOffset: 6,
        threadIndex: 2,
      },
    ],
    commentPresence: new Map([[2, createCommentPresence(2, "#f97316")]]),
    width: 240,
  });
  const commentHighlight = context.operations.find(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === "#f97316",
  );

  if (!commentHighlight || commentHighlight.kind !== "fillRect") {
    throw new Error("Expected presence-pulsed comment highlight");
  }

  expect(commentHighlight.globalAlpha).toBeCloseTo(0.42);
});

test("falls back to the leaf accent when presence has no color", () => {
  const state = setup("alpha comment\n");
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected paragraph region");
  }

  const { context } = renderPaintOperations(state, {
    height: 180,
    commentRanges: [
      {
        endOffset: 13,
        regionId: region.id,
        resolution: { match: null, repair: null, status: "stale" },
        resolved: false,
        startOffset: 6,
        threadIndex: 2,
      },
    ],
    commentPresence: new Map([[2, createCommentPresence(2)]]),
    width: 240,
  });
  const commentHighlight = context.operations.find(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === lightTheme.leafAccent,
  );

  expect(commentHighlight).toEqual(expect.objectContaining({ kind: "fillRect" }));
});

test("paints inline code background with text background geometry", () => {
  const state = setup("alpha `TODO` beta\n");
  const { context, layout } = renderPaintOperations(state, {
    height: 180,
    width: 240,
  });
  const backgroundPaintIndex = context.operations.findIndex(
    (operation) =>
      operation.kind === "fillRect" && operation.fillStyle === lightTheme.inlineCodeBackground,
  );
  const codeTextPaintIndex = context.operations.findIndex(
    (operation) =>
      operation.kind === "fillText" &&
      operation.text === "TODO" &&
      operation.fillStyle === lightTheme.inlineCodeText,
  );
  const line = layout.lines[0];
  const backgroundPaint = context.operations[backgroundPaintIndex];
  const codeTextPaint = context.operations[codeTextPaintIndex];

  if (!line || !backgroundPaint || backgroundPaint.kind !== "fillRect") {
    throw new Error("Expected inline code background paint");
  }

  if (!codeTextPaint || codeTextPaint.kind !== "fillText") {
    throw new Error("Expected inline code text paint");
  }

  expect(backgroundPaintIndex).toBeGreaterThanOrEqual(0);
  expect(codeTextPaintIndex).toBeGreaterThan(backgroundPaintIndex);
  expect(codeTextPaint.font).toContain("ui-monospace");
  expect(backgroundPaint.y).toBeGreaterThanOrEqual(line.top);
  expect(backgroundPaint.height).toBeLessThan(line.height);
});

test("keeps inline code and decoration background heights visually aligned", () => {
  const state = setup("alpha `TODO` beta\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected paragraph region");
  }

  const { context } = renderPaintOperations(state, {
    height: 180,
    textDecorations: new Map([
      [
        container.path,
        [
          {
            backgroundColor: "#fde047",
            endOffset: 4,
            path: container.path,
            startOffset: 0,
          },
        ],
      ],
    ]),
    width: 240,
  });
  const decorationBackground = context.operations.find(
    (operation) => operation.kind === "fillRect" && operation.fillStyle === "#fde047",
  );
  const inlineCodeBackground = context.operations.find(
    (operation) =>
      operation.kind === "fillRect" && operation.fillStyle === lightTheme.inlineCodeBackground,
  );

  if (
    !decorationBackground ||
    decorationBackground.kind !== "fillRect" ||
    !inlineCodeBackground ||
    inlineCodeBackground.kind !== "fillRect"
  ) {
    throw new Error("Expected text background paints");
  }

  expect(Math.abs(inlineCodeBackground.height - decorationBackground.height)).toBeLessThanOrEqual(
    1,
  );
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

test("uses explicit list marker text color when provided", () => {
  const state = setup("- bullet\n");
  const theme: EditorTheme = {
    ...lightTheme,
    listMarkerText: "#f97316",
    paragraphText: "#14532d",
  };
  const { context } = renderPaintOperations(state, { height: 180, theme, width: 240 });
  const marker = findFillTextOperation(context.operations, "•");
  const text = findFillTextOperation(context.operations, "bullet");

  if (!marker || !text) {
    throw new Error("Expected list marker and text paint operations");
  }

  expect(marker.fillStyle).toBe("#f97316");
  expect(text.fillStyle).toBe("#14532d");
});

test("falls back to paragraph text color when list marker color is omitted", () => {
  const state = setup("- bullet\n");
  const theme: EditorTheme = {
    ...lightTheme,
    paragraphText: "#14532d",
  };

  const { context } = renderPaintOperations(state, { height: 180, theme, width: 240 });
  const marker = findFillTextOperation(context.operations, "•");
  const text = findFillTextOperation(context.operations, "bullet");

  if (!marker || !text) {
    throw new Error("Expected list marker and text paint operations");
  }

  expect(marker.fillStyle).toBe("#14532d");
  expect(text.fillStyle).toBe("#14532d");
});

function renderPaintOperations(
  state: EditorState,
  options: {
    ambientAnimationTime?: number;
    height: number;
    commentRanges?: EditorCommentRange[];
    now?: number;
    commentPresence?: ReadonlyMap<number, EditorPresence>;
    textDecorations?: TextDecorationIndex;
    theme?: EditorTheme;
    width: number;
  },
) {
  const layoutState = createEditorLayoutState(state, {
    height: options.height,
    top: 0,
    width: options.width,
  });
  const context = new RecordingCanvasContext();

  paintContent(state, layoutState, context as unknown as CanvasRenderingContext2D, {
    activeBlockId:
      state.documentIndex.regionIndex.get(state.selection.focus.regionId)?.blockId ?? null,
    activeRegionId: state.selection.focus.regionId,
    activeThreadIndex: null,
    ambientAnimationTime: options.ambientAnimationTime,
    devicePixelRatio: 1,
    height: options.height,
    commentRanges: options.commentRanges ?? [],
    normalizedSelection: normalizeSelection(state),
    commentPresence: options.commentPresence,
    now: options.now,
    textDecorations: options.textDecorations,
    theme: options.theme ?? lightTheme,
    width: options.width,
  });

  return {
    context,
    layout: layoutState.layout,
  };
}

function createCommentPresence(threadIndex: number, color?: string): EditorPresence {
  return {
    ...(color ? { color } : {}),
    commentThreadIndex: threadIndex,
    cursorPoint: null,
    id: "user",
    username: "User",
    viewport: null,
  };
}
