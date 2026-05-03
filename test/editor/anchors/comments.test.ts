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
  addComment as addEditorComment,
  createEditorState,
  getDocument,
  insertSoftLineBreak,
  insertText,
  measureCaretTarget,
  prepareLayout,
  resolveHoverTarget,
  setSelection,
} from "@/editor";
import { parseDocument } from "@/markdown";
import { setup } from "../helpers";

test("maps durable comment anchors to live canvas ranges", () => {
  const snapshot = parseDocument("Review surface anchors survive.\n");
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
  const document = parseDocument("Paragraph with [link](https://example.com).\n");
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
  const viewport = prepareLayout(
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
  let state = setup("Review surface\n");
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected editor region");
  }

  state = setSelection(state, {
    regionId: region.id,
    offset: 4,
  });

  const nextState = addEditorComment(
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
  let state = setup("Review surface\n");
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

  const result = addEditorComment(
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

test("preserves an anchored quote when a soft line break is inserted before it", () => {
  // Comment anchors are content-addressable (prefix/suffix matching), so
  // inserting a soft line break adjacent to the anchored span must not
  // perturb the quote text or break resolution. The `\n` introduced by
  // the `LineBreak` inline is treated by the comment-repair logic as a
  // single-character insertion in `region.text`, the same as any other
  // typed character.
  const document = parseDocument("abcd\n");
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

  // Caret at the very start of the paragraph, before the anchored "bc".
  state = setSelection(state, {
    regionId: region.id,
    offset: 0,
  });

  const result = insertSoftLineBreak(state);

  expect(result).not.toBeNull();

  const nextDocument = getDocument(result!);
  const nextThread = nextDocument.comments[0];

  // Quote text is unchanged — the soft break shifted the anchor's start
  // forward by one character without altering what it points at.
  expect(nextThread?.quote).toBe("bc");
});

test("keeps same-region comments sticky while typing inside the anchored quote", () => {
  const document = parseDocument("abcd\n");
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
