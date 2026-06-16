// Integration tests for the canvas paint pipeline. Each test drives
// `createDocumentFrame` + `paintDocumentFrame` with a recording context and asserts against
// the resulting operation sequence — covering pass ordering, pixel
// geometry, and inter-painter interactions that are hard to verify in
// isolation.

import { describe, expect, test } from "bun:test";
import {
  createDocumentFrame,
  paintDocumentFrame,
  type ActiveEditorEffect,
} from "@/renderer";
import type { DocumintEffects } from "@/types";
import { createEditorLayoutState } from "@/editor/layout";
import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import type { TextDecorationIndex } from "@/editor/text/decorations";
import {
  createEditorState,
  deleteBackward,
  insertLineBreak,
  insertText,
  normalizeSelection,
  readEditorEffects,
  setSelection,
  type EditorEffect,
  type EditorState,
} from "@/editor/state";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import { parseDocument } from "@/markdown";
import type { DocumentResourceIcon, DocumentResources, ResolvedEditorTheme } from "@/types";
import { fixtureOptions, slowSampleImagePath } from "../../playground/src/lib/data";
import { setup } from "../editor/helpers";
import {
  approximately,
  findFillTextOperation,
  findLastOperationIndex,
  findOperationIndex,
  RecordingCanvasContext,
  type RecordingOperation,
} from "./helpers";

const resolvedLightTheme = resolveEditorTheme(lightTheme);

describe("Block and chrome paint order", () => {
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
        operation.fillStyle === resolvedLightTheme.tableHeaderBackground &&
        approximately(operation.x, rightBounds.left) &&
        approximately(operation.y, rightBounds.top)
      );
    });
    const activeHighlightIndex = findOperationIndex(context.operations, (operation) => {
      return (
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.activeBlockBackground &&
        approximately(operation.x, activeBounds.left) &&
        approximately(operation.width, activeBounds.right - activeBounds.left)
      );
    });
    const activeHighlight = context.operations[activeHighlightIndex];
    const activeBorderIndex = findLastOperationIndex(context.operations, (operation) => {
      return (
        operation.kind === "strokeRect" &&
        operation.strokeStyle === resolvedLightTheme.tableBorder &&
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
        operation.fillStyle === resolvedLightTheme.activeBlockBackground &&
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

  test("can compose custom active-block-changed effects once around a wrapped block", () => {
    let state = setup("alpha\n\nbeta beta beta beta beta beta beta beta beta\n");
    const second = state.documentIndex.regions.find((entry) => entry.text.startsWith("beta"));

    if (!second) {
      throw new Error("Expected second paragraph region");
    }

    state = setSelection(state, { regionId: second.id, offset: 0 });

    const receivedRects: Array<{ height: number; left: number; top: number; width: number }> = [];
    const { context } = renderPaintOperations(state, {
      customEffects: {
        activeBlockChanged: {
          compose: "after",
          paint: ({ context, rect }) => {
            receivedRects.push(rect);
            context.strokeStyle = "#abcdef";
            context.strokeRect(rect.left, rect.top, rect.width, rect.height);
          },
        },
      },
      effects: readEditorEffects(state),
      height: 220,
      width: 140,
    });
    const customStrokeIndex = findOperationIndex(
      context.operations,
      (operation) => operation.kind === "strokeRect" && operation.strokeStyle === "#abcdef",
    );

    expect(receivedRects).toHaveLength(1);
    expect(receivedRects[0]?.height).toBeGreaterThan(24);
    expect(receivedRects[0]?.width).toBe(140);
    expect(customStrokeIndex).toBeGreaterThanOrEqual(0);
  });

  test("can compose custom active-block-changed effects for table cells", () => {
    let state = setup(`| One | Two |
| --- | --- |
| alpha | beta |
`);
    const cell = state.documentIndex.regions.find((entry) => entry.text === "beta");

    if (!cell) {
      throw new Error("Expected table cell region");
    }

    state = setSelection(state, { regionId: cell.id, offset: 0 });

    const receivedRects: Array<{ height: number; left: number; top: number; width: number }> = [];
    const { context } = renderPaintOperations(state, {
      customEffects: {
        activeBlockChanged: {
          compose: "after",
          paint: ({ context, rect }) => {
            receivedRects.push(rect);
            context.strokeStyle = "#fedcba";
            context.strokeRect(rect.left, rect.top, rect.width, rect.height);
          },
        },
      },
      effects: readEditorEffects(state),
      height: 220,
      width: 360,
    });
    const customStrokeIndex = findOperationIndex(
      context.operations,
      (operation) => operation.kind === "strokeRect" && operation.strokeStyle === "#fedcba",
    );

    expect(receivedRects).toHaveLength(1);
    expect(receivedRects[0]?.width).toBeGreaterThanOrEqual(80);
    expect(receivedRects[0]?.width).toBeLessThan(360);
    expect(customStrokeIndex).toBeGreaterThanOrEqual(0);
  });
});

describe("Replacement and link painting", () => {
  test("paints playground tutorial resources as pills, not links", () => {
    const tutorial = fixtureOptions.find((fixture) => fixture.id === "sample");

    if (!tutorial) {
      throw new Error("Expected playground tutorial fixture");
    }

    const state = createEditorState(
      parseDocument(tutorial.markdown, { resourceProtocols: ["demo-note:", "demo-resource:"] }),
    );
    const resources: DocumentResources = {
      images: new Map(),
      resourceRegistry: {
        active: new Set(["demo-resource://recording/live"]),
        protocols: new Map([
          ["demo-note:", { icon: "N", label: "Demo note" }],
          ["demo-resource:", { icon: "R", label: "Demo resource" }],
        ]),
      },
    };
    for (const url of [
      slowSampleImagePath,
      "https://dummyimage.com/640x360/1e293b/e2e8f0.png&text=Narrow+Host",
      "https://dummyimage.com/720x360/0f766e/f0fdfa.png&text=Diagnostics",
    ]) {
      resources.images.set(url, {
        intrinsicHeight: 360,
        intrinsicWidth: 640,
        source: null,
        status: "loaded",
      });
    }
    const { context } = renderPaintOperations(state, {
      height: 5000,
      resources,
      width: 900,
    });
    const recordingText = findFillTextOperation(context.operations, "Recording session");
    const noteText = findFillTextOperation(context.operations, "Planning note");
    const objectReplacementText = context.operations.find(
      (operation) => operation.kind === "fillText" && operation.text.includes("￼"),
    );
    const resourceBackgrounds = context.operations.filter(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.commentHighlight,
    );

    if (!recordingText || !noteText) {
      throw new Error("Expected resource label paint operations");
    }

    expect(recordingText.fillStyle).toBe(resolvedLightTheme.text);
    expect(noteText.fillStyle).toBe(resolvedLightTheme.leafSecondaryText);
    expect(objectReplacementText).toBeUndefined();
    expect(resourceBackgrounds.length).toBeGreaterThanOrEqual(2);
  });

  test("does not paint playground tutorial resources as link text", () => {
    const tutorial = fixtureOptions.find((fixture) => fixture.id === "sample");

    if (!tutorial) {
      throw new Error("Expected playground tutorial fixture");
    }

    const state = createEditorState(
      parseDocument(tutorial.markdown, { resourceProtocols: ["demo-note:", "demo-resource:"] }),
    );
    const resources: DocumentResources = {
      images: new Map(),
      resourceRegistry: {
        active: new Set(),
        protocols: new Map([
          ["demo-note:", { icon: "N", label: "Demo note" }],
          ["demo-resource:", { icon: "R", label: "Demo resource" }],
        ]),
      },
    };
    for (const url of [
      slowSampleImagePath,
      "https://dummyimage.com/640x360/1e293b/e2e8f0.png&text=Narrow+Host",
      "https://dummyimage.com/720x360/0f766e/f0fdfa.png&text=Diagnostics",
    ]) {
      resources.images.set(url, {
        intrinsicHeight: 360,
        intrinsicWidth: 640,
        source: null,
        status: "loaded",
      });
    }
    const { context } = renderPaintOperations(state, {
      height: 5000,
      resources,
      width: 900,
    });
    const linkTextOperations = context.operations.filter(
      (operation) =>
        operation.kind === "fillText" &&
        (operation.text === "Recording session" || operation.text === "Planning note") &&
        operation.fillStyle === resolvedLightTheme.linkText,
    );

    expect(linkTextOperations).toEqual([]);
  });

  test("paints ordinary links as link text", () => {
    const state = setup("[Recording session](demo-resource://recording/live)\n");
    const { context } = renderPaintOperations(state, { height: 180, width: 360 });
    const linkText = findFillTextOperation(context.operations, "Recording session");

    if (!linkText) {
      throw new Error("Expected link text paint operation");
    }

    expect(linkText.fillStyle).toBe(resolvedLightTheme.linkText);
  });

  test("paints resource svg icon nodes onto canvas", () => {
    const state = createEditorState(
      parseDocument("[Recording session](demo-resource://recording/live)\n", {
        resourceProtocols: ["demo-resource:"],
      }),
    );
    const icon: DocumentResourceIcon = {
      node: [["line", { x1: "5", x2: "19", y1: "12", y2: "12" }]],
      type: "svg",
    };
    const resources: DocumentResources = {
      images: new Map(),
      resourceRegistry: {
        active: new Set(["demo-resource://recording/live"]),
        protocols: new Map([["demo-resource:", { icon, label: "Demo resource" }]]),
      },
    };
    const { context } = renderPaintOperations(state, {
      height: 180,
      resources,
      width: 360,
    });
    const iconSegment = context.operations.find(
      (operation) =>
        operation.kind === "fillRect" &&
        typeof operation.fillStyle === "string" &&
        operation.fillStyle.startsWith("rgba("),
    );
    const labelSegment = context.operations.find(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.commentHighlight,
    );
    const iconStroke = context.operations.find(
      (operation) =>
        operation.kind === "strokePath" && operation.strokeStyle === resolvedLightTheme.background,
    );
    const labelText = findFillTextOperation(context.operations, "Recording session");

    expect(iconSegment).toBeDefined();
    expect(labelSegment).toBeDefined();
    expect(iconStroke).toBeDefined();
    expect(labelText?.fillStyle).toBe(resolvedLightTheme.text);
  });
});

describe("Block chrome geometry", () => {
  test("paints code block chrome inside document padding with content inset", () => {
    const state = setup("```ts\nconst value = 1;\n```\n");
    const { context, layout } = renderPaintOperations(state, { height: 180, width: 240 });
    const line = layout.lines.find((entry) => entry.text === "const value = 1;");

    if (!line) {
      throw new Error("Expected code line");
    }

    const backgroundPaint = context.operations.find(
      (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
        operation.kind === "fillRect" && operation.fillStyle === resolvedLightTheme.codeBackground,
    );
    const textOperation = findFillTextOperation(context.operations, "const value = 1;");

    if (!backgroundPaint || !textOperation) {
      throw new Error("Expected code block background and text paints");
    }

    expect(backgroundPaint.x).toBe(layout.options.paddingX);
    expect(backgroundPaint.y).toBe(line.top - 6);
    expect(backgroundPaint.width).toBe(240 - layout.options.paddingX * 2);
    expect(backgroundPaint.height).toBe(line.height + 12);
    expect(textOperation.x).toBe(layout.options.paddingX + 12);
    expect(line.left).toBe(layout.options.paddingX + 12);
  });

  test("centers active code block tint inside the code background padding", () => {
    let state = setup("```ts\nconst value = 1;\n```\n");
    const region = state.documentIndex.regions[0];

    if (!region) {
      throw new Error("Expected code region");
    }

    state = setSelection(state, { regionId: region.id, offset: "const".length });

    const { context, layout } = renderPaintOperations(state, { height: 180, width: 240 });
    const line = layout.lines.find((entry) => entry.text === "const value = 1;");

    if (!line) {
      throw new Error("Expected code line");
    }

    const backgroundPaint = context.operations.find(
      (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
        operation.kind === "fillRect" && operation.fillStyle === resolvedLightTheme.codeBackground,
    );
    const activePaint = context.operations.find(
      (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.activeBlockBackground,
    );

    if (!backgroundPaint || !activePaint) {
      throw new Error("Expected code background and active block paints");
    }

    expect(activePaint.x).toBe(backgroundPaint.x);
    expect(activePaint.width).toBe(backgroundPaint.width);
    expect(activePaint.y - backgroundPaint.y).toBe(
      backgroundPaint.y + backgroundPaint.height - (activePaint.y + activePaint.height),
    );
  });

  test("bleeds active blockquote rules to the quote line-box top", () => {
    let state = setup("> alpha\n>\n> beta\n");
    const activeRegion = state.documentIndex.regions.find((region) => region.text === "beta");

    if (!activeRegion) {
      throw new Error("Expected quoted paragraph");
    }

    state = setSelection(state, { regionId: activeRegion.id, offset: 1 });

    const { context, layout } = renderPaintOperations(state, { height: 240, width: 240 });
    const firstLine = layout.lines.find((line) => line.text === "alpha");
    const activeLine = layout.lines.find((line) => line.regionId === activeRegion.id);

    if (!firstLine || !activeLine) {
      throw new Error("Expected quoted lines");
    }

    const activeHighlight = context.operations.find(
      (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.activeBlockBackground,
    );
    const activeRule = context.operations.find(
      (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.blockquoteRuleActive,
    );

    if (!activeHighlight || !activeRule) {
      throw new Error("Expected active blockquote highlight and rule paints");
    }

    expect(activeHighlight.y).toBeLessThan(activeLine.top);
    expect(activeRule.y).toBe(firstLine.top - 1);
    expect(activeRule.y + activeRule.height).toBeLessThan(activeLine.top + activeLine.height);
  });
});

describe("Selections, comments, and text overlays", () => {
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
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.selectionBackground,
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
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.selectionBackground,
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

    const { context } = renderPaintOperations(state, {
      effects: readEditorEffects(state),
      height: 180,
      width: 240,
    });
    const textOperations = context.operations.filter(
      (operation): operation is Extract<RecordingOperation, { kind: "fillText" }> =>
        operation.kind === "fillText",
    );
    const insertedCharacterPaint = textOperations.find((operation) => operation.text === "!");
    const baseTextPaint = textOperations.find(
      (operation) =>
        operation.text === "alpha!" && operation.fillStyle === resolvedLightTheme.paragraphText,
    );
    const highlightOverlayPaint = textOperations.find(
      (operation) =>
        operation.text === "alpha!" &&
        operation.fillStyle === resolvedLightTheme.insertHighlightText,
    );

    expect(insertedCharacterPaint).toBeUndefined();
    expect(baseTextPaint).toBeDefined();
    expect(highlightOverlayPaint).toBeDefined();
    expect(highlightOverlayPaint?.globalAlpha).toBeGreaterThan(0);
    expect(highlightOverlayPaint?.globalAlpha).toBeLessThanOrEqual(1);
  });

  test("passes a baseline-left insertion anchor and visible viewport to custom text-inserted effects", () => {
    let highlightState = setup("alpha\n");
    const highlightContainer = highlightState.documentIndex.regions[0];

    if (!highlightContainer) {
      throw new Error("Expected paragraph region");
    }

    highlightState = setSelection(highlightState, {
      regionId: highlightContainer.id,
      offset: highlightContainer.text.length,
    });
    highlightState = insertText(highlightState, "!") ?? highlightState;

    let pulseState = setup("alpha\n");
    const pulseContainer = pulseState.documentIndex.regions[0];

    if (!pulseContainer) {
      throw new Error("Expected paragraph region");
    }

    pulseState = setSelection(pulseState, {
      regionId: pulseContainer.id,
      offset: pulseContainer.text.length,
    });
    pulseState = insertText(pulseState, ".") ?? pulseState;

    const receivedContexts: Array<{
      anchor: { x: number; y: number };
      contentKind: "code" | "text";
      text: string;
      viewport: { height: number; left: number; top: number; width: number };
    }> = [];

    const customEffects = {
      textInserted: ({ anchor, contentKind, text, viewport }) => {
        receivedContexts.push({ anchor, contentKind, text, viewport });
      },
    } satisfies DocumintEffects;

    renderPaintOperations(highlightState, {
      customEffects: {
        ...customEffects,
      },
      effects: readEditorEffects(highlightState),
      height: 180,
      width: 240,
    });
    renderPaintOperations(pulseState, {
      customEffects: {
        ...customEffects,
      },
      effects: readEditorEffects(pulseState),
      height: 180,
      width: 240,
    });

    expect(receivedContexts).toHaveLength(2);
    expect(receivedContexts).toEqual(
      expect.arrayContaining([
        {
          anchor: {
            x: expect.any(Number),
            y: expect.any(Number),
          },
          contentKind: "text",
          text: "!",
          viewport: {
            height: 180,
            left: 0,
            top: 0,
            width: 240,
          },
        },
        {
          anchor: {
            x: expect.any(Number),
            y: expect.any(Number),
          },
          contentKind: "text",
          text: ".",
          viewport: {
            height: 180,
            left: 0,
            top: 0,
            width: 240,
          },
        },
      ]),
    );
    expect(receivedContexts[0]?.anchor.x).toBeGreaterThan(0);
    expect(receivedContexts[0]?.anchor.y).toBeGreaterThan(0);
    expect(receivedContexts[1]?.anchor.x).toBe(receivedContexts[0]?.anchor.x);
    expect(receivedContexts[1]?.anchor.y).toBe(receivedContexts[0]?.anchor.y);
  });

  test("can compose custom text-inserted effects after the default paint", () => {
    let state = setup("alpha\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected paragraph region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = insertText(state, "!") ?? state;

    const { context } = renderPaintOperations(state, {
      customEffects: {
        textInserted: {
          compose: "after",
          paint: ({ context, viewport }) => {
            context.strokeStyle = "#ff00ff";
            context.strokeRect(viewport.left, viewport.top, viewport.width, viewport.height);
          },
        },
      },
      effects: readEditorEffects(state),
      height: 180,
      width: 240,
    });

    const highlightOverlayIndex = findOperationIndex(
      context.operations,
      (operation) =>
        operation.kind === "fillText" &&
        operation.text === "alpha!" &&
        operation.fillStyle === resolvedLightTheme.insertHighlightText,
    );
    const customStrokeIndex = findOperationIndex(
      context.operations,
      (operation) => operation.kind === "strokeRect" && operation.strokeStyle === "#ff00ff",
    );

    expect(highlightOverlayIndex).toBeGreaterThanOrEqual(0);
    expect(customStrokeIndex).toBeGreaterThan(highlightOverlayIndex);
  });

  test("runs custom source-region text-inserted effects without default insert highlight", () => {
    let state = setup("```ts\nconst value = 1;\n```\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected code region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = insertText(state, "!") ?? state;

    const customContexts: Array<{ contentKind: "code" | "text"; text: string }> = [];
    const { context } = renderPaintOperations(state, {
      customEffects: {
        textInserted: {
          compose: "after",
          paint: ({ contentKind, context, text }) => {
            customContexts.push({ contentKind, text });
            context.strokeStyle = "#ff00ff";
            context.strokeRect(0, 0, 10, 10);
          },
        },
      },
      effects: readEditorEffects(state),
      height: 180,
      width: 240,
    });

    expect(customContexts).toEqual([{ contentKind: "code", text: "!" }]);
    expect(
      context.operations.some(
        (operation) =>
          operation.kind === "fillText" &&
          operation.fillStyle === resolvedLightTheme.insertHighlightText,
      ),
    ).toBe(false);
    expect(
      context.operations.some(
        (operation) => operation.kind === "strokeRect" && operation.strokeStyle === "#ff00ff",
      ),
    ).toBe(true);
  });

  test("uses custom text-deleted effects in place of the default fade", () => {
    let state = setup("alpha\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected paragraph region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = deleteBackward(state) ?? state;

    const customContexts: Array<{ contentKind: "code" | "text"; text: string }> = [];
    const { context } = renderPaintOperations(state, {
      customEffects: {
        textDeleted: ({ contentKind, context, left, text, textBaseline }) => {
          customContexts.push({ contentKind, text });
          context.fillText("custom-delete", left, textBaseline);
        },
      },
      effects: readEditorEffects(state),
      height: 180,
      width: 240,
    });

    expect(customContexts).toEqual([{ contentKind: "text", text: "a" }]);
    expect(findFillTextOperation(context.operations, "custom-delete")).toBeDefined();
    expect(findFillTextOperation(context.operations, "a")).toBeNull();
  });

  test("passes code content kind to custom source-region text-deleted effects", () => {
    let state = setup("```ts\nconst value = 1;\n```\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected code region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = deleteBackward(state) ?? state;

    const customContexts: Array<{ contentKind: "code" | "text"; text: string }> = [];
    const { context } = renderPaintOperations(state, {
      customEffects: {
        textDeleted: ({ contentKind, context, left, text, textBaseline }) => {
          customContexts.push({ contentKind, text });
          context.fillText("custom-delete", left, textBaseline);
        },
      },
      effects: readEditorEffects(state),
      height: 180,
      width: 240,
    });

    expect(customContexts).toEqual([{ contentKind: "code", text: ";" }]);
    expect(findFillTextOperation(context.operations, "custom-delete")).toBeDefined();
    expect(findFillTextOperation(context.operations, ";")).toBeNull();
  });

  test("supports explicit replace composition for custom effects", () => {
    let state = setup("alpha\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected paragraph region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = deleteBackward(state) ?? state;

    const { context } = renderPaintOperations(state, {
      customEffects: {
        textDeleted: {
          compose: "replace",
          paint: ({ context, left, textBaseline }) => {
            context.fillText("explicit-replace", left, textBaseline);
          },
        },
      },
      effects: readEditorEffects(state),
      height: 180,
      width: 240,
    });

    expect(findFillTextOperation(context.operations, "explicit-replace")).toBeDefined();
    expect(findFillTextOperation(context.operations, "a")).toBeNull();
  });

  test("paints sparse theme text colors from the resolved base text", () => {
    const state = setup("# Heading\n\nParagraph\n\n> Quote\n");
    const theme = resolveEditorTheme({
      ...withoutTextTokens(resolvedLightTheme),
      text: "#f5f5f5",
    });
    const { context } = renderPaintOperations(state, { height: 260, theme, width: 360 });

    expect(findFillTextOperation(context.operations, "Heading")?.fillStyle).toBe("#f5f5f5");
    expect(findFillTextOperation(context.operations, "Paragraph")?.fillStyle).toBe("#f5f5f5");
    expect(findFillTextOperation(context.operations, "Quote")?.fillStyle).toBe("#f5f5f5");
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
        operation.fillStyle === resolvedLightTheme.paragraphText &&
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
        operation.fillStyle === resolvedLightTheme.paragraphText,
    );
    const selectionPaintIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.selectionBackground,
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
        operation.fillStyle !== resolvedLightTheme.paragraphText &&
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
    expect(pulsingTextOverlay.fillStyle).not.toBe(resolvedLightTheme.paragraphText);

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
        operation.fillStyle !== resolvedLightTheme.paragraphText &&
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
    expect(transparentTextOverlay.fillStyle).not.toBe(resolvedLightTheme.paragraphText);

    const { context: pausedContext } = renderPaintOperations(state, {
      ambientTime: 1100,
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
      ambientTime: 1100,
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

  test("pulses presence-active comment highlights with ambient time", () => {
    const state = setup("alpha comment\n");
    const region = state.documentIndex.regions[0];

    if (!region) {
      throw new Error("Expected paragraph region");
    }

    const { context } = renderPaintOperations(state, {
      ambientTime: 1100,
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
      (operation) =>
        operation.kind === "fillRect" && operation.fillStyle === resolvedLightTheme.leafAccent,
    );

    expect(commentHighlight).toEqual(expect.objectContaining({ kind: "fillRect" }));
  });
});

describe("Text glyph geometry", () => {
  test("paints inline code background with text background geometry", () => {
    const state = setup("alpha `TODO` beta\n");
    const { context, layout } = renderPaintOperations(state, {
      height: 180,
      width: 240,
    });
    const backgroundPaintIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.inlineCodeBackground,
    );
    const codeTextPaintIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillText" &&
        operation.text === "TODO" &&
        operation.fillStyle === resolvedLightTheme.inlineCodeText,
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

  test("paints superscript with scaled font and raised baseline", () => {
    const state = setup("Area x<sup>2</sup>\n");
    const { context } = renderPaintOperations(state, {
      height: 180,
      width: 240,
    });
    const basePaint = context.operations.find(
      (operation) => operation.kind === "fillText" && operation.text === "Area x",
    );
    const superscriptPaint = context.operations.find(
      (operation) => operation.kind === "fillText" && operation.text === "2",
    );

    if (
      !basePaint ||
      basePaint.kind !== "fillText" ||
      !superscriptPaint ||
      superscriptPaint.kind !== "fillText"
    ) {
      throw new Error("Expected base and superscript text paints");
    }

    expect(superscriptPaint.font).not.toBe(basePaint.font);
    expect(superscriptPaint.font).toContain("px");
    expect(superscriptPaint.y).toBeLessThan(basePaint.y);
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
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.inlineCodeBackground,
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
});

describe("List marker painting", () => {
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

    if (!markerOne || !markerTen || !textOne || !textTen) {
      throw new Error("Expected ordered list paint operations");
    }

    expect(markerTen.x).toBe(markerOne.x);
    expect(textTen.x).toBe(textOne.x);
    expect(markerOne.textAlign).toBe("right");
    expect(markerTen.textAlign).toBe("right");
    expect(markerOne.x).toBe(textOne.x - orderedListMarkerGap);
    expect(markerTen.x).toBe(textTen.x - orderedListMarkerGap);
  });

  test("draws unordered list marker shapes by nesting depth", () => {
    const state = setup(`- top
  - child
    - grandchild
`);
    const { context } = renderPaintOperations(state, { height: 220, width: 320 });
    const markerFills = context.operations.filter(
      (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
        operation.kind === "fillRect" && operation.fillStyle === resolvedLightTheme.listMarkerText,
    );
    const markerPathFills = context.operations.filter(
      (operation): operation is Extract<RecordingOperation, { kind: "fillPath" }> =>
        operation.kind === "fillPath" && operation.fillStyle === resolvedLightTheme.listMarkerText,
    );
    const markerArcs = context.operations.filter(
      (operation): operation is Extract<RecordingOperation, { kind: "arc" }> =>
        operation.kind === "arc" && approximately(operation.radius, 3),
    );
    const markerStroke = context.operations.find(
      (operation) =>
        operation.kind === "strokePath" &&
        operation.strokeStyle === resolvedLightTheme.listMarkerText,
    );

    expect(markerArcs).toHaveLength(2);
    expect(markerPathFills.length).toBeGreaterThanOrEqual(1);
    expect(markerStroke).toBeDefined();
    expect(markerFills.some((operation) => operation.width === 6 && operation.height === 6)).toBe(
      true,
    );
  });

  test("scales task checkbox checkmark with marker bounds", () => {
    const state = setup("- [x] task\n");

    for (const expectation of [
      { fontSize: 12, size: 11 },
      { fontSize: 20, size: 18 },
    ]) {
      const theme: ResolvedEditorTheme = {
        ...resolvedLightTheme,
        fontSize: expectation.fontSize,
      };
      const { context } = renderPaintOperations(state, { height: 180, theme, width: 240 });
      const checkboxFill = context.operations.find(
        (operation): operation is Extract<RecordingOperation, { kind: "fillRect" }> =>
          operation.kind === "fillRect" &&
          operation.fillStyle === resolvedLightTheme.checkboxCheckedFill,
      );
      const checkmarkStroke = context.operations.find(
        (operation): operation is Extract<RecordingOperation, { kind: "strokePath" }> =>
          operation.kind === "strokePath" &&
          operation.strokeStyle === resolvedLightTheme.checkboxCheckmark &&
          operation.path.length === 3,
      );

      if (!checkboxFill || !checkmarkStroke) {
        throw new Error("Expected checked task checkbox paint operations");
      }

      const scale = expectation.size / 14;

      expect(checkboxFill.width).toBe(expectation.size);
      expect(checkboxFill.height).toBe(expectation.size);
      expect(approximately(checkmarkStroke.lineWidth, 2 * scale)).toBeTrue();
      expect(approximately(checkmarkStroke.path[0]!.x - checkboxFill.x, 3.5 * scale)).toBeTrue();
      expect(approximately(checkmarkStroke.path[0]!.y - checkboxFill.y, 7.5 * scale)).toBeTrue();
      expect(approximately(checkmarkStroke.path[2]!.x - checkboxFill.x, 11.5 * scale)).toBeTrue();
      expect(approximately(checkmarkStroke.path[2]!.y - checkboxFill.y, 3.5 * scale)).toBeTrue();
    }
  });

  test("uses explicit list marker text color when provided", () => {
    const state = setup("- bullet\n");
    const theme: ResolvedEditorTheme = {
      ...resolvedLightTheme,
      listMarkerText: "#f97316",
      paragraphText: "#14532d",
    };
    const { context } = renderPaintOperations(state, { height: 180, theme, width: 240 });
    const marker = context.operations.find(
      (operation) => operation.kind === "fillPath" && operation.fillStyle === "#f97316",
    );
    const text = findFillTextOperation(context.operations, "bullet");

    if (!marker || !text) {
      throw new Error("Expected list marker and text paint operations");
    }

    expect(marker).toBeDefined();
    expect(text.fillStyle).toBe("#14532d");
  });

  test("uses resolved list marker text color", () => {
    const state = setup("- bullet\n");
    const theme: ResolvedEditorTheme = {
      ...resolvedLightTheme,
      listMarkerText: resolvedLightTheme.checkboxUncheckedStroke,
      paragraphText: "#14532d",
    };

    const { context } = renderPaintOperations(state, { height: 180, theme, width: 240 });
    const marker = context.operations.find(
      (operation) =>
        operation.kind === "fillPath" &&
        operation.fillStyle === resolvedLightTheme.checkboxUncheckedStroke,
    );
    const text = findFillTextOperation(context.operations, "bullet");

    if (!marker || !text) {
      throw new Error("Expected list marker and text paint operations");
    }

    expect(marker).toBeDefined();
    expect(text.fillStyle).toBe("#14532d");
  });

  test("can compose custom list-item-inserted effects before the default marker paint", () => {
    let state = setup("- alpha\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected list item region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = insertLineBreak(state) ?? state;

    const receivedMarkers: string[] = [];
    const { context } = renderPaintOperations(state, {
      customEffects: {
        listItemInserted: {
          compose: "before",
          paint: ({ context, marker }) => {
            receivedMarkers.push(marker.kind);
            context.fillStyle = "#123abc";
            context.fillRect(
              marker.rect.left,
              marker.rect.top,
              marker.rect.width,
              marker.rect.height,
            );
          },
        },
      },
      effects: readEditorEffects(state),
      height: 220,
      width: 320,
    });
    const customFlashIndex = findOperationIndex(
      context.operations,
      (operation) => operation.kind === "fillRect" && operation.fillStyle === "#123abc",
    );
    const defaultMarkerIndex = context.operations.findIndex(
      (operation, index) =>
        index > customFlashIndex &&
        operation.kind === "fillPath",
    );

    expect(receivedMarkers).toEqual(["unordered"]);
    expect(customFlashIndex).toBeGreaterThanOrEqual(0);
    expect(defaultMarkerIndex).toBeGreaterThan(customFlashIndex);
  });

  test("passes task markers to custom list-item-inserted effects", () => {
    let state = setup("- [ ] alpha\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected task list item region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = insertLineBreak(state) ?? state;

    const receivedMarkers: string[] = [];
    renderPaintOperations(state, {
      customEffects: {
        listItemInserted: ({ marker }) => {
          receivedMarkers.push(marker.kind === "task" ? `${marker.kind}:${marker.checked}` : marker.kind);
        },
      },
      effects: readEditorEffects(state),
      height: 220,
      width: 320,
    });

    expect(receivedMarkers).toEqual(["task:false"]);
  });

  test("isolates canvas state between composed custom and default effects", () => {
    let state = setup("- alpha\n");
    const container = state.documentIndex.regions[0];

    if (!container) {
      throw new Error("Expected list item region");
    }

    state = setSelection(state, { regionId: container.id, offset: container.text.length });
    state = insertLineBreak(state) ?? state;

    const { context } = renderPaintOperations(state, {
      customEffects: {
        listItemInserted: {
          compose: "before",
          paint: ({ context, marker }) => {
            context.fillStyle = "#123abc";
            context.globalAlpha = 0.25;
            context.fillRect(
              marker.rect.left,
              marker.rect.top,
              marker.rect.width,
              marker.rect.height,
            );
          },
        },
      },
      effects: readEditorEffects(state),
      height: 220,
      width: 320,
    });
    const defaultMarker = context.operations.find(
      (operation) =>
        operation.kind === "fillPath" &&
        operation.fillStyle === resolvedLightTheme.listMarkerText,
    );

    if (!defaultMarker || defaultMarker.kind !== "fillPath") {
      throw new Error("Expected default marker paint after custom effect");
    }

    expect(defaultMarker.globalAlpha).toBe(1);
  });
});

function renderPaintOperations(
  state: EditorState,
  options: {
    ambientTime?: number;
    height: number;
    commentRanges?: EditorCommentRange[];
    customEffects?: DocumintEffects;
    effects?: readonly EditorEffect[];
    now?: number;
    commentPresence?: ReadonlyMap<number, EditorPresence>;
    resources?: DocumentResources;
    textDecorations?: TextDecorationIndex;
    theme?: ResolvedEditorTheme;
    width: number;
  },
) {
  const layoutState = createEditorLayoutState(
    state,
    {
      height: options.height,
      fontSize: (options.theme ?? resolvedLightTheme).fontSize,
      top: 0,
      width: options.width,
    },
    undefined,
    options.resources,
  );
  const context = new RecordingCanvasContext();

  const now = options.now ?? 0;
  const effects = options.effects?.map(
    (effect): ActiveEditorEffect => ({ ...effect, startedAt: now }),
  );

  const frame = createDocumentFrame(state, layoutState, {
    activeBlockId:
      state.documentIndex.regionIndex.get(state.selection.focus.regionId)?.block.id ?? null,
    activeRegionId: state.selection.focus.regionId,
    activeThreadIndex: null,
    ambientTime: options.ambientTime,
    customEffects: options.customEffects,
    devicePixelRatio: 1,
    effects,
    height: options.height,
    commentRanges: options.commentRanges ?? [],
    normalizedSelection: normalizeSelection(state),
    commentPresence: options.commentPresence,
    // `now` defaults to 0 in tests so paint is deterministic: any state without
    // active timed effects renders identically across runs. Tests that
    // exercise effect progression set their own `now`.
    now,
    resources: options.resources,
    textDecorations: options.textDecorations,
    theme: options.theme ?? resolvedLightTheme,
    width: options.width,
  });
  paintDocumentFrame(context as unknown as CanvasRenderingContext2D, frame);

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
    isOnUnresolvedCommentThread: true,
    username: "User",
    viewport: null,
  };
}

function withoutTextTokens(theme: ResolvedEditorTheme) {
  const {
    blockquoteText: _blockquoteText,
    codeText: _codeText,
    headingText: _headingText,
    imagePlaceholderText: _imagePlaceholderText,
    insertHighlightText: _insertHighlightText,
    leafButtonText: _leafButtonText,
    leafSecondaryText: _leafSecondaryText,
    leafText: _leafText,
    linkText: _linkText,
    paragraphText: _paragraphText,
    text: _text,
    ...themeWithoutText
  } = theme;

  return themeWithoutText;
}
