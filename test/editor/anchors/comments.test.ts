import { expect, test } from "bun:test";
import {
  createAnchorFromContainer,
  createCommentThread,
  extractQuoteFromContainer,
  listAnchorContainers,
} from "@/document";
import { getCommentState } from "@/editor/anchors";
import {
  createCanvasRenderCache,
  createCommentThread as createEditorCommentThread,
  createEditorState,
  getDocument,
  insertText,
  measureCaretTarget,
  prepareViewport,
  resolveHoverTarget,
  setSelection,
} from "@/editor";
import { parseMarkdown } from "@/markdown";

test("maps durable comment anchors to live canvas ranges", () => {
  const snapshot = parseMarkdown("Review surface anchors survive.\n");
  const container = listAnchorContainers(snapshot)[0];

  if (!container) {
    throw new Error("Expected review container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 7, 14),
    body: "Highlight anchors",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 7, 14),
  });
  const state = createEditorState({
    ...snapshot,
    comments: [thread],
  });
  const commentState = getCommentState(state.documentIndex);

  expect(commentState.threads).toHaveLength(1);
  expect(commentState.liveRanges[0]?.threadIndex).toBe(0);
  expect(commentState.liveRanges[0]?.startOffset).toBeGreaterThanOrEqual(0);
  expect(commentState.liveRanges[0]?.endOffset).toBeGreaterThan(
    commentState.liveRanges[0]?.startOffset ?? 0,
  );
});

test("resolves link hover targets with overlapping comment metadata", () => {
  const renderCache = createCanvasRenderCache();
  const document = parseMarkdown("Paragraph with [link](https://example.com).\n");
  const container = listAnchorContainers(document)[0];

  if (!container) {
    throw new Error("Expected comment container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 15, 19),
    body: "Review this link",
    createdAt: "2026-04-11T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 15, 19),
  });
  const state = createEditorState({
    ...document,
    comments: [thread],
  });
  const viewport = prepareViewport(
    state,
    {
      height: 320,
      top: 0,
      width: 520,
    },
    renderCache,
  );
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected region");
  }

  const linkOffset = region.text.indexOf("link") + 1;
  const caret = measureCaretTarget(state, viewport, {
    regionId: region.id,
    offset: linkOffset,
  });
  const commentState = getCommentState(state.documentIndex);

  if (!caret) {
    throw new Error("Expected caret target");
  }

  const hover = resolveHoverTarget(
    state,
    viewport,
    {
      x: caret.left + 4,
      y: caret.top + caret.height / 2,
    },
    commentState.liveRanges,
  );

  expect(hover).toEqual(
    expect.objectContaining({
      commentThreadIndex: 0,
      kind: "link",
      title: null,
      url: "https://example.com",
    }),
  );
  expect(hover?.kind === "link" ? hover.anchorBottom : 0).toBeGreaterThan(caret.top);
});

test("preserves selection when creating a comment thread", () => {
  let state = createEditorState(parseMarkdown("Review surface\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected editor region");
  }

  state = setSelection(state, {
    regionId: region.id,
    offset: 4,
  });

  const nextState = createEditorCommentThread(
    state,
    { regionId: region.id, startOffset: 0, endOffset: 6 },
    "Review this heading",
  );

  if (!nextState) {
    throw new Error("Expected state change");
  }

  expect(nextState.selection.anchor.regionId).toBe(state.selection.anchor.regionId);
  expect(nextState.selection.anchor.offset).toBe(4);
  expect(nextState.selection.focus.regionId).toBe(state.selection.focus.regionId);
  expect(nextState.selection.focus.offset).toBe(4);
  expect(getDocument(nextState).comments).toHaveLength(1);
});

test("creates a new comment thread from a single-region selection", () => {
  let state = createEditorState(parseMarkdown("Review surface\n"));
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected editor region");
  }

  state = setSelection(state, {
    anchor: {
      offset: 0,
      regionId: region.id,
    },
    focus: {
      offset: 6,
      regionId: region.id,
    },
  });

  const result = createEditorCommentThread(
    state,
    {
      endOffset: 6,
      regionId: region.id,
      startOffset: 0,
    },
    "Review this",
  );

  expect(result).not.toBeNull();
  expect(getDocument(result!).comments).toEqual([
    expect.objectContaining({
      comments: [expect.objectContaining({ body: "Review this" })],
      quote: "Review",
    }),
  ]);
});

test("keeps same-region comments sticky while typing inside the anchored quote", () => {
  const document = parseMarkdown("abcd\n");
  const container = listAnchorContainers(document)[0];

  if (!container) {
    throw new Error("Expected anchor container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 1, 3),
    body: "Track this span",
    createdAt: "2026-04-18T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 1, 3),
  });
  let state = createEditorState({
    ...document,
    comments: [thread],
  });
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected editor region");
  }

  state = setSelection(state, {
    regionId: region.id,
    offset: 2,
  });

  const result = insertText(state, "X");

  expect(result).not.toBeNull();

  const nextDocument = getDocument(result!);
  const nextThread = nextDocument.comments[0];

  expect(nextThread?.quote).toBe("bXc");
  expect(nextThread?.anchor).toEqual({
    prefix: "a",
    suffix: "d",
  });
});
