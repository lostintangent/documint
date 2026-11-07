// Integration tests for the canvas paint pipeline. Each test drives
// `createDocumentFrame` + `paintDocumentFrame` with a recording context and asserts against
// the resulting operation sequence — covering pass ordering, pixel
// geometry, and inter-painter interactions that are hard to verify in
// isolation.

import { describe, expect, spyOn, test } from "bun:test";
import type { DocumintListMarkerPaintFrame } from "@/renderer";
import {
  CODE_BLOCK_BACKGROUND_PADDING_Y,
  CODE_BLOCK_CONTENT_PADDING_X,
  type DocumentImageResource,
  type DocumentResourceIcon,
} from "@/editor";
import {
  deleteBackward,
  insertLineBreak,
  insertText,
  metadataValuePath,
  readEditorEffects,
  setSelection,
} from "@/editor/state";
import { resolveEditorTheme } from "@/component/lib/themes";
import type {
  ResolvedEditorTheme,
  TextDeletedEffectContext,
  TextInsertedEffectContext,
} from "@/renderer";
import {
  createPresence,
  createResources,
  getPath,
  getPathByType,
  placeAt,
  selectIn,
  setup,
} from "../editor/helpers";
import {
  approximately,
  createTestDocumentFrame,
  createTestOverlayFrame,
  findFillTextOperation,
  findLastOperationIndex,
  liveDocumentChangeAt,
  paint,
  RecordingCanvasContext,
  resolvedLightTheme,
  type RecordingOperation,
} from "./helpers";

describe("Block and chrome paint order", () => {
  test("paints active table highlights only within the active cell before text", () => {
    let state = setup(`| Left | Active | Right |
| --- | --- | --- |
| one | two | three |
`);
    const activeContainer = getPath(state, "Active");
    const rightContainer = getPath(state, "Right");

    state = placeAt(state, activeContainer, 1);

    const { frame, layout } = createTestDocumentFrame(state, { height: 240, width: 480 });
    const context = paint(frame);
    const activeBounds = layout.pathBounds.get(activeContainer.path);
    const rightBounds = layout.pathBounds.get(rightContainer.path);

    if (!activeBounds || !rightBounds) {
      throw new Error("Expected active table cell bounds");
    }

    const rightCellBackgroundIndex = context.operations.findIndex((operation) => {
      return (
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.tableHeaderBackground &&
        approximately(operation.x, rightBounds.left) &&
        approximately(operation.y, rightBounds.top)
      );
    });
    const activeHighlightIndex = context.operations.findIndex((operation) => {
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
    const activeCellTextIndex = context.operations.findIndex((operation) => {
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

  test("paints code active and change tints behind the code surface", () => {
    let state = setup("```ts\nconst value = 1;\n```\n");
    const code = getPathByType(state, "code");

    state = placeAt(state, code, 1);

    const change = liveDocumentChangeAt(
      state,
      "```ts\nconst value = 0;\n```\n",
      code.blockPath,
      "code",
    );
    const { operations } = paint(
      createTestDocumentFrame(state, { documentChanges: [change] }).frame,
    );
    const fillIndex = (fillStyle: string) =>
      operations.findIndex(
        (operation) => operation.kind === "fillRect" && operation.fillStyle === fillStyle,
      );
    const surfaceIndex = fillIndex(resolvedLightTheme.codeBackground);

    for (const tint of [
      resolvedLightTheme.activeBlockBackground,
      resolvedLightTheme.externalChangeModificationBackground,
    ]) {
      expect(fillIndex(tint)).toBeGreaterThanOrEqual(0);
      expect(surfaceIndex).toBeGreaterThan(fillIndex(tint));
    }
  });

  test("fades document-change block backgrounds in before text", () => {
    const state = setup("alpha beta\n");
    const container = getPath(state, "alpha beta");

    const change = liveDocumentChangeAt(state, "old\n", container.blockPath, "change-alpha");
    const { frame } = createTestDocumentFrame(state, {
      documentChanges: [change],
      effects: [
        {
          changeKey: "change-alpha",
          kind: "document-change",
          startedAt: 100,
        },
      ],
      height: 160,
      now: 110,
      width: 320,
    });
    const context = paint(frame);
    const backgroundIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.externalChangeModificationBackground,
    );
    const textIndex = context.operations.findIndex(
      (operation) => operation.kind === "fillText" && operation.text === "alpha beta",
    );
    const backgroundPaint = context.operations[backgroundIndex];

    expect(backgroundIndex).toBeGreaterThanOrEqual(0);
    expect(textIndex).toBeGreaterThan(backgroundIndex);

    if (!backgroundPaint || backgroundPaint.kind !== "fillRect") {
      throw new Error("Expected document-change background paint");
    }

    expect(backgroundPaint.globalAlpha).toBeGreaterThan(0);
    expect(backgroundPaint.globalAlpha).toBeLessThan(1);
  });

  test("repaints table borders after document-change table cells", () => {
    const state = setup(`| A | B |
| - | - |
| one | two |
`);
    const cell = getPath(state, "two");

    const change = liveDocumentChangeAt(state, "| A | B |\n| - | - |\n", cell.path, "change-cell");
    const { frame, layout } = createTestDocumentFrame(state, {
      documentChanges: [change],
      height: 240,
      now: 110,
      width: 480,
    });
    const context = paint(frame);
    const cellBounds = layout.pathBounds.get(cell.path);

    if (!cellBounds) {
      throw new Error("Expected table cell bounds");
    }

    const externalFillIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.externalChangeAdditionBackground &&
        approximately(operation.x, cellBounds.left),
    );
    const borderAfterExternalIndex = findLastOperationIndex(
      context.operations,
      (operation) =>
        operation.kind === "strokeRect" &&
        operation.strokeStyle === resolvedLightTheme.tableBorder &&
        approximately(operation.x, cellBounds.left) &&
        approximately(operation.y, cellBounds.top),
    );
    const textIndex = context.operations.findIndex(
      (operation) => operation.kind === "fillText" && operation.text === "two",
    );

    expect(externalFillIndex).toBeGreaterThanOrEqual(0);
    expect(borderAfterExternalIndex).toBeGreaterThan(externalFillIndex);
    expect(textIndex).toBeGreaterThan(borderAfterExternalIndex);
  });

  test.each([
    {
      label: "a wrapped paragraph at full width",
      markdown: "alpha\n\nbeta beta beta beta beta beta beta beta beta\n",
      maxWidth: 140,
      minHeight: 25,
      minWidth: 140,
      target: "beta beta beta beta beta beta beta beta beta",
      width: 140,
    },
    {
      label: "a table cell within its column",
      markdown: "| One | Two |\n| --- | --- |\n| alpha | beta |\n",
      maxWidth: 359,
      minHeight: 0,
      minWidth: 80,
      target: "beta",
      width: 360,
    },
    {
      label: "a code block across its surface",
      markdown: "alpha\n\n```ts\nconst a = 1;\nconst b = 2;\n```\n",
      maxWidth: 360,
      minHeight: 50,
      minWidth: 360,
      target: "const a = 1;\nconst b = 2;",
      width: 360,
    },
  ])(
    "composes custom active-block-changed effects once around $label",
    ({ markdown, maxWidth, minHeight, minWidth, target, width }) => {
      let state = setup(markdown);
      state = placeAt(state, getPath(state, target), "start");

      const receivedRects: Array<{ height: number; left: number; top: number; width: number }> = [];
      const { frame } = createTestDocumentFrame(state, {
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
        width,
      });
      const context = paint(frame);
      const [rect] = receivedRects;

      expect(receivedRects).toHaveLength(1);
      expect(rect!.height).toBeGreaterThanOrEqual(minHeight);
      expect(rect!.width).toBeGreaterThanOrEqual(minWidth);
      expect(rect!.width).toBeLessThanOrEqual(maxWidth);
      expect(
        context.operations.findIndex(
          (operation) => operation.kind === "strokeRect" && operation.strokeStyle === "#abcdef",
        ),
      ).toBeGreaterThanOrEqual(0);
    },
  );
});

describe("Metadata prefix painting", () => {
  test("paints header and grid chrome before text and shared checkbox chrome", () => {
    const state = setup(`---
title: Draft
draft: true
---
Body
`);
    const { frame, layout } = createTestDocumentFrame(state, {
      height: 320,
      metadataExpanded: true,
      width: 520,
    });
    const context = paint(frame);
    const metadata = layout.metadata;
    const titleRow = metadata?.rows[0];

    if (!metadata || !titleRow) {
      throw new Error("Expected structured metadata paint geometry");
    }

    const headerFillIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.tableHeaderBackground &&
        approximately(operation.x, metadata.header.left) &&
        approximately(operation.y, metadata.header.top),
    );
    const titleValueFillIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.tableBodyBackground &&
        approximately(operation.x, titleRow.valueRect.left) &&
        approximately(operation.y, titleRow.valueRect.top),
    );
    const checkboxFillIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.checkboxCheckedFill,
    );
    const checkmarkIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "strokePath" &&
        operation.strokeStyle === resolvedLightTheme.checkboxCheckmark &&
        operation.path.length === 3,
    );
    const chevronIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "strokePath" &&
        operation.strokeStyle === resolvedLightTheme.headingText &&
        operation.path.length === 3,
    );

    const lastBackgroundIndex = Math.max(headerFillIndex, titleValueFillIndex);
    const foregroundIndices = [
      context.operations.findIndex(
        (operation) => operation.kind === "fillText" && operation.text === "Draft",
      ),
      checkboxFillIndex,
      chevronIndex,
    ];

    expect(lastBackgroundIndex).toBeGreaterThanOrEqual(0);
    for (const index of foregroundIndices) {
      expect(index).toBeGreaterThan(lastBackgroundIndex);
    }
    expect(checkmarkIndex).toBeGreaterThan(checkboxFillIndex);

    const label = findFillTextOperation(context.operations, "Document metadata");
    const chevron = context.operations[chevronIndex];

    if (!label || chevron?.kind !== "strokePath") {
      throw new Error("Expected metadata header foreground");
    }

    context.font = label.font;
    const metrics = context.measureText(label.text);
    const visibleCenter =
      label.y - (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;

    expect(label.font).not.toContain("700");
    expect(context.operations.indexOf(label)).toBeGreaterThan(lastBackgroundIndex);
    expect(approximately(visibleCenter, metadata.header.top + metadata.header.height / 2)).toBe(
      true,
    );
    expect(findFillTextOperation(context.operations, "2 fields")).toBeNull();
    expect(findFillTextOperation(context.operations, "Draft")?.fillStyle).toBe(
      resolvedLightTheme.headingText,
    );
    expect(chevron.path[0]?.x).toBeGreaterThan(metadata.header.left + metadata.header.width / 2);
    expect(chevron.path[1]?.y).toBeLessThan(chevron.path[0]?.y ?? 0);

    const collapsed = paint(
      createTestDocumentFrame(state, {
        height: 320,
        metadataExpanded: false,
        width: 520,
      }).frame,
    );
    const collapsedChevron = collapsed.operations.find(
      (operation) =>
        operation.kind === "strokePath" &&
        operation.strokeStyle === resolvedLightTheme.headingText &&
        operation.path.length === 3,
    );

    if (collapsedChevron?.kind !== "strokePath") {
      throw new Error("Expected collapsed metadata chevron");
    }

    expect(collapsedChevron.path[1]?.y).toBeGreaterThan(collapsedChevron.path[0]?.y ?? 0);
  });

  test("paints metadata text effects through the shared text effect path", () => {
    let state = setup(`---
title: Draft
---
Body
`);
    state = setSelection(state, {
      path: metadataValuePath(0),
      offset: "Draft".length,
    });
    state = insertText(state, "!") ?? state;

    const { frame } = createTestDocumentFrame(state, {
      effects: readEditorEffects(state),
      height: 320,
      metadataExpanded: true,
      now: 100,
      width: 520,
    });
    const context = paint(frame);

    expect(
      context.operations.some(
        (operation) =>
          operation.kind === "fillText" &&
          operation.text === "Draft!" &&
          operation.fillStyle === resolvedLightTheme.insertHighlightText,
      ),
    ).toBe(true);
  });
});

describe("Replacement and link painting", () => {
  test("paints registered resources as pills instead of links or replacement glyphs", () => {
    const state = setup(
      "Try the active [Recording session](demo-resource://recording/live) resource and the inactive [Planning note](demo-note://note/complete) resource.\n",
      { resourceProtocols: ["demo-note:", "demo-resource:"] },
    );
    const resources = createResources({
      active: ["demo-resource://recording/live"],
      protocols: { "demo-note:": "N", "demo-resource:": "R" },
    });
    const { frame } = createTestDocumentFrame(state, { height: 180, resources, width: 900 });
    const context = paint(frame);
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

    expect(recordingText?.fillStyle).toBe(resolvedLightTheme.text);
    expect(noteText?.fillStyle).toBe(resolvedLightTheme.leafSecondaryText);
    expect(objectReplacementText).toBeUndefined();
    expect(resourceBackgrounds.length).toBeGreaterThanOrEqual(2);
    expect(
      context.operations.filter(
        (operation) =>
          operation.kind === "fillText" && operation.fillStyle === resolvedLightTheme.linkText,
      ),
    ).toEqual([]);
  });

  test("paints ordinary links as link text", () => {
    const state = setup("[Recording session](demo-resource://recording/live)\n");
    const { frame } = createTestDocumentFrame(state, { height: 180, width: 360 });
    const context = paint(frame);
    const linkText = findFillTextOperation(context.operations, "Recording session");

    if (!linkText) {
      throw new Error("Expected link text paint operation");
    }

    expect(linkText.fillStyle).toBe(resolvedLightTheme.linkText);
  });

  test("paints mentions as pills behind @-prefixed labels", () => {
    const state = setup("Ping @[Jane Doe](user-123) today\n");
    const context = paint(createTestDocumentFrame(state, { height: 180 }).frame);
    const pillIndex = context.operations.findIndex(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.mentionBackground,
    );
    const pill = context.operations[pillIndex];
    const label = context.operations[pillIndex + 1];

    if (pill?.kind !== "fillRect" || label?.kind !== "fillText") {
      throw new Error("Expected mention pill followed by its label");
    }

    expect(label).toMatchObject({ fillStyle: resolvedLightTheme.mentionText, text: "@Jane Doe" });
    expect(label.x).toBeGreaterThan(pill.x);
    expect(label.x).toBeLessThan(pill.x + pill.width);
  });

  test.each([
    // Placeholders fill the box layout reserves. Unknown intrinsic sizes fall
    // back to 240px wide at 9:16, never shorter than 120px.
    { height: 135, label: "Loading image", width: 240 },
    { attributes: "{width=60}", height: 120, label: "Image unavailable", width: 60 },
    { height: 90, intrinsicHeight: 90, intrinsicWidth: 160, label: "Loading image", width: 160 },
  ])(
    "paints $width by $height '$label' image placeholders",
    ({ attributes = "", height, intrinsicHeight = 0, intrinsicWidth = 0, label, width }) => {
      const status: DocumentImageResource["status"] =
        label === "Image unavailable" ? "error" : "loading";
      const url = "https://example.com/pending.png";
      const state = setup(`![Alt](${url})${attributes}\n`);
      const resources = {
        ...createResources(),
        images: new Map([
          [
            url,
            {
              intrinsicHeight,
              intrinsicWidth,
              source: null,
              status,
            },
          ],
        ]),
      };
      const context = paint(createTestDocumentFrame(state, { resources }).frame);
      const surfaceIndex = context.operations.findIndex(
        (operation) =>
          operation.kind === "fillRect" &&
          operation.fillStyle === resolvedLightTheme.imageSurfaceBackground,
      );
      const surface = context.operations[surfaceIndex];
      const labelIndex = context.operations.findIndex(
        (operation) => operation.kind === "fillText" && operation.text === label,
      );
      const borderIndex = context.operations.findIndex(
        (operation) =>
          operation.kind === "strokeRect" &&
          operation.strokeStyle === resolvedLightTheme.imageSurfaceBorder,
      );

      if (surface?.kind !== "fillRect") {
        throw new Error("Expected image surface paint");
      }

      expect(surface).toMatchObject({ height, width });
      expect(context.operations[labelIndex]).toMatchObject({
        fillStyle: resolvedLightTheme.imagePlaceholderText,
        x: surface.x + surface.width / 2,
      });
      expect(context.operations[borderIndex]).toMatchObject({
        height: surface.height,
        width: surface.width,
        x: surface.x,
        y: surface.y,
      });
      expect(labelIndex).toBeGreaterThan(surfaceIndex);
      expect(borderIndex).toBeGreaterThan(labelIndex);
      expect(
        context.operations.some(
          (operation) => operation.kind === "fillRect" && typeof operation.fillStyle !== "string",
        ),
      ).toBe(status === "loading");
    },
  );

  test("paints a loading image within a line as an em square without the icon or label", () => {
    const state = setup("Build [![CI](https://example.com/ci.svg)](https://ci) passing\n");
    const context = paint(createTestDocumentFrame(state).frame);
    const surface = context.operations.find(
      (operation) =>
        operation.kind === "fillRect" &&
        operation.fillStyle === resolvedLightTheme.imageSurfaceBackground,
    );

    expect(surface).toMatchObject({ height: 16, width: 16 });
    expect(findFillTextOperation(context.operations, "Loading image")).toBeNull();
  });

  test("paints resource svg icon nodes onto canvas", () => {
    const state = setup("[Recording session](demo-resource://recording/live)\n", {
      resourceProtocols: ["demo-resource:"],
    });
    const icon: DocumentResourceIcon = {
      node: [["line", { x1: "5", x2: "19", y1: "12", y2: "12" }]],
      type: "svg",
    };
    const resources = createResources({
      active: ["demo-resource://recording/live"],
      protocols: { "demo-resource:": icon },
    });
    const { frame } = createTestDocumentFrame(state, {
      height: 180,
      resources,
      width: 360,
    });
    const context = paint(frame);
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
    const { frame, layout } = createTestDocumentFrame(state, { height: 180, width: 240 });
    const context = paint(frame);
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
    expect(backgroundPaint.y).toBe(line.top - CODE_BLOCK_BACKGROUND_PADDING_Y);
    expect(backgroundPaint.width).toBe(240 - layout.options.paddingX * 2);
    expect(backgroundPaint.height).toBe(line.height + CODE_BLOCK_BACKGROUND_PADDING_Y * 2);
    expect(textOperation.x).toBe(layout.options.paddingX + CODE_BLOCK_CONTENT_PADDING_X);
    expect(line.left).toBe(layout.options.paddingX + CODE_BLOCK_CONTENT_PADDING_X);
  });

  test("paints divider rules across the content width at the divider's vertical center", () => {
    const state = setup("alpha\n\n---\n\nbeta\n");
    const { frame, layout } = createTestDocumentFrame(state);
    const context = paint(frame);
    const rule = context.operations.find(
      (operation) =>
        operation.kind === "fillRect" && operation.fillStyle === resolvedLightTheme.dividerRule,
    );
    const divider = layout.blocks.find((block) => block.type === "divider");

    if (rule?.kind !== "fillRect" || !divider) {
      throw new Error("Expected divider block and rule paint");
    }

    expect(rule).toMatchObject({
      height: 1,
      width: 420 - layout.options.paddingX * 2,
      x: layout.options.paddingX,
    });
    expect(rule.y).toBeGreaterThan(divider.top);
    expect(rule.y + rule.height).toBeLessThan(divider.bottom);
  });

  test("bleeds active blockquote rules to the quote line-box top", () => {
    let state = setup("> alpha\n>\n> beta\n");
    const activePath = getPath(state, "beta");

    state = placeAt(state, activePath, 1);

    const { frame, layout } = createTestDocumentFrame(state, { height: 240, width: 240 });
    const context = paint(frame);
    const firstLine = layout.lines.find((line) => line.text === "alpha");
    const activeLine = layout.lines.find((line) => line.path === activePath.path);

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

  test("paints a tall code block's surface and tint after its first line scrolls out of the paint window", () => {
    const source = Array.from({ length: 120 }, (_, index) => `const line${index} = ${index};`);
    let state = setup(`\`\`\`ts\n${source.join("\n")}\n\`\`\`\n`);
    const code = getPathByType(state, "code");

    state = placeAt(state, code, "end");

    const { frame, layout } = createTestDocumentFrame(state, {
      height: 240,
      top: 1200,
      width: 320,
    });
    const { operations } = paint(frame);
    const bounds = layout.pathBounds.get(code.path);
    const firstLine = layout.lines.find((line) => line.path === code.path);

    if (!bounds || !firstLine) {
      throw new Error("Expected code block bounds and lines");
    }

    expect(firstLine.top + firstLine.height).toBeLessThan(frame.layer.paintTop);
    expect(bounds.bottom).toBeGreaterThan(frame.layer.paintTop + frame.layer.height);

    const surfaceTop = bounds.top - CODE_BLOCK_BACKGROUND_PADDING_Y;
    const surfaceHeight = bounds.bottom - bounds.top + CODE_BLOCK_BACKGROUND_PADDING_Y * 2;
    const fills = (fillStyle: string) =>
      operations.filter(
        (operation) => operation.kind === "fillRect" && operation.fillStyle === fillStyle,
      );

    expect(fills(resolvedLightTheme.codeBackground)).toEqual([
      expect.objectContaining({ height: surfaceHeight, x: layout.options.paddingX, y: surfaceTop }),
    ]);
    expect(fills(resolvedLightTheme.activeBlockBackground)).toEqual([
      expect.objectContaining({ height: surfaceHeight, width: 320, x: 0, y: surfaceTop }),
    ]);
  });

  test("paints a short table cell's chrome, active tint, and change tint where its tall row fills the paint window", () => {
    const tall = Array.from({ length: 300 }, (_, index) => `word${index}`).join(" ");
    let state = setup(`| A | B |\n| - | - |\n| Notes | ${tall} |\n`);
    const notes = getPath(state, "Notes");

    state = placeAt(state, notes, "end");

    const change = liveDocumentChangeAt(
      state,
      `| A | B |\n| - | - |\n| Old | ${tall} |\n`,
      notes.path,
      "change-notes",
    );
    const { frame, layout } = createTestDocumentFrame(state, {
      documentChanges: [change],
      height: 240,
      top: 800,
      width: 420,
    });
    const { operations } = paint(frame);
    const bounds = layout.pathBounds.get(notes.path);
    const notesLine = layout.lines.find((line) => line.path === notes.path);

    if (!bounds || !notesLine) {
      throw new Error("Expected short cell bounds and line");
    }

    expect(notesLine.top + notesLine.height).toBeLessThan(frame.layer.paintTop);
    expect(bounds.bottom).toBeGreaterThan(frame.layer.paintTop + frame.layer.height);

    const cellPaints = operations.flatMap((operation) =>
      (operation.kind === "fillRect" || operation.kind === "strokeRect") &&
      approximately(operation.x, bounds.left) &&
      approximately(operation.y, bounds.top)
        ? [operation.kind === "fillRect" ? operation.fillStyle : "border"]
        : [],
    );

    expect(cellPaints).toEqual([
      resolvedLightTheme.tableBodyBackground,
      "border",
      resolvedLightTheme.externalChangeModificationBackground,
      "border",
      resolvedLightTheme.activeBlockBackground,
      "border",
    ]);
  });
});

describe("Selections, comments, and text overlays", () => {
  test.each([
    {
      baseColor: resolvedLightTheme.paragraphText,
      erasesBaseGlyphs: false,
      label: "insert highlights",
      overlayColor: resolvedLightTheme.insertHighlightText,
      renderFrame: () => {
        let state = setup("alpha\n");
        state = placeAt(state, getPath(state, "alpha"), "end");
        state = insertText(state, "!") ?? state;

        return createTestDocumentFrame(state, { effects: readEditorEffects(state) }).frame;
      },
      splitText: "!",
      text: "alpha!",
    },
    {
      baseColor: resolvedLightTheme.paragraphText,
      erasesBaseGlyphs: true,
      label: "text color decorations",
      overlayColor: "#c026d3",
      renderFrame: () => {
        const state = setup("alpha beta\n");
        const { path } = getPath(state, "alpha beta");

        return createTestDocumentFrame(state, {
          textDecorations: new Map([
            [path, [{ color: "#c026d3", endOffset: 10, path, startOffset: 6 }]],
          ]),
        }).frame;
      },
      splitText: "beta",
      text: "alpha beta",
    },
    {
      baseColor: resolvedLightTheme.headingText,
      erasesBaseGlyphs: true,
      label: "table cell text color decorations",
      overlayColor: "#c026d3",
      renderFrame: () => {
        const state = setup("| A | B |\n| --- | --- |\n| Cell target | Other |\n");
        const { path } = getPath(state, "Cell target");

        return createTestDocumentFrame(state, {
          textDecorations: new Map([
            [path, [{ color: "#c026d3", endOffset: 11, path, startOffset: 5 }]],
          ]),
        }).frame;
      },
      splitText: "target",
      text: "Cell target",
    },
  ])(
    "paints $label as a glyph overlay without splitting text runs",
    ({ baseColor, erasesBaseGlyphs, overlayColor, renderFrame, splitText, text }) => {
      const textOperations = paint(renderFrame()).operations.filter(
        (operation): operation is Extract<RecordingOperation, { kind: "fillText" }> =>
          operation.kind === "fillText",
      );
      const runPaints = textOperations.filter((operation) => operation.text === text);
      const overlayPaint = runPaints.find(
        (operation) =>
          operation.fillStyle === overlayColor &&
          operation.globalCompositeOperation === "source-over",
      );

      expect(textOperations.find((operation) => operation.text === splitText)).toBeUndefined();
      expect(
        runPaints.find(
          (operation) =>
            operation.fillStyle === baseColor &&
            operation.globalCompositeOperation === "source-over",
        ),
      ).toBeDefined();
      expect(overlayPaint?.globalAlpha).toBeGreaterThan(0);
      expect(overlayPaint?.globalAlpha).toBeLessThanOrEqual(1);
      expect(
        runPaints.some((operation) => operation.globalCompositeOperation === "destination-out"),
      ).toBe(erasesBaseGlyphs);
    },
  );

  test("paints selections at half strength over code surfaces", () => {
    let state = setup("alpha\n\n```ts\nconst value = 1;\n```\n");

    state = setSelection(state, {
      anchor: { path: getPath(state, "alpha").path, offset: 0 },
      focus: { path: getPathByType(state, "code").path, offset: 5 },
    });

    const selectionAlphas = paint(createTestDocumentFrame(state).frame)
      .operations.filter(
        (operation) =>
          operation.kind === "fillRect" &&
          operation.fillStyle === resolvedLightTheme.selectionBackground,
      )
      .map((operation) => operation.kind === "fillRect" && operation.globalAlpha);

    expect(selectionAlphas).toEqual([1, 0.5]);
  });

  test("passes a baseline-left insertion anchor and visible viewport to custom text-inserted effects", () => {
    const received: Array<
      Pick<TextInsertedEffectContext, "anchor" | "contentKind" | "text" | "viewport">
    > = [];

    // "!" paints through the insert highlight; "." through the punctuation pulse.
    for (const inserted of ["!", "."]) {
      let state = setup("alpha\n");
      state = placeAt(state, getPath(state, "alpha"), "end");
      state = insertText(state, inserted) ?? state;

      paint(
        createTestDocumentFrame(state, {
          customEffects: {
            textInserted: ({ anchor, contentKind, text, viewport }) => {
              received.push({ anchor, contentKind, text, viewport });
            },
          },
          effects: readEditorEffects(state),
          height: 180,
          width: 240,
        }).frame,
      );
    }

    const viewport = { height: 180, left: 0, top: 0, width: 240 };
    const [highlight, pulse] = received;

    expect(received).toMatchObject([
      { contentKind: "text", text: "!", viewport },
      { contentKind: "text", text: ".", viewport },
    ]);
    expect(highlight?.anchor.x).toBeGreaterThan(0);
    expect(highlight?.anchor.y).toBeGreaterThan(0);
    expect(pulse?.anchor).toEqual(highlight!.anchor);
  });

  test.each([
    {
      blockType: "paragraph",
      contentKind: "text",
      defaultHighlight: true,
      label: "after the default insert highlight",
      markdown: "alpha\n",
    },
    {
      blockType: "code",
      contentKind: "code",
      defaultHighlight: false,
      label: "without a default insert highlight in source paths",
      markdown: "```ts\nconst value = 1;\n```\n",
    },
  ] as const)(
    "composes custom text-inserted effects $label",
    ({ blockType, contentKind, defaultHighlight, markdown }) => {
      let state = setup(markdown);
      state = placeAt(state, getPathByType(state, blockType), "end");
      state = insertText(state, "!") ?? state;

      const received: Array<{ contentKind: "code" | "text"; text: string }> = [];
      const { operations } = paint(
        createTestDocumentFrame(state, {
          customEffects: {
            textInserted: {
              compose: "after",
              paint: ({ contentKind, context, text }) => {
                received.push({ contentKind, text });
                context.strokeStyle = "#ff00ff";
                context.strokeRect(0, 0, 10, 10);
              },
            },
          },
          effects: readEditorEffects(state),
        }).frame,
      );
      const highlightIndex = operations.findIndex(
        (operation) =>
          operation.kind === "fillText" &&
          operation.fillStyle === resolvedLightTheme.insertHighlightText,
      );
      const customStrokeIndex = operations.findIndex(
        (operation) => operation.kind === "strokeRect" && operation.strokeStyle === "#ff00ff",
      );

      expect(received).toEqual([{ contentKind, text: "!" }]);
      expect(highlightIndex >= 0).toBe(defaultHighlight);
      expect(customStrokeIndex).toBeGreaterThan(highlightIndex);
    },
  );

  test.each([
    {
      blockType: "paragraph",
      compose: undefined,
      expected: { contentKind: "text", text: "a" },
      label: "paragraph text through the function form",
      markdown: "alpha\n",
    },
    {
      blockType: "code",
      compose: undefined,
      expected: { contentKind: "code", text: ";" },
      label: "code text through the function form",
      markdown: "```ts\nconst value = 1;\n```\n",
    },
    {
      blockType: "paragraph",
      compose: "replace",
      expected: { contentKind: "text", text: "a" },
      label: "paragraph text through explicit replace composition",
      markdown: "alpha\n",
    },
  ] as const)(
    "replaces the default deletion fade with custom text-deleted effects for $label",
    ({ blockType, compose, expected, markdown }) => {
      let state = setup(markdown);
      state = placeAt(state, getPathByType(state, blockType), "end");
      state = deleteBackward(state) ?? state;

      const received: Array<Pick<TextDeletedEffectContext, "contentKind" | "text">> = [];
      const paintDeleted = ({
        contentKind,
        context,
        left,
        text,
        textBaseline,
      }: TextDeletedEffectContext) => {
        received.push({ contentKind, text });
        context.fillText("custom-delete", left, textBaseline);
      };
      const { frame } = createTestDocumentFrame(state, {
        customEffects: {
          textDeleted: compose ? { compose, paint: paintDeleted } : paintDeleted,
        },
        effects: readEditorEffects(state),
        height: 180,
        width: 240,
      });
      const context = paint(frame);

      expect(received).toEqual([expected]);
      expect(findFillTextOperation(context.operations, "custom-delete")).not.toBeNull();
      expect(findFillTextOperation(context.operations, expected.text)).toBeNull();
    },
  );

  test("paints sparse theme text colors from the resolved base text", () => {
    const state = setup("# Heading\n\nParagraph\n\n> Quote\n");
    const theme = resolveEditorTheme({
      accent: "#3b82f6",
      background: "#fcfbf7",
      muted: "#64748b",
      text: "#f5f5f5",
    });
    const { frame } = createTestDocumentFrame(state, { height: 260, theme, width: 360 });
    const context = paint(frame);

    expect(findFillTextOperation(context.operations, "Heading")?.fillStyle).toBe("#f5f5f5");
    expect(findFillTextOperation(context.operations, "Paragraph")?.fillStyle).toBe("#f5f5f5");
    expect(findFillTextOperation(context.operations, "Quote")?.fillStyle).toBe("#f5f5f5");
  });

  test("paints decoration background colors behind text", () => {
    let state = setup("alpha TODO\n");
    const container = getPath(state, "alpha TODO");

    state = selectIn(state, container, 6, 10);

    const { frame, layout } = createTestDocumentFrame(state, {
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
    const context = paint(frame);
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

    expect(
      context.operations.filter(
        (operation) => operation.kind === "fillRect" && operation.fillStyle === "#fde047",
      ),
    ).toHaveLength(1);
    expect(selectionPaintIndex).toBeGreaterThan(backgroundPaintIndex);
    expect(baseTextPaintIndex).toBeGreaterThan(backgroundPaintIndex);
    expect(textOverlayPaintIndex).toBeGreaterThan(baseTextPaintIndex);
    expect(backgroundPaint.y).toBeGreaterThanOrEqual(line.top);
    expect(backgroundPaint.height).toBeLessThan(line.height);
  });

  test.each([
    { alpha: 0.71, ambientTime: undefined, now: 550 },
    { alpha: 0.42, ambientTime: undefined, now: 1100 },
    { alpha: 0.42, ambientTime: 1100, now: 1650 },
  ])(
    "pulses animated decoration backgrounds with paint-time alpha (now $now, ambient $ambientTime)",
    ({ alpha, ambientTime, now }) => {
      const state = setup("alpha sparkle\n");
      const { path } = getPath(state, "alpha sparkle");
      const decoration = {
        backgroundColor: "#facc15",
        color: "#713f12",
        endOffset: 13,
        path,
        pulse: true,
        startOffset: 6,
      };
      const { operations } = paint(
        createTestDocumentFrame(state, {
          ambientTime,
          now,
          textDecorations: new Map([[path, [decoration]]]),
        }).frame,
      );
      const background = operations.find(
        (operation) => operation.kind === "fillRect" && operation.fillStyle === "#facc15",
      );
      const textOverlay = operations.find(
        (operation) =>
          operation.kind === "fillText" &&
          operation.text.includes("sparkle") &&
          operation.fillStyle !== resolvedLightTheme.paragraphText,
      );

      expect(background).toMatchObject({ globalAlpha: expect.closeTo(alpha, 2) });
      // The text color pulses with the background rather than painting the raw decoration color.
      expect(textOverlay).toMatchObject({
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
      });
      expect(textOverlay).not.toMatchObject({ fillStyle: "#713f12" });
    },
  );

  test("pulses presence-active comment highlights with ambient time", () => {
    const state = setup("alpha comment\n");
    const path = getPath(state, "alpha comment");

    const { frame } = createTestDocumentFrame(state, {
      ambientTime: 1100,
      height: 180,
      commentRanges: [
        {
          endOffset: 13,
          path: path.path,
          resolved: false,
          startOffset: 6,
          threadIndex: 2,
        },
      ],
      commentPresence: new Map([[2, createPresence({ color: "#f97316", commentThreadIndex: 2 })]]),
      width: 240,
    });
    const context = paint(frame);
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
    const path = getPath(state, "alpha comment");

    const { frame } = createTestDocumentFrame(state, {
      height: 180,
      commentRanges: [
        {
          endOffset: 13,
          path: path.path,
          resolved: false,
          startOffset: 6,
          threadIndex: 2,
        },
      ],
      commentPresence: new Map([[2, createPresence({ commentThreadIndex: 2 })]]),
      width: 240,
    });
    const context = paint(frame);
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
    const { path } = getPathByType(state, "paragraph");
    const { frame, layout } = createTestDocumentFrame(state, {
      height: 180,
      textDecorations: new Map([
        [path, [{ backgroundColor: "#fde047", endOffset: 4, path, startOffset: 0 }]],
      ]),
      width: 240,
    });
    const context = paint(frame);
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

    const decorationBackground = context.operations.find(
      (operation) => operation.kind === "fillRect" && operation.fillStyle === "#fde047",
    );

    if (decorationBackground?.kind !== "fillRect") {
      throw new Error("Expected decoration background paint");
    }

    // Inline code and decoration backgrounds stay visually aligned within a pixel.
    expect(Math.abs(decorationBackground.height - backgroundPaint.height)).toBeLessThanOrEqual(1);
  });

  test("paints superscript with scaled font and raised baseline", () => {
    const state = setup("Area x<sup>2</sup>\n");
    const { frame } = createTestDocumentFrame(state, {
      height: 180,
      width: 240,
    });
    const context = paint(frame);
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

  test("paints strikethrough bars between the line top and baseline of struck runs only", () => {
    const state = setup("~~gone~~ kept\n");
    const { frame, layout } = createTestDocumentFrame(state, { height: 180, width: 240 });
    const context = paint(frame);
    const struck = findFillTextOperation(context.operations, "gone");
    const bars = context.operations.filter(
      (operation) => operation.kind === "fillRect" && operation.fillStyle === struck?.fillStyle,
    );
    const line = layout.lines[0];

    if (!struck || !line || bars.length !== 1 || bars[0]?.kind !== "fillRect") {
      throw new Error("Expected one strikethrough bar across the struck run");
    }

    expect(bars[0].x).toBe(struck.x);
    expect(bars[0].width).toBeGreaterThan(0);
    expect(bars[0].y).toBeGreaterThan(line.top);
    expect(bars[0].y).toBeLessThan(struck.y);
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
    const { frame } = createTestDocumentFrame(state, { height: 360, width: 320 });
    const context = paint(frame);
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
    const { frame } = createTestDocumentFrame(state, { height: 220, width: 320 });
    const context = paint(frame);
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
    const checkmarks = [
      { fontSize: 12, size: 11 },
      { fontSize: 20, size: 18 },
    ].map(({ fontSize, size }) => {
      const theme: ResolvedEditorTheme = { ...resolvedLightTheme, fontSize };
      const context = paint(
        createTestDocumentFrame(state, { height: 180, theme, width: 240 }).frame,
      );
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

      expect(checkboxFill.width).toBe(size);
      expect(checkboxFill.height).toBe(size);

      return {
        lineWidth: checkmarkStroke.lineWidth / size,
        points: checkmarkStroke.path.flatMap((point) => [
          (point.x - checkboxFill.x) / size,
          (point.y - checkboxFill.y) / size,
        ]),
      };
    });
    const [small, large] = checkmarks as [(typeof checkmarks)[0], (typeof checkmarks)[0]];

    // The checkmark keeps its shape relative to the box at every size.
    expect(small.points.every((value) => value > 0 && value < 1)).toBeTrue();
    expect(
      small.points.every((value, index) => approximately(value, large.points[index]!)),
    ).toBeTrue();
    expect(approximately(small.lineWidth, large.lineWidth)).toBeTrue();
  });

  test("keeps markers in the item gutter, outside code, quote, table, and divider surfaces", () => {
    const state = setup(`- Paragraph

  ---
- \`\`\`ts
  code
  \`\`\`
- > Quote
- | Cell | B |
  | - | - |
  | 1 | 2 |

1. \`\`\`ts
   ordered code
   \`\`\`
2. Ordered

- [ ] \`\`\`ts
  task code
  \`\`\`
- [ ] Task
`);
    const { frame } = createTestDocumentFrame(state, { height: 900, width: 420 });
    const surfaces = [...frame.chrome.codeBlockSurfaces, ...frame.chrome.tableCells];
    const gutter = (text: string) => {
      const line = frame.lines.find((candidate) => candidate.layoutLine.text === text);
      const marker = line?.listMarker;

      if (!line || !marker) {
        throw new Error(`Expected a list marker on "${text}"`);
      }

      const [left, right] =
        marker.kind === "ordered"
          ? [marker.anchorX, marker.anchorX]
          : [marker.rect.left, marker.rect.left + marker.rect.width];

      const surface = surfaces.find((candidate) => candidate.path === line.layoutLine.path);

      return { left, right, surfaceLeft: surface?.rect.left ?? Infinity };
    };
    const paragraph = gutter("Paragraph");
    const quoteRule = [...frame.chrome.blockquoteRules.values()][0];

    for (const [first, aligned] of [
      ["code", paragraph],
      ["Quote", paragraph],
      ["Cell", paragraph],
      ["ordered code", gutter("Ordered")],
      ["task code", gutter("Task")],
    ] as const) {
      const marker = gutter(first);

      expect(marker.left).toBe(aligned.left);
      expect(marker.right).toBeLessThanOrEqual(marker.surfaceLeft);
    }

    expect(quoteRule?.rect.left).toBeGreaterThanOrEqual(paragraph.right);
    expect(frame.chrome.dividerRules[0]?.left).toBeGreaterThanOrEqual(paragraph.right);
  });

  test("composes custom list-item-inserted effects before the default marker in isolated canvas state", () => {
    let state = setup("- alpha\n");
    state = placeAt(state, getPath(state, "alpha"), "end");
    state = insertLineBreak(state) ?? state;

    const receivedMarkers: string[] = [];
    const { frame } = createTestDocumentFrame(state, {
      customEffects: {
        listItemInserted: {
          compose: "before",
          paint: ({ context, marker }) => {
            receivedMarkers.push(marker.kind);
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
    const context = paint(frame);
    const customFlashIndex = context.operations.findIndex(
      (operation) => operation.kind === "fillRect" && operation.fillStyle === "#123abc",
    );
    const defaultMarkerIndex = context.operations.findIndex(
      (operation, index) => index > customFlashIndex && operation.kind === "fillPath",
    );

    expect(receivedMarkers).toEqual(["unordered"]);
    expect(customFlashIndex).toBeGreaterThanOrEqual(0);
    expect(defaultMarkerIndex).toBeGreaterThan(customFlashIndex);
    expect(context.operations[defaultMarkerIndex]).toMatchObject({ globalAlpha: 1 });
  });

  test("passes task markers to custom list-item-inserted effects", () => {
    let state = setup("- [ ] alpha\n");
    state = placeAt(state, getPath(state, "alpha"), "end");
    state = insertLineBreak(state) ?? state;

    const receivedMarkers: string[] = [];
    paint(
      createTestDocumentFrame(state, {
        customEffects: {
          listItemInserted: ({ marker }) => {
            receivedMarkers.push(
              marker.kind === "task" ? `${marker.kind}:${marker.checked}` : marker.kind,
            );
          },
        },
        effects: readEditorEffects(state),
        height: 220,
        width: 320,
      }).frame,
    );

    expect(receivedMarkers).toEqual(["task:false"]);
  });

  test("scales popping ordered markers around their effect rect center", () => {
    let state = setup("1. alpha\n");
    state = placeAt(state, getPath(state, "alpha"), "end");
    state = insertLineBreak(state) ?? state;

    const markerRects: DocumintListMarkerPaintFrame["rect"][] = [];
    const translate = spyOn(RecordingCanvasContext.prototype, "translate");
    let translateCalls: [number, number][];

    try {
      paint(
        createTestDocumentFrame(state, {
          customEffects: {
            listItemInserted: {
              compose: "before",
              paint: ({ marker }) => {
                markerRects.push(marker.rect);
              },
            },
          },
          effects: readEditorEffects(state),
          height: 220,
          width: 320,
        }).frame,
      );
      translateCalls = [...(translate.mock.calls as unknown as [number, number][])];
    } finally {
      translate.mockRestore();
    }

    const [rect] = markerRects;

    if (!rect) {
      throw new Error("Expected ordered marker effect rect");
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    expect(translateCalls).toContainEqual([centerX, centerY]);
    expect(translateCalls).toContainEqual([-centerX, -centerY]);
  });
});

describe("Overlay painting", () => {
  test("paints the local caret and resolved presence cursors on the overlay canvas", () => {
    let state = setup("alpha beta gamma\n");
    const container = getPath(state, "alpha beta gamma");

    state = placeAt(state, container, 1);

    const context = paint(
      createTestOverlayFrame(state, {
        presence: [
          createPresence({ color: "#0ea5e9", cursorPoint: { path: container.path, offset: 5 } }),
        ],
        width: 240,
      }),
    );
    const userCaretIndex = context.operations.findIndex((operation) => {
      return operation.kind === "fillRect" && operation.fillStyle === resolvedLightTheme.caret;
    });
    const presenceCaretIndex = context.operations.findIndex((operation) => {
      return operation.kind === "fillRect" && operation.fillStyle === "#0ea5e9";
    });

    expect(userCaretIndex).toBeGreaterThanOrEqual(0);
    expect(presenceCaretIndex).toBeGreaterThanOrEqual(0);
  });
});
