// Frame-level renderer tests. These assert the paint contract produced by
// `createDocumentFrame` / `createOverlayFrame` before any canvas operations run.

import { describe, expect, test } from "bun:test";
import { compareDocuments } from "@/document";
import type { EditorCommentRange } from "@/editor/anchors";
import { createEditorState, setSelection } from "@/editor/state";
import { parseDocument } from "@/markdown";
import type { DocumentFrame, RendererEffect } from "@/renderer";
import type { EffectPolicy } from "@/renderer/effects";
import type { DocumentFrameLine } from "@/renderer/frame";
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
  createTestDocumentFrame,
  createTestOverlayFrame,
  liveDocumentChangeAt,
  resolvedLightTheme,
} from "./helpers";

describe("DocumentFrame line text rows", () => {
  test("resolves text segments as frame rows for text, code, mentions, resources, and images", () => {
    const resources = createResources({
      active: ["demo-resource://recording/live"],
      images: { "https://example.com/image.png": { height: 90, width: 160 } },
    });
    const state = setup(
      "Hello `code` @[Jane Doe](user-123) [Recording](demo-resource://recording/live) ![Alt](https://example.com/image.png)\n",
      { resourceProtocols: ["demo-resource:"] },
    );
    const { frame } = createTestDocumentFrame(state, { resources, width: 760 });
    const line = lineFrameContaining(frame, "Hello");

    expect(line.segments.map((segment) => segment.atom)).toEqual([
      "text",
      "inline-code",
      "text",
      "mention",
      "text",
      "resource",
      "text",
      "image",
    ]);
    const mentionSegment = line.segments.find((segment) => segment.atom === "mention");
    const resourceSegment = line.segments.find((segment) => segment.atom === "resource");

    if (mentionSegment?.atom !== "mention" || resourceSegment?.atom !== "resource") {
      throw new Error("Expected mention and resource segments");
    }

    expect(mentionSegment.mentionName).toBe("Jane Doe");
    expect(mentionSegment.pill.rect.width).toBe(mentionSegment.right - mentionSegment.left);
    expect(mentionSegment.pill.rect.height).toBeGreaterThan(0);
    expect(mentionSegment.pill.textBaseline).toBeGreaterThan(mentionSegment.pill.rect.top);
    expect(mentionSegment.textLeft).toBeGreaterThan(mentionSegment.left);

    expect(resourceSegment.resource).toMatchObject({
      icon: "R",
      isActive: true,
      label: "Recording",
    });
    expect(resourceSegment.pill.rect.width).toBe(resourceSegment.right - resourceSegment.left);
    expect(resourceSegment.pill.rect.height).toBeGreaterThan(0);
    expect(resourceSegment.resource.iconSegmentWidth).toBeGreaterThan(0);
    expect(resourceSegment.resource.labelLeft).toBeGreaterThan(resourceSegment.left);
    expect(line.segments.find((segment) => segment.atom === "image")).toMatchObject({
      image: { url: "https://example.com/image.png" },
    });
    expect(line.segments.every((segment) => "node" in segment === false)).toBe(true);
  });
});

describe("DocumentFrame line range rows", () => {
  test("skips selection highlight rows for collapsed selections", () => {
    const state = setup("alpha\n\nbeta\n");
    const { frame } = createTestDocumentFrame(state);

    expect(frame.lines.every((line) => line.selectionHighlight === null)).toBe(true);
  });

  test("clips selection and comment highlights into line range frame rows", () => {
    let state = setup("alpha\n\nbeta\n\ngamma\n");
    const first = getPath(state, "alpha");
    const second = getPath(state, "beta");
    const third = getPath(state, "gamma");

    state = setSelection(state, {
      anchor: { path: first.path, offset: 2 },
      focus: { path: third.path, offset: 3 },
    });

    const commentRanges: EditorCommentRange[] = [
      {
        endOffset: 3,
        path: second.path,
        resolved: false,
        startOffset: 1,
        threadIndex: 7,
      },
    ];
    const { frame } = createTestDocumentFrame(state, {
      commentPresence: new Map([[7, createPresence({ color: "#f97316", commentThreadIndex: 7 })]]),
      commentRanges,
    });
    const firstLine = lineFrameForPath(frame, first.path);
    const secondLine = lineFrameForPath(frame, second.path);
    const thirdLine = lineFrameForPath(frame, third.path);

    expect(frame.lines.filter((line) => line.selectionHighlight).length).toBe(3);
    expect(firstLine.selectionHighlight?.left).toBeGreaterThan(secondLine.selectionHighlight!.left);
    expect(thirdLine.selectionHighlight!.left + thirdLine.selectionHighlight!.width).toBeLessThan(
      secondLine.selectionHighlight!.left + secondLine.selectionHighlight!.width,
    );
    expect(secondLine.commentHighlights).toHaveLength(1);
    expect(secondLine.commentHighlights[0]).toMatchObject({
      color: "#f97316",
      pulse: true,
    });
    expect(secondLine.commentHighlights[0]!.rect.top).toBeGreaterThan(secondLine.layoutLine.top);
  });
});

describe("DocumentFrame effect policy", () => {
  const textInsertedPolicy: EffectPolicy = {
    duration: (effect) => (effect.kind === "text-inserted" ? 1000 : null),
  };

  test.each([
    { label: "a custom effect policy", options: { effectPolicy: textInsertedPolicy } },
    { label: "a matching custom handler", options: { customEffects: { textInserted() {} } } },
  ])("keeps default-skipped effects active in frame lines with $label", ({ options }) => {
    const state = setup("alpha 🔥\n");
    const path = getPath(state, "alpha 🔥");
    const effect: RendererEffect = {
      kind: "text-inserted",
      text: "🔥",
      contentKind: "inlines",
      path: path.path,
      startOffset: path.text.indexOf("🔥"),
      endOffset: path.text.length,
      startedAt: 100,
    };

    const { frame: defaultFrame } = createTestDocumentFrame(state, {
      effects: [effect],
      now: 110,
    });
    const { frame: customFrame } = createTestDocumentFrame(state, {
      ...options,
      effects: [effect],
      now: 110,
    });

    expect(defaultFrame.effects).toEqual([]);
    expect(customFrame.effects).toEqual([effect]);
    expect(lineFrameForPath(defaultFrame, path.path).textHighlights).toEqual([]);
    expect(lineFrameForPath(customFrame, path.path).textHighlights).toEqual([
      expect.objectContaining({ startOffset: effect.startOffset, endOffset: effect.endOffset }),
    ]);
  });
});

describe("DocumentFrame chrome and block rows", () => {
  test("document-change backgrounds stay separate from active block backgrounds", () => {
    let state = setup("alpha\n\nbeta\n");
    const first = getPath(state, "alpha");

    state = placeAt(state, first, "start");
    const change = liveDocumentChangeAt(state, "old\n\nbeta\n", first.blockPath, "change-alpha");
    const { frame } = createTestDocumentFrame(state, {
      documentChanges: [change],
      effects: [
        {
          changeKey: "change-alpha",
          kind: "document-change",
          startedAt: 100,
        },
      ],
      now: 110,
    });
    const line = lineFrameForPath(frame, first.path);

    expect(line.activeBlockBackground).toMatchObject({
      activeFlash: null,
      color: resolvedLightTheme.activeBlockBackground,
    });
    expect(line.documentChangeBackground).toMatchObject({
      color: resolvedLightTheme.externalChangeModificationBackground,
      opacity: 10 / 420,
    });
    expect(frame.effects).toEqual([expect.objectContaining({ kind: "document-change" })]);
  });

  test("document-change backgrounds keep steady color after the fade effect expires", () => {
    const state = setup("alpha\n\nbeta\n");
    const first = getPath(state, "alpha");
    const change = liveDocumentChangeAt(state, "old\n\nbeta\n", first.blockPath, "change-alpha");
    const { frame } = createTestDocumentFrame(state, {
      documentChanges: [change],
      effects: [
        {
          changeKey: "change-alpha",
          kind: "document-change",
          startedAt: 100,
        },
      ],
      now: 600,
    });
    const line = lineFrameForPath(frame, first.path);

    expect(line.documentChangeBackground).toMatchObject({
      color: resolvedLightTheme.externalChangeModificationBackground,
      opacity: undefined,
    });
    expect(frame.effects).toEqual([]);
  });

  test("document-change backgrounds can target table cells", () => {
    const state = setup(`| A | B |
| - | - |
| one | two |
`);
    const cell = getPath(state, "two");
    const change = liveDocumentChangeAt(state, "| A | B |\n| - | - |\n", cell.path, "change-cell");
    const { frame } = createTestDocumentFrame(state, {
      documentChanges: [change],
      effects: [
        {
          changeKey: "change-cell",
          kind: "document-change",
          startedAt: 100,
        },
      ],
      now: 110,
      width: 360,
    });
    const tableCellChange = frame.tableCellDocumentChanges[0];

    expect(tableCellChange).toMatchObject({
      color: resolvedLightTheme.externalChangeAdditionBackground,
      opacity: 10 / 420,
    });
    expect(tableCellChange?.borderRect.width).toBeGreaterThanOrEqual(80);
  });

  test("renders deleted blocks through the existing document-change background", () => {
    const comparison = compareDocuments(
      parseDocument("before\n\nremoved\n\nafter\n"),
      parseDocument("before\n\nafter\n"),
    );
    const state = createEditorState(comparison.document);
    const removed = getPath(state, "removed");
    const { frame } = createTestDocumentFrame(state, {
      documentChanges: comparison.changes,
    });

    expect(lineFrameForPath(frame, removed.path).documentChangeBackground).toMatchObject({
      color: resolvedLightTheme.externalChangeDeletionBackground,
      opacity: undefined,
    });
  });

  test("renders list markers only on the primary line for mixed list-item children", () => {
    const state = setup(`1. Review and iterate until the guide satisfies the standard:

   - For source-grounded changes
   - Make one bloat-removal pass

   Take only feedback that fixes a real contradiction.
`);
    const { frame } = createTestDocumentFrame(state, { width: 720 });
    const parentLine = lineFrameContaining(frame, "Review and iterate");
    const nestedFirstLine = lineFrameContaining(frame, "For source-grounded changes");
    const nestedSecondLine = lineFrameContaining(frame, "Make one bloat-removal pass");
    const continuationLine = lineFrameContaining(frame, "Take only feedback");

    expect(parentLine.listMarker).toMatchObject({
      kind: "ordered",
      label: "1.",
    });
    expect(nestedFirstLine.listMarker).toMatchObject({ kind: "unordered" });
    expect(nestedSecondLine.listMarker).toMatchObject({ kind: "unordered" });
    expect(continuationLine.listMarker).toBeNull();
  });

  test("resolves table active highlight as chrome and suppresses per-line table active backgrounds", () => {
    let state = setup(`| Left | Active | Right |
| --- | --- | --- |
| one | two | three |
`);
    const activePath = getPath(state, "Active");

    state = placeAt(state, activePath, 1);

    const { frame } = createTestDocumentFrame(state, { width: 480 });

    expect(frame.chrome.activeTableCellGeometry).not.toBeNull();
    expect(frame.chrome.activeTableCellGeometry?.bands.length).toBeGreaterThan(0);

    const tableLines = frame.lines.filter(
      (line) => line.layoutLine.blockPath === activePath.blockPath,
    );
    expect(tableLines.length).toBeGreaterThan(0);
    expect(tableLines.every((line) => line.activeBlockBackground === null)).toBe(true);
    expect(tableLines.some((line) => line.containerBackground?.kind === "table-cell")).toBe(true);
  });

  test("resolves code chrome once while keeping code text rows paint-ready", () => {
    let state = setup("```ts\nconst value = 1;\nconst next = 2;\n```\n");
    const path = getPathByType(state, "code");

    state = placeAt(state, path, 2);

    const { frame } = createTestDocumentFrame(state, { width: 320 });
    const codeLines = frame.lines.filter((line) => line.layoutLine.path === path.path);

    expect(codeLines).toHaveLength(2);
    expect(codeLines.filter((line) => line.containerBackground?.kind === "code")).toHaveLength(1);
    const activeRect = codeLines[0]!.activeBlockBackground!.rect;
    const backgroundRect = codeLines[0]!.containerBackground!.rect;

    expect(activeRect).toMatchObject({ left: backgroundRect.left, width: backgroundRect.width });
    // The active tint sits centered inside the code background padding.
    expect(activeRect.top - backgroundRect.top).toBe(
      backgroundRect.top + backgroundRect.height - (activeRect.top + activeRect.height),
    );
    expect(codeLines[1]?.activeBlockBackground).toBeNull();
    expect(codeLines.every((line) => line.segments.length === 1)).toBe(true);
    expect(codeLines.every((line) => line.defaultTextColor === resolvedLightTheme.codeText)).toBe(
      true,
    );
  });
});

describe("OverlayFrame caret rows", () => {
  test("resolves overlay caret rows before overlay painting", () => {
    let state = setup("alpha beta gamma\n");
    const path = getPath(state, "alpha beta gamma");

    state = selectIn(state, path, 1, 5);

    const frame = createTestOverlayFrame(state, {
      presence: [
        createPresence({ color: "#0ea5e9", cursorPoint: { offset: 7, path: path.path } }),
        createPresence({ color: "#f97316", commentThreadIndex: 2 }),
      ],
    });

    expect(frame.carets).toHaveLength(1);
    expect(frame.carets[0]).toMatchObject({
      color: "#0ea5e9",
    });
    expect(frame.carets[0]!.height).toBeGreaterThan(0);
  });
});

function lineFrameContaining(frame: DocumentFrame, text: string): DocumentFrameLine {
  const line = frame.lines.find((candidate) => candidate.layoutLine.text.includes(text));

  if (!line) {
    throw new Error(`Expected frame line containing "${text}"`);
  }

  return line;
}

function lineFrameForPath(frame: DocumentFrame, path: string): DocumentFrameLine {
  const line = frame.lines.find((candidate) => candidate.layoutLine.path === path);

  if (!line) {
    throw new Error(`Expected frame line for path "${path}"`);
  }

  return line;
}
