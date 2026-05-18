import { expect, test } from "bun:test";
import {
  createAnchorFromContainer,
  createCommentThread,
  extractQuoteFromContainer,
  listAnchorContainers,
} from "@/document";
import {
  getCommentState,
  hasActiveCommentHighlightsInViewport,
  resolveActiveCommentIndex,
} from "@/editor/anchors";
import {
  createLayoutCache,
  addComment as addEditorComment,
  createEditorState,
  getDocument,
  insertSoftLineBreak,
  insertText,
  measureCaretTarget,
  createEditorLayoutState,
  resolveHoverTarget,
  setSelection,
  type EditorPresence,
} from "@/editor";
import { parseDocument } from "@/markdown";
import { getRegion, setup } from "../helpers";

test("maps durable comment anchors to runtime comment ranges", () => {
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
  expect(commentState.ranges[0]?.threadIndex).toBe(0);
  expect(commentState.ranges[0]?.startOffset).toBeGreaterThanOrEqual(0);
  expect(commentState.ranges[0]?.endOffset).toBeGreaterThan(
    commentState.ranges[0]?.startOffset ?? 0,
  );
});

test("detects only unresolved presence-active comment highlights as animated", () => {
  const layoutCache = createLayoutCache();
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
  const unresolvedState = createEditorState({
    ...snapshot,
    comments: [thread],
  });
  const unresolvedViewport = createEditorLayoutState(
    unresolvedState,
    { height: 320, top: 0, width: 520 },
    layoutCache,
  );
  const unresolvedCommentState = getCommentState(unresolvedState.documentIndex);

  const presenceMap = new Map<number, EditorPresence>([
    [0, { commentThreadIndex: 0, cursorPoint: null, id: "user", username: "User", viewport: null }],
  ]);

  expect(
    hasActiveCommentHighlightsInViewport(
      unresolvedViewport,
      unresolvedCommentState.ranges,
      presenceMap,
    ),
  ).toBe(true);

  const resolvedState = createEditorState({
    ...snapshot,
    comments: [{ ...thread, resolvedAt: "2026-04-05T13:00:00.000Z" }],
  });
  const resolvedViewport = createEditorLayoutState(
    resolvedState,
    { height: 320, top: 0, width: 520 },
    layoutCache,
  );
  const resolvedCommentState = getCommentState(resolvedState.documentIndex);

  expect(
    hasActiveCommentHighlightsInViewport(
      resolvedViewport,
      resolvedCommentState.ranges,
      presenceMap,
    ),
  ).toBe(false);
});

test("resolves link hover targets with overlapping comment metadata", () => {
  const layoutCache = createLayoutCache();
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
  const viewport = createEditorLayoutState(
    state,
    {
      height: 320,
      top: 0,
      width: 520,
    },
    layoutCache,
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
  if (!caret) {
    throw new Error("Expected caret target");
  }

  const hover = resolveHoverTarget(state, viewport, {
    x: caret.left + 4,
    y: caret.top + caret.height / 2,
  });

  expect(hover).toEqual(
    expect.objectContaining({
      commentThreadIndex: 0,
      kind: "link",
      title: null,
      url: "https://example.com",
    }),
  );
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

test("resolveActiveCommentIndex returns null when no ranges exist", () => {
  const state = setup("alpha beta\n");

  expect(resolveActiveCommentIndex(state, [])).toBeNull();
});

test("resolveActiveCommentIndex returns the thread covering a collapsed caret", () => {
  let state = setup("alpha beta\n");
  const region = getRegion(state, "alpha beta");
  const commented = addEditorComment(
    state,
    { regionId: region.id, startOffset: 0, endOffset: 5 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  state = setSelection(commented, { regionId: region.id, offset: 3 });
  const { ranges } = getCommentState(state);

  expect(resolveActiveCommentIndex(state, ranges)).toBe(0);
});

test("resolveActiveCommentIndex treats range bounds as inclusive for a collapsed caret", () => {
  let state = setup("alpha beta\n");
  const region = getRegion(state, "alpha beta");
  const commented = addEditorComment(
    state,
    { regionId: region.id, startOffset: 1, endOffset: 4 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  const { ranges } = getCommentState(commented);
  const atStart = setSelection(commented, { regionId: region.id, offset: 1 });
  const atEnd = setSelection(commented, { regionId: region.id, offset: 4 });
  const justBefore = setSelection(commented, { regionId: region.id, offset: 0 });
  const justAfter = setSelection(commented, { regionId: region.id, offset: 5 });

  expect(resolveActiveCommentIndex(atStart, ranges)).toBe(0);
  expect(resolveActiveCommentIndex(atEnd, ranges)).toBe(0);
  expect(resolveActiveCommentIndex(justBefore, ranges)).toBeNull();
  expect(resolveActiveCommentIndex(justAfter, ranges)).toBeNull();
});

test("resolveActiveCommentIndex uses an open-interval overlap for ranged selections", () => {
  let state = setup("alpha beta\n");
  const region = getRegion(state, "alpha beta");
  const commented = addEditorComment(
    state,
    { regionId: region.id, startOffset: 2, endOffset: 5 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  const { ranges } = getCommentState(commented);

  // Touching the comment range at its end-boundary with a positive-length
  // selection: no shared interior, so no thread is reported.
  const touching = setSelection(commented, {
    anchor: { regionId: region.id, offset: 5 },
    focus: { regionId: region.id, offset: 8 },
  });
  // Overlap by one character: shared interior, thread is reported.
  const overlapping = setSelection(commented, {
    anchor: { regionId: region.id, offset: 4 },
    focus: { regionId: region.id, offset: 8 },
  });

  expect(resolveActiveCommentIndex(touching, ranges)).toBeNull();
  expect(resolveActiveCommentIndex(overlapping, ranges)).toBe(0);
});

test("resolveActiveCommentIndex resolves selections that span regions", () => {
  let state = setup("alpha\n\nbeta\n");
  const alpha = getRegion(state, "alpha");
  const beta = getRegion(state, "beta");
  const commented = addEditorComment(
    state,
    { regionId: beta.id, startOffset: 0, endOffset: 2 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  const { ranges } = getCommentState(commented);
  state = setSelection(commented, {
    anchor: { regionId: alpha.id, offset: 0 },
    focus: { regionId: beta.id, offset: 1 },
  });

  expect(resolveActiveCommentIndex(state, ranges)).toBe(0);
});
