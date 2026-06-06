// Frame-level renderer tests. These assert the paint contract produced by
// `createDocumentFrame` / `createOverlayFrame` before any canvas operations run.

import { describe, expect, test } from "bun:test";
import type { EditorCommentRange, EditorPresence } from "@/editor/anchors";
import { createEditorLayoutState } from "@/editor/layout";
import {
  createEditorState,
  normalizeSelection,
  setSelection,
  type EditorState,
} from "@/editor/state";
import type { DocumentResources, ResolvedEditorTheme } from "@/types";
import { lightTheme, resolveEditorTheme } from "@/component/lib/themes";
import { parseDocument, type MarkdownOptions } from "@/markdown";
import { createDocumentFrame, createOverlayFrame, type DocumentFrame } from "@/renderer";
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
  test("clips selection and comment highlights into line range frame rows", () => {
    let state = setup("alpha\n\nbeta\n\ngamma\n");
    const [first, second, third] = state.documentIndex.regions;

    if (!first || !second || !third) {
      throw new Error("Expected three paragraph regions");
    }

    state = setSelection(state, {
      anchor: { regionId: first.id, offset: 2 },
      focus: { regionId: third.id, offset: 3 },
    });

    const commentRanges: EditorCommentRange[] = [
      {
        endOffset: 3,
        regionId: second.id,
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
    const firstLine = lineFrameForRegion(frame, first.id);
    const secondLine = lineFrameForRegion(frame, second.id);
    const thirdLine = lineFrameForRegion(frame, third.id);

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

describe("DocumentFrame chrome and block rows", () => {
  test("resolves table active highlight as chrome and suppresses per-line table active backgrounds", () => {
    let state = setup(`| Left | Active | Right |
| --- | --- | --- |
| one | two | three |
`);
    const activeRegion = state.documentIndex.regions.find((region) => region.text === "Active");

    if (!activeRegion) {
      throw new Error("Expected active table cell region");
    }

    state = setSelection(state, { regionId: activeRegion.id, offset: 1 });

    const frame = createTestDocumentFrame(state, {
      activeBlockId: activeRegion.block.id,
      activeRegionId: activeRegion.id,
      width: 480,
    });

    expect(frame.chrome.activeTableCellHighlight).not.toBeNull();
    expect(frame.chrome.activeTableCellHighlight?.bands.length).toBeGreaterThan(0);

    const tableLines = frame.lines.filter(
      (line) => line.layoutLine.blockId === activeRegion.block.id,
    );
    expect(tableLines.length).toBeGreaterThan(0);
    expect(tableLines.every((line) => line.activeBlockBackground === null)).toBe(true);
    expect(tableLines.some((line) => line.containerBackground?.kind === "table-cell")).toBe(true);
  });

  test("resolves code chrome once while keeping code text rows paint-ready", () => {
    let state = setup("```ts\nconst value = 1;\nconst next = 2;\n```\n");
    const region = state.documentIndex.regions[0];

    if (!region) {
      throw new Error("Expected code region");
    }

    state = setSelection(state, { regionId: region.id, offset: 2 });

    const frame = createTestDocumentFrame(state, {
      activeBlockId: region.block.id,
      width: 320,
    });
    const codeLines = frame.lines.filter((line) => line.layoutLine.regionId === region.id);

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
    const region = state.documentIndex.regions[0];

    if (!region) {
      throw new Error("Expected paragraph region");
    }

    state = setSelection(state, {
      anchor: { regionId: region.id, offset: 1 },
      focus: { regionId: region.id, offset: 5 },
    });

    const frame = createTestOverlayFrame(state, {
      presence: [
        createPresence(1, "#0ea5e9", {
          offset: 7,
          regionId: region.id,
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
    activeBlockId,
    activeRegionId = state.selection.focus.regionId,
    activeThreadIndex = null,
    commentPresence,
    commentRanges = [],
    height = 420,
    resources = emptyDocumentResources,
    theme = resolvedLightTheme,
    width = 420,
  }: {
    activeBlockId?: string | null;
    activeRegionId?: string | null;
    activeThreadIndex?: number | null;
    commentPresence?: ReadonlyMap<number, EditorPresence>;
    commentRanges?: EditorCommentRange[];
    height?: number;
    resources?: DocumentResources;
    theme?: ResolvedEditorTheme;
    width?: number;
  } = {},
) {
  const resolvedActiveBlockId =
    activeBlockId ??
    state.documentIndex.regionIndex.get(state.selection.focus.regionId)?.block.id ??
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
    activeBlockId: resolvedActiveBlockId,
    activeRegionId,
    activeThreadIndex,
    commentPresence,
    commentRanges,
    devicePixelRatio: 1,
    height,
    normalizedSelection: normalizeSelection(state),
    now: 0,
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

function lineFrameForRegion(frame: DocumentFrame, regionId: string): DocumentFrameLine {
  const line = frame.lines.find((candidate) => candidate.layoutLine.regionId === regionId);

  if (!line) {
    throw new Error(`Expected frame line for region "${regionId}"`);
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
