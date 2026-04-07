import { expect, test } from "bun:test";
import type { Block } from "@/document";
import { createDocumentLayout } from "@/editor/layout";
import { createEditorState, setCanvasSelection as setSelection } from "@/editor/model/state";
import { emptyDocumentResources } from "@/editor/resources";
import { paintCanvasEditorSurface } from "@/editor/render/paint";
import { lightEditorTheme } from "@/editor/render/theme";
import { parseMarkdown } from "@/markdown";

test("paints active table highlights only within the active cell before text", () => {
  let state = createEditorState(
    parseMarkdown(`| Left | Active | Right |
| --- | --- | --- |
| one | two | three |
`),
  );
  const activeContainer = state.documentEditor.regions.find((entry) => entry.text === "Active");
  const rightContainer = state.documentEditor.regions.find((entry) => entry.text === "Right");

  if (!activeContainer || !rightContainer) {
    throw new Error("Expected table header cells");
  }

  state = setSelection(state, {
    regionId: activeContainer.id,
    offset: 1,
  });

  const { context, layout } = renderPaintOperations(state, { height: 240, width: 480 });
  const activeExtent = layout.regionExtents.get(activeContainer.id);
  const rightExtent = layout.regionExtents.get(rightContainer.id);

  if (!activeExtent || !rightExtent) {
    throw new Error("Expected active table cell extents");
  }

  const rightCellBackgroundIndex = findOperationIndex(context.operations, (operation) => {
    return (
      operation.kind === "fillRect" &&
      operation.fillStyle === lightEditorTheme.tableHeaderBackground &&
      approximately(operation.x, rightExtent.left) &&
      approximately(operation.y, rightExtent.top)
    );
  });
  const activeHighlightIndex = findOperationIndex(context.operations, (operation) => {
    return (
      operation.kind === "fillRect" &&
      operation.fillStyle === lightEditorTheme.activeBlockBackground &&
      approximately(operation.x, activeExtent.left) &&
      approximately(operation.width, activeExtent.right - activeExtent.left)
    );
  });
  const activeHighlight = context.operations[activeHighlightIndex];
  const activeBorderIndex = findLastOperationIndex(context.operations, (operation) => {
    return (
      operation.kind === "strokeRect" &&
      operation.strokeStyle === lightEditorTheme.tableBorder &&
      approximately(operation.x, activeExtent.left) &&
      approximately(operation.y, activeExtent.top)
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

  expect(activeHighlight.x + activeHighlight.width).toBeLessThanOrEqual(rightExtent.left);
});

test("keeps non-table active block highlights full width", () => {
  let state = createEditorState(parseMarkdown("alpha beta gamma\n"));
  const container = state.documentEditor.regions[0];

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
      operation.fillStyle === lightEditorTheme.activeBlockBackground &&
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

test("right-aligns ordered list markers without moving list text", () => {
  const orderedListMarkerGap = 8;
  const state = createEditorState(parseMarkdown(`
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
`));
  const { context } = renderPaintOperations(state, { height: 360, width: 320 });
  const markerOne = findFillTextOperation(context.operations, "1.");
  const markerTen = findFillTextOperation(context.operations, "10.");
  const textOne = findFillTextOperation(context.operations, "one");
  const textTen = findFillTextOperation(context.operations, "ten");
  const bulletMarker = findFillTextOperation(context.operations, "•");

  if (
    !markerOne ||
    !markerTen ||
    !textOne ||
    !textTen ||
    !bulletMarker
  ) {
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

type RecordingOperation =
  | {
      kind: "fillRect";
      fillStyle: string | CanvasGradient | CanvasPattern;
      height: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      fillStyle: string | CanvasGradient | CanvasPattern;
      kind: "fillText";
      text: string;
      textAlign: CanvasTextAlign;
      x: number;
      y: number;
    }
  | {
      kind: "strokeRect";
      strokeStyle: string | CanvasGradient | CanvasPattern;
      height: number;
      width: number;
      x: number;
      y: number;
    };

class RecordingCanvasContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  font = "";
  lineWidth = 1;
  operations: RecordingOperation[] = [];
  strokeStyle: string | CanvasGradient | CanvasPattern = "";
  textAlign: CanvasTextAlign = "start";
  textBaseline: CanvasTextBaseline = "alphabetic";

  arc() {}

  beginPath() {}

  clearRect() {}

  fill() {}

  fillRect(x: number, y: number, width: number, height: number) {
    this.operations.push({
      fillStyle: this.fillStyle,
      height,
      kind: "fillRect",
      width,
      x,
      y,
    });
  }

  fillText(text: string, x: number, y: number) {
    this.operations.push({
      fillStyle: this.fillStyle,
      kind: "fillText",
      text,
      textAlign: this.textAlign,
      x,
      y,
    });
  }

  lineTo() {}

  moveTo() {}

  restore() {}

  roundRect() {}

  save() {}

  scale() {}

  stroke() {}

  strokeRect(x: number, y: number, width: number, height: number) {
    this.operations.push({
      height,
      kind: "strokeRect",
      strokeStyle: this.strokeStyle,
      width,
      x,
      y,
    });
  }

  translate() {}
}

function renderPaintOperations(
  state: ReturnType<typeof createEditorState>,
  options: {
    height: number;
    width: number;
  },
) {
  const layout = createDocumentLayout(state.documentEditor, { width: options.width });
  const context = new RecordingCanvasContext();

  paintCanvasEditorSurface({
    activeBlockId: state.documentEditor.regionIndex.get(state.selection.focus.regionId)?.blockId ?? null,
    activeRegionId: state.selection.focus.regionId,
    activeThreadIndex: null,
    containerLineExtents: new Map(layout.regionExtents),
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
    resources: emptyDocumentResources,
    runtimeBlockMap: createRuntimeBlockMap(state.documentEditor.document.blocks),
    theme: lightEditorTheme,
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

      if (
        block.type === "blockquote" ||
        block.type === "list" ||
        block.type === "listItem"
      ) {
        visit(block.children);
      }
    }
  };

  visit(blocks);

  return entries;
}

function approximately(left: number, right: number, epsilon = 0.01) {
  return Math.abs(left - right) <= epsilon;
}

function findOperationIndex(
  operations: RecordingOperation[],
  predicate: (operation: RecordingOperation) => boolean,
) {
  return operations.findIndex(predicate);
}

function findLastOperationIndex(
  operations: RecordingOperation[],
  predicate: (operation: RecordingOperation) => boolean,
) {
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    if (predicate(operations[index]!)) {
      return index;
    }
  }

  return -1;
}

function findFillTextOperation(
  operations: RecordingOperation[],
  text: string,
) {
  const operation = operations.find((candidate) => {
    return candidate.kind === "fillText" && candidate.text === text;
  });

  return operation?.kind === "fillText" ? operation : null;
}
