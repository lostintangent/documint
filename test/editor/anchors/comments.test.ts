import { indexedTextEntries } from "@test/editor/helpers";
import { expect, test } from "bun:test";
import {
  createAnchorFromContainer,
  createCommentThread,
  createDocument,
  createImage,
  createMention,
  createParagraphBlock,
  createParagraphTextBlock,
  createResource,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
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
  resolveEditorTextAtPath,
  resolveHoverTarget,
  setSelection,
  type EditorPresence,
} from "@/editor";
import { parseDocument } from "@/markdown";
import { getPath, setup } from "../helpers";

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

test("keeps comment thread array identity when resolution does not repair anchors", () => {
  const document = createDocument([createParagraphTextBlock("alpha beta")]);
  const container = listAnchorContainers(document)[0];

  if (!container) {
    throw new Error("Expected comment container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 0, "alpha".length),
    body: "Track alpha",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 0, "alpha".length),
  });
  const state = createEditorState(createDocument(document.blocks, [thread]));
  const commentState = getCommentState(state.documentIndex);

  expect(commentState.threads).toBe(state.documentIndex.document.comments);
  expect(commentState.ranges).toHaveLength(1);
});

test("resolves reference-inline comment anchors to runtime offsets", () => {
  const document = createDocument([
    createParagraphBlock([
      createText("Hello "),
      createMention({ name: "Jane Doe", userId: "user-123" }),
      createText(" world"),
    ]),
  ]);
  const container = listAnchorContainers(document)[0];

  if (!container) {
    throw new Error("Expected comment container");
  }

  const startOffset = "Hello ".length;
  const endOffset = "Hello @Jane Doe".length;
  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, startOffset, endOffset),
    body: "Track mention",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, startOffset, endOffset),
  });
  const state = createEditorState({
    ...document,
    comments: [thread],
  });
  const range = getCommentState(state.documentIndex).ranges[0];
  const path = indexedTextEntries(state)[0];

  expect(path?.text).not.toContain("@Jane Doe");
  expect(path?.text.length).toBe("Hello ".length + 1 + " world".length);
  expect(thread.quote).toBe("@Jane Doe");
  expect(range?.startOffset).toBe("Hello ".length);
  expect(range?.endOffset).toBe("Hello ".length + 1);
});

test("resolves image and resource comment anchors to runtime atoms", () => {
  const document = createDocument([
    createParagraphBlock([
      createText("See "),
      createImage({ alt: "Preview", url: "https://example.com/image.png" }),
      createText(" and "),
      createResource({
        label: "Recording",
        protocol: "demo-resource:",
        url: "demo-resource://recording/live",
      }),
      createText(" now"),
    ]),
  ]);
  const container = listAnchorContainers(document)[0];

  if (!container) {
    throw new Error("Expected comment container");
  }

  const imageStart = "See ".length;
  const imageEnd = "See Preview".length;
  const resourceStart = "See Preview and ".length;
  const resourceEnd = "See Preview and Recording".length;
  const imageThread = createCommentThread({
    anchor: createAnchorFromContainer(container, imageStart, imageEnd),
    body: "Track image",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, imageStart, imageEnd),
  });
  const resourceThread = createCommentThread({
    anchor: createAnchorFromContainer(container, resourceStart, resourceEnd),
    body: "Track resource",
    createdAt: "2026-04-05T12:01:00.000Z",
    quote: extractQuoteFromContainer(container, resourceStart, resourceEnd),
  });
  const state = createEditorState({
    ...document,
    comments: [imageThread, resourceThread],
  });
  const ranges = getCommentState(state.documentIndex).ranges;
  const path = indexedTextEntries(state)[0];

  expect(path?.text).toBe("See \uFFFC and \uFFFC now");
  expect(ranges.map((range) => [range.startOffset, range.endOffset])).toEqual([
    ["See ".length, "See ".length + 1],
    ["See \uFFFC and ".length, "See \uFFFC and ".length + 1],
  ]);
});

test("resolves table-cell reference comment anchors to runtime offsets", () => {
  const document = createDocument([
    createTableBlock({
      rows: [
        createTableRow([
          createTableCell([
            createText("Cell "),
            createMention({ name: "Jane Doe", userId: "user-123" }),
            createText(" done"),
          ]),
        ]),
      ],
    }),
  ]);
  const container = listAnchorContainers(document).find(
    (candidate) => candidate.text === "Cell @Jane Doe done",
  );

  if (!container) {
    throw new Error("Expected table-cell comment container");
  }

  const startOffset = "Cell ".length;
  const endOffset = "Cell @Jane Doe".length;
  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, startOffset, endOffset),
    body: "Track table mention",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, startOffset, endOffset),
  });
  const state = createEditorState({
    ...document,
    comments: [thread],
  });
  const range = getCommentState(state.documentIndex).ranges[0];
  const path = indexedTextEntries(state).find((candidate) => candidate.text === "Cell \uFFFC done");

  if (!path) {
    throw new Error("Expected table-cell path");
  }

  expect(range?.path).toBe(path.path);
  expect(range?.startOffset).toBe("Cell ".length);
  expect(range?.endOffset).toBe("Cell ".length + 1);
});

test("resolves moved paragraph comments by anchor match instead of old path occupant", () => {
  const baseDocument = parseDocument(`old occupant

target phrase
`);
  const container = listAnchorContainers(baseDocument)[1];

  if (!container) {
    throw new Error("Expected target container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 0, "target".length),
    body: "Track moved paragraph",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 0, "target".length),
  });
  const shiftedState = createEditorState({
    ...parseDocument(`inserted paragraph

old occupant

target phrase
`),
    comments: [thread],
  });
  const commentState = getCommentState(shiftedState.documentIndex);
  const range = commentState.ranges[0];
  const text = range ? resolveEditorTextAtPath(shiftedState.documentIndex, range.path) : null;

  expect(text).toBe("target phrase");
  expect(range?.startOffset).toBe(0);
  expect(range?.endOffset).toBe("target".length);
});

test("leaves comments on deleted paragraph content stale instead of using the old path occupant", () => {
  const baseDocument = parseDocument(`old occupant

target phrase
`);
  const container = listAnchorContainers(baseDocument)[1];

  if (!container) {
    throw new Error("Expected target container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 0, "target".length),
    body: "Track deleted paragraph",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 0, "target".length),
  });
  const replacedState = createEditorState({
    ...parseDocument(`old occupant

replacement phrase
`),
    comments: [thread],
  });
  const commentState = getCommentState(replacedState.documentIndex);

  expect(commentState.ranges).toEqual([]);
  expect(commentState.threads[0]).toBe(thread);
});

test("resolves moved table-cell comments by anchor match instead of old cell path occupant", () => {
  const baseDocument = parseDocument(`| A | B |
| - | - |
| old | target |
`);
  const container = listAnchorContainers(baseDocument).find(
    (candidate) => candidate.text === "target",
  );

  if (!container) {
    throw new Error("Expected target table-cell container");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(container, 0, "target".length),
    body: "Track moved cell",
    createdAt: "2026-04-05T12:00:00.000Z",
    quote: extractQuoteFromContainer(container, 0, "target".length),
  });
  const shiftedState = createEditorState({
    ...parseDocument(`| A | B |
| - | - |
| inserted | filler |
| old | target |
`),
    comments: [thread],
  });
  const commentState = getCommentState(shiftedState.documentIndex);
  const range = commentState.ranges[0];
  const text = range ? resolveEditorTextAtPath(shiftedState.documentIndex, range.path) : null;

  expect(text).toBe("target");
  expect(range?.path).toBe("root.0.rows.2.cells.1");
  expect(range?.startOffset).toBe(0);
  expect(range?.endOffset).toBe("target".length);
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
    [
      0,
      {
        commentThreadIndex: 0,
        cursorPoint: null,
        id: "user",
        isOnUnresolvedCommentThread: true,
        username: "User",
        viewport: null,
      },
    ],
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
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected path");
  }

  const linkOffset = path.text.indexOf("link") + 1;
  const caret = measureCaretTarget(state, viewport, {
    path: path.path,
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
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editor path");
  }

  state = setSelection(state, {
    path: path.path,
    offset: 4,
  });

  const nextState = addEditorComment(
    state,
    { path: path.path, startOffset: 0, endOffset: 6 },
    "Review this heading",
  );

  if (!nextState) {
    throw new Error("Expected state change");
  }

  expect(nextState.selection.anchor.path).toBe(state.selection.anchor.path);
  expect(nextState.selection.anchor.offset).toBe(4);
  expect(nextState.selection.focus.path).toBe(state.selection.focus.path);
  expect(nextState.selection.focus.offset).toBe(4);
  expect(getDocument(nextState).comments).toHaveLength(1);
});

test("creates a new comment thread from a single-path selection", () => {
  let state = setup("Review surface\n");
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editor path");
  }

  state = setSelection(state, {
    anchor: {
      offset: 0,
      path: path.path,
    },
    focus: {
      offset: 6,
      path: path.path,
    },
  });

  const result = addEditorComment(
    state,
    {
      endOffset: 6,
      path: path.path,
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

test("creates comments over reference inlines from runtime offsets", () => {
  const document = createDocument([
    createParagraphBlock([
      createText("Hello "),
      createMention({ name: "Jane Doe", userId: "user-123" }),
      createText(" world"),
    ]),
  ]);
  const state = createEditorState(document);
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editor path");
  }

  const result = addEditorComment(
    state,
    {
      endOffset: "Hello ".length + 1,
      path: path.path,
      startOffset: "Hello ".length,
    },
    "Review mention",
  );
  const comment = result ? getDocument(result).comments[0] : null;
  const range = result ? getCommentState(result.documentIndex).ranges[0] : null;

  expect(comment?.quote).toBe("@Jane Doe");
  expect(range?.startOffset).toBe("Hello ".length);
  expect(range?.endOffset).toBe("Hello ".length + 1);
});

test("does not create comments over reference atoms without semantic text", () => {
  const document = createDocument([
    createParagraphBlock([
      createText("See "),
      createImage({ alt: null, url: "https://example.com/image.png" }),
      createText(" now"),
    ]),
  ]);
  const state = createEditorState(document);
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editor path");
  }

  const result = addEditorComment(
    state,
    {
      endOffset: "See ".length + 1,
      path: path.path,
      startOffset: "See ".length,
    },
    "Review image",
  );

  expect(path.text).toBe("See \uFFFC now");
  expect(result).toBeNull();
});

test("preserves an anchored quote when a soft line break is inserted before it", () => {
  // Comment anchors are content-addressable (prefix/suffix matching), so
  // inserting a soft line break adjacent to the anchored span must not
  // perturb the quote text or break resolution. The `\n` introduced by
  // the `LineBreak` inline is treated by the comment-repair logic as a
  // single-character insertion in `path.text`, the same as any other
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
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editor path");
  }

  // Caret at the very start of the paragraph, before the anchored "bc".
  state = setSelection(state, {
    path: path.path,
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

test("keeps same-path comments sticky while typing inside the anchored quote", () => {
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
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editor path");
  }

  state = setSelection(state, {
    path: path.path,
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

test("keeps reference-inline comments sticky when typing before them", () => {
  const document = createDocument([
    createParagraphBlock([
      createText("Hello "),
      createMention({ name: "Jane Doe", userId: "user-123" }),
      createText(" world"),
    ]),
  ]);
  let state = createEditorState(document);
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected editor path");
  }

  state = addEditorComment(
    state,
    {
      endOffset: "Hello ".length + 1,
      path: path.path,
      startOffset: "Hello ".length,
    },
    "Review mention",
  )!;
  state = setSelection(state, {
    path: path.path,
    offset: 0,
  });

  const result = insertText(state, "Say ");

  expect(result).not.toBeNull();

  const nextThread = getDocument(result!).comments[0];
  const nextRange = getCommentState(result!.documentIndex).ranges[0];

  expect(nextThread?.quote).toBe("@Jane Doe");
  expect(nextRange?.startOffset).toBe("Say Hello ".length);
  expect(nextRange?.endOffset).toBe("Say Hello ".length + 1);
});

test("resolveActiveCommentIndex returns null when no ranges exist", () => {
  const state = setup("alpha beta\n");

  expect(resolveActiveCommentIndex(state, [])).toBeNull();
});

test("resolveActiveCommentIndex returns the thread covering a collapsed caret", () => {
  let state = setup("alpha beta\n");
  const path = getPath(state, "alpha beta");
  const commented = addEditorComment(
    state,
    { path: path.path, startOffset: 0, endOffset: 5 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  state = setSelection(commented, { path: path.path, offset: 3 });
  const { ranges } = getCommentState(state);

  expect(resolveActiveCommentIndex(state, ranges)).toBe(0);
});

test("resolveActiveCommentIndex treats range bounds as inclusive for a collapsed caret", () => {
  let state = setup("alpha beta\n");
  const path = getPath(state, "alpha beta");
  const commented = addEditorComment(
    state,
    { path: path.path, startOffset: 1, endOffset: 4 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  const { ranges } = getCommentState(commented);
  const atStart = setSelection(commented, { path: path.path, offset: 1 });
  const atEnd = setSelection(commented, { path: path.path, offset: 4 });
  const justBefore = setSelection(commented, { path: path.path, offset: 0 });
  const justAfter = setSelection(commented, { path: path.path, offset: 5 });

  expect(resolveActiveCommentIndex(atStart, ranges)).toBe(0);
  expect(resolveActiveCommentIndex(atEnd, ranges)).toBe(0);
  expect(resolveActiveCommentIndex(justBefore, ranges)).toBeNull();
  expect(resolveActiveCommentIndex(justAfter, ranges)).toBeNull();
});

test("resolveActiveCommentIndex uses an open-interval overlap for ranged selections", () => {
  let state = setup("alpha beta\n");
  const path = getPath(state, "alpha beta");
  const commented = addEditorComment(
    state,
    { path: path.path, startOffset: 2, endOffset: 5 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  const { ranges } = getCommentState(commented);

  // Touching the comment range at its end-boundary with a positive-length
  // selection: no shared interior, so no thread is reported.
  const touching = setSelection(commented, {
    anchor: { path: path.path, offset: 5 },
    focus: { path: path.path, offset: 8 },
  });
  // Overlap by one character: shared interior, thread is reported.
  const overlapping = setSelection(commented, {
    anchor: { path: path.path, offset: 4 },
    focus: { path: path.path, offset: 8 },
  });

  expect(resolveActiveCommentIndex(touching, ranges)).toBeNull();
  expect(resolveActiveCommentIndex(overlapping, ranges)).toBe(0);
});

test("resolveActiveCommentIndex resolves selections that span paths", () => {
  let state = setup("alpha\n\nbeta\n");
  const alpha = getPath(state, "alpha");
  const beta = getPath(state, "beta");
  const commented = addEditorComment(
    state,
    { path: beta.path, startOffset: 0, endOffset: 2 },
    "note",
  );

  if (!commented) {
    throw new Error("Expected comment to be added");
  }

  const { ranges } = getCommentState(commented);
  state = setSelection(commented, {
    anchor: { path: alpha.path, offset: 0 },
    focus: { path: beta.path, offset: 1 },
  });

  expect(resolveActiveCommentIndex(state, ranges)).toBe(0);
});
