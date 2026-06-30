import { indexedTextEntries } from "@test/editor/helpers";
// Frame-level renderer tests. These assert the paint contract produced by
// `createDocumentFrame` / `createOverlayFrame` before any canvas operations run.

import { describe, expect, test } from "bun:test";
import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import { createEditorLayoutState } from "@/editor/layout";
import {
  createEditorState,
  normalizeSelection,
  resolveIndexedBlockContainingPath,
  setSelection,
  type EditorState,
} from "@/editor/state";
import type { DocumintEffects, DocumentResources, ResolvedEditorTheme } from "@/types";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import { parseDocument, type MarkdownOptions } from "@/markdown";
import {
  createDocumentFrame,
  createOverlayFrame,
  type DocumentFrame,
  type RendererEffect,
} from "@/renderer";
import type { EffectPolicy } from "@/renderer/effects";
import type { DocumentFrameLine } from "@/renderer/frame";
import { emptyDocumentResources } from "@/editor/resources";
import { setup } from "../editor/helpers";

const resolvedLightTheme = resolveEditorTheme(lightTheme);

describe("DocumentFrame line text rows", () => {
  test("resolves text segments as frame rows for text, code, mentions, resources, and images", () => {
    const resources = createResourceFixture({
      activeResources: ["demo-resource://recording/live"],
      images: [["https://example.com/image.png", { height: 90, width: 160 }]],
    });
    const state = createState(
      "Hello `code` @[Jane Doe](user-123) [Recording](demo-resource://recording/live) ![Alt](https://example.com/image.png)\n",
      {
        resourceProtocols: ["demo-resource:"],
      },
    );
    const frame = createTestDocumentFrame(state, { resources, width: 760 });
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
    const frame = createTestDocumentFrame(state);

    expect(frame.lines.every((line) => line.selectionHighlight === null)).toBe(true);
  });

  test("clips selection and comment highlights into line range frame rows", () => {
    let state = setup("alpha\n\nbeta\n\ngamma\n");
    const [first, second, third] = indexedTextEntries(state);

    if (!first || !second || !third) {
      throw new Error("Expected three paragraph paths");
    }

    state = setSelection(state, {
      anchor: { path: first.path, offset: 2 },
      focus: { path: third.path, offset: 3 },
    });

    const commentRanges: EditorCommentRange[] = [
      {
        endOffset: 3,
        path: second.path,
        resolution: { match: null, repair: null, status: "stale" },
        resolved: false,
        startOffset: 1,
        threadIndex: 7,
      },
    ];
    const frame = createTestDocumentFrame(state, {
      commentPresence: new Map([[7, createPresence(7, "#f97316")]]),
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
  test("forwards custom effect policy into frame lines", () => {
    const state = setup("alpha 🔥\n");
    const path = indexedTextEntries(state)[0];

    if (!path) {
      throw new Error("Expected paragraph path");
    }

    const effect: RendererEffect = {
      kind: "text-inserted",
      text: "🔥",
      contentKind: "inlines",
      path: path.path,
      startOffset: path.text.indexOf("🔥"),
      endOffset: path.text.length,
      startedAt: 100,
    };
    const effectPolicy: EffectPolicy = {
      duration: (currentEffect) => (currentEffect.kind === "text-inserted" ? 1000 : null),
    };

    const defaultFrame = createTestDocumentFrame(state, {
      effects: [effect],
      now: 110,
    });
    const customFrame = createTestDocumentFrame(state, {
      effectPolicy,
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

  test("keeps default-skipped effects active when a matching custom handler exists", () => {
    const state = setup("alpha 🔥\n");
    const path = indexedTextEntries(state)[0];

    if (!path) {
      throw new Error("Expected paragraph path");
    }

    const effect: RendererEffect = {
      kind: "text-inserted",
      text: "🔥",
      contentKind: "inlines",
      path: path.path,
      startOffset: path.text.indexOf("🔥"),
      endOffset: path.text.length,
      startedAt: 100,
    };

    const defaultFrame = createTestDocumentFrame(state, {
      effects: [effect],
      now: 110,
    });
    const customFrame = createTestDocumentFrame(state, {
      customEffects: {
        textInserted: () => {},
      },
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
    const first = indexedTextEntries(state)[0];

    if (!first) {
      throw new Error("Expected first path");
    }

    state = setSelection(state, { path: first.path, offset: 0 });
    const frame = createTestDocumentFrame(state, {
      documentChanges: [
        {
          changeKey: "change-alpha",
          changeKind: "modified",
          target: { kind: "block", path: first.blockPath },
        },
      ],
      effects: [
        {
          changeKey: "change-alpha",
          changeKind: "modified",
          kind: "document-change",
          startedAt: 100,
          target: { kind: "block", path: "root.old" },
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
    expect(frame.effects).toEqual([
      expect.objectContaining({ kind: "document-change" }),
    ]);
  });

  test("document-change backgrounds keep steady color after the fade effect expires", () => {
    const state = setup("alpha\n\nbeta\n");
    const first = indexedTextEntries(state)[0];

    if (!first) {
      throw new Error("Expected first path");
    }

    const frame = createTestDocumentFrame(state, {
      documentChanges: [
        {
          changeKey: "change-alpha",
          changeKind: "modified",
          target: { kind: "block", path: first.blockPath },
        },
      ],
      effects: [
        {
          changeKey: "change-alpha",
          changeKind: "modified",
          kind: "document-change",
          startedAt: 100,
          target: { kind: "block", path: "root.old" },
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
    const cell = indexedTextEntries(state).find((path) => path.text === "two");

    if (!cell) {
      throw new Error("Expected table cell path");
    }

    const frame = createTestDocumentFrame(state, {
      documentChanges: [
        {
          changeKey: "change-cell",
          changeKind: "added",
          target: {
            kind: "table-cell",
            path: cell.path,
          },
        },
      ],
      effects: [
        {
          changeKey: "change-cell",
          changeKind: "added",
          kind: "document-change",
          startedAt: 100,
          target: {
            kind: "table-cell",
            path: "root.0.rows.9.cells.9",
          },
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

  test("renders list markers only on the primary line for mixed list-item children", () => {
    const state = createState(`1. Review and iterate until the guide satisfies the standard:

   - For source-grounded changes
   - Make one bloat-removal pass

   Take only feedback that fixes a real contradiction.
`);
    const frame = createTestDocumentFrame(state, { width: 720 });
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
    const activePath = indexedTextEntries(state).find((path) => path.text === "Active");

    if (!activePath) {
      throw new Error("Expected active table cell path");
    }

    state = setSelection(state, { path: activePath.path, offset: 1 });

    const frame = createTestDocumentFrame(state, {
      activeBlockPath: activePath.blockPath,
      activePath: activePath.path,
      width: 480,
    });

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
    const path = indexedTextEntries(state)[0];

    if (!path) {
      throw new Error("Expected code path");
    }

    state = setSelection(state, { path: path.path, offset: 2 });

    const frame = createTestDocumentFrame(state, {
      activeBlockPath: path.blockPath,
      width: 320,
    });
    const codeLines = frame.lines.filter((line) => line.layoutLine.path === path.path);

    expect(codeLines).toHaveLength(2);
    expect(codeLines.filter((line) => line.containerBackground?.kind === "code")).toHaveLength(1);
    expect(codeLines[0]?.activeBlockBackground?.rect).toMatchObject({
      left: codeLines[0].containerBackground?.rect.left,
      width: codeLines[0].containerBackground?.rect.width,
    });
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
    const path = indexedTextEntries(state)[0];

    if (!path) {
      throw new Error("Expected paragraph path");
    }

    state = setSelection(state, {
      anchor: { path: path.path, offset: 1 },
      focus: { path: path.path, offset: 5 },
    });

    const frame = createTestOverlayFrame(state, {
      presence: [
        createPresence(1, "#0ea5e9", {
          offset: 7,
          path: path.path,
        }),
        createPresence(2, "#f97316", null),
      ],
    });

    expect(frame.carets).toHaveLength(1);
    expect(frame.carets[0]).toMatchObject({
      color: "#0ea5e9",
    });
    expect(frame.carets[0]!.height).toBeGreaterThan(0);
  });
});

function createState(markdown: string, options: MarkdownOptions = {}) {
  return createEditorState(parseDocument(markdown, options));
}

function createTestDocumentFrame(
  state: EditorState,
  {
    activeBlockPath,
    activePath = state.selection.focus.path,
    activeThreadIndex = null,
    commentPresence,
    commentRanges = [],
    customEffects,
    effectPolicy,
    effects,
    documentChanges,
    height = 420,
    now = 0,
    resources = emptyDocumentResources,
    theme = resolvedLightTheme,
    width = 420,
  }: {
    activeBlockPath?: string | null;
    activePath?: string | null;
    activeThreadIndex?: number | null;
    commentPresence?: ReadonlyMap<number, EditorPresence>;
    commentRanges?: EditorCommentRange[];
    customEffects?: DocumintEffects;
    effectPolicy?: EffectPolicy;
    effects?: readonly RendererEffect[];
    documentChanges?: Parameters<typeof createDocumentFrame>[2]["documentChanges"];
    height?: number;
    now?: number;
    resources?: DocumentResources;
    theme?: ResolvedEditorTheme;
    width?: number;
  } = {},
) {
  const resolvedActiveBlockPath =
    activeBlockPath ??
    resolveIndexedBlockContainingPath(state.documentIndex, state.selection.focus.path)?.path ??
    null;
  const layoutState = createEditorLayoutState(
    state,
    {
      height,
      top: 0,
      width,
    },
    undefined,
    resources,
  );
  return createDocumentFrame(state, layoutState, {
    activeBlockPath: resolvedActiveBlockPath,
    activePath,
    activeThreadIndex,
    commentPresence,
    commentRanges,
    devicePixelRatio: 1,
    customEffects,
    effectPolicy,
    effects,
    documentChanges,
    height,
    normalizedSelection: normalizeSelection(state),
    now,
    resources,
    theme,
    width,
  });
}

function createTestOverlayFrame(
  state: EditorState,
  {
    height = 180,
    presence = [],
    width = 420,
  }: {
    height?: number;
    presence?: EditorPresence[];
    width?: number;
  } = {},
) {
  const layoutState = createEditorLayoutState(state, {
    height,
    top: 0,
    width,
  });

  return createOverlayFrame(state, layoutState, {
    devicePixelRatio: 1,
    height,
    normalizedSelection: normalizeSelection(state),
    presence,
    showCaret: true,
    theme: resolvedLightTheme,
    width,
  });
}

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

function createResourceFixture({
  activeResources = [],
  images = [],
}: {
  activeResources?: string[];
  images?: Array<[string, { height: number; width: number }]>;
} = {}): DocumentResources {
  return {
    images: new Map(
      images.map(([url, size]) => [
        url,
        {
          intrinsicHeight: size.height,
          intrinsicWidth: size.width,
          source: null,
          status: "loaded" as const,
        },
      ]),
    ),
    resourceRegistry: {
      active: new Set(activeResources),
      protocols: new Map([["demo-resource:", { icon: "R", label: "Demo resource" }]]),
    },
  };
}

function createPresence(
  threadIndex: number,
  color: string | null,
  cursorPoint: EditorPresence["cursorPoint"] = null,
): EditorPresence {
  return {
    color: color ?? undefined,
    commentThreadIndex: threadIndex,
    cursor: { prefix: "" },
    cursorPoint,
    id: `presence-${threadIndex}`,
    isOnUnresolvedCommentThread: cursorPoint === null,
    username: `Presence ${threadIndex}`,
    viewport: null,
  };
}
