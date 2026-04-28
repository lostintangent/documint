import { expect, test } from "bun:test";
import {
  createAnchorFromContainer,
  createCommentThread,
  extractQuoteFromContainer,
  listAnchorContainers,
} from "@/document";
import {
  createDocumentFromEditorState,
  createEditorState,
  deleteBackward,
  deleteForward,
  deleteSelectionText,
  insertSelectionText,
  setSelection,
  type EditorSelection,
} from "@/editor/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("replaces and deletes selected text within a single canvas container", () => {
  let state = createEditorState(parseMarkdown("Paragraph body.\n"));
  const paragraph = state.documentIndex.regions[0];

  if (!paragraph) {
    throw new Error("Expected paragraph container");
  }

  state = setSelection(state, {
    anchor: {
      regionId: paragraph.id,
      offset: 0,
    },
    focus: {
      regionId: paragraph.id,
      offset: "Paragraph".length,
    },
  });
  state = insertSelectionText(state, "Selected");

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Selected body.\n");

  const selectedBody = state.documentIndex.regions[0];

  if (!selectedBody) {
    throw new Error("Expected updated paragraph container");
  }

  state = setSelection(state, {
    anchor: {
      regionId: selectedBody.id,
      offset: "Selected".length,
    },
    focus: {
      regionId: selectedBody.id,
      offset: "Selected body".length,
    },
  });
  state = deleteSelectionText(state);

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("Selected.\n");
});

test("deleting all text within a single heading keeps the heading block", () => {
  let state = createEditorState(parseMarkdown("# Heading\n"));
  const heading = state.documentIndex.regions[0];

  if (!heading) {
    throw new Error("Expected heading region");
  }

  state = setSelection(state, {
    anchor: { regionId: heading.id, offset: 0 },
    focus: { regionId: heading.id, offset: heading.text.length },
  });
  state = deleteSelectionText(state);

  // Single-region deletes preserve block type — selecting the full contents
  // of a heading and deleting leaves an empty heading, not a paragraph.
  // This is the opposite of the cross-region case where a fully-consumed
  // boundary block drops.
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("#\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.blockType).toBe("heading");
});

test("merges two paragraphs when a cross-region selection is replaced with text", () => {
  let state = createEditorState(parseMarkdown("alpha beta\n\ngamma delta\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(first.id, "alpha ".length, second.id, "gamma ".length),
  );
  state = insertSelectionText(state, "X");

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("alpha Xdelta\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.selection.anchor.offset).toBe("alpha X".length);
});

test("drops middle blocks when a cross-region selection spans three paragraphs", () => {
  let state = createEditorState(parseMarkdown("alpha\n\nbeta\n\ngamma\n"));
  const [first, , third] = state.documentIndex.regions;

  if (!first || !third) {
    throw new Error("Expected three paragraph regions");
  }

  state = setSelection(state, selectionBetween(first.id, 2, third.id, 3));
  state = insertSelectionText(state, "-");

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("al-ma\n");
});

test("deleteBackward collapses a cross-region selection instead of deleting a single character", () => {
  let state = createEditorState(parseMarkdown("alpha beta\n\ngamma delta\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(first.id, "alpha ".length, second.id, "gamma ".length),
  );
  const nextState = deleteBackward(state);

  if (!nextState) {
    throw new Error("Expected deleteBackward to produce a new state for a cross-region selection");
  }

  expect(serializeMarkdown(createDocumentFromEditorState(nextState))).toBe("alpha delta\n");
});

test("deleteForward collapses a cross-region selection instead of deleting a single character", () => {
  let state = createEditorState(parseMarkdown("alpha beta\n\ngamma delta\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(first.id, "alpha ".length, second.id, "gamma ".length),
  );
  const nextState = deleteForward(state);

  if (!nextState) {
    throw new Error("Expected deleteForward to produce a new state for a cross-region selection");
  }

  expect(serializeMarkdown(createDocumentFromEditorState(nextState))).toBe("alpha delta\n");
});

test("cross-region deletion with empty text concatenates prefix and suffix without a separator", () => {
  let state = createEditorState(parseMarkdown("alpha beta\n\ngamma delta\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(first.id, "alpha ".length, second.id, "gamma ".length),
  );
  state = deleteSelectionText(state);

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("alpha delta\n");
});

test("merges a heading with a paragraph using the start block's type", () => {
  let state = createEditorState(parseMarkdown("# Heading\n\nParagraph body\n"));
  const [heading, paragraph] = state.documentIndex.regions;

  if (!heading || !paragraph) {
    throw new Error("Expected heading and paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(heading.id, "Headin".length, paragraph.id, "Paragraph ".length),
  );
  state = insertSelectionText(state, "/");

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("# Headin/body\n");
});

test("drops a code block between two paragraphs during cross-region replacement", () => {
  let state = createEditorState(parseMarkdown("alpha\n\n```\ncode\n```\n\ngamma\n"));
  const regions = state.documentIndex.regions;
  const first = regions[0];
  const last = regions.at(-1);

  if (!first || !last) {
    throw new Error("Expected paragraph regions around the code block");
  }

  state = setSelection(state, selectionBetween(first.id, 2, last.id, 3));
  state = insertSelectionText(state, "!");

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("al!ma\n");
});

test("trims a code block when it is an endpoint of a cross-region selection", () => {
  let state = createEditorState(parseMarkdown("```\nabcdef\n```\n\nalpha\n"));
  const codeRegion = state.documentIndex.regions.find((region) => region.blockType === "code");
  const paragraphRegion = state.documentIndex.regions.find(
    (region) => region.blockType === "paragraph",
  );

  if (!codeRegion || !paragraphRegion) {
    throw new Error("Expected code and paragraph regions");
  }

  state = setSelection(state, selectionBetween(codeRegion.id, 3, paragraphRegion.id, 2));
  state = deleteSelectionText(state);

  // Code-block prefix kept; paragraph suffix kept; no inline merge (not text-like on both sides).
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("```\nabc\n```\n\npha\n");
});

test("drops tables entirely when a cross-region selection enters or exits them", () => {
  let state = createEditorState(
    parseMarkdown("alpha\n\n| A | B |\n| --- | --- |\n| one | two |\n\nbeta\n"),
  );
  const paragraphs = state.documentIndex.regions.filter(
    (region) => region.blockType === "paragraph",
  );
  const [first, second] = paragraphs;

  if (!first || !second) {
    throw new Error("Expected paragraphs surrounding the table");
  }

  state = setSelection(state, selectionBetween(first.id, 2, second.id, 2));
  state = insertSelectionText(state, "X");

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("alXta\n");
});

test("normalizes an empty document to a single empty paragraph after replacing everything", () => {
  let state = createEditorState(parseMarkdown("alpha\n\nbeta\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(state, selectionBetween(first.id, 0, second.id, second.text.length));
  state = deleteSelectionText(state);

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.text).toBe("");
});

test("trims a list when a cross-region selection starts in one list item and ends in a later paragraph", () => {
  let state = createEditorState(parseMarkdown("- alpha\n- beta\n- gamma\n\nafter\n"));
  const listRegions = state.documentIndex.regions.filter(
    (region) => region.blockType === "listItem" || region.blockType === "paragraph",
  );
  const firstListItem = listRegions.find((region) => region.text === "alpha");
  const afterParagraph = listRegions.find((region) => region.text === "after");

  if (!firstListItem || !afterParagraph) {
    throw new Error("Expected list item and trailing paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(firstListItem.id, "al".length, afterParagraph.id, "af".length),
  );
  state = insertSelectionText(state, "!");

  // The first list item gets trimmed ("al"); later items are dropped. The
  // trimmed list is a container (not text-like), so it doesn't inline-merge
  // with the trailing paragraph — but since the trailing paragraph IS
  // text-like, the inserted text prepends into it rather than becoming a
  // standalone block. Result: list sibling + paragraph with typed text
  // prefixed onto the preserved tail.
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("- al\n\n!ter\n");

  // Caret lands inside the merged "!ter" paragraph, just after the typed
  // text — not at the start of the trimmed list.
  const caretRegion = state.documentIndex.regionIndex.get(state.selection.focus.regionId);
  expect(caretRegion?.text).toBe("!ter");
  expect(state.selection.focus.offset).toBe("!".length);
});

test("preserves comment threads anchored before a cross-region edit", () => {
  const snapshot = parseMarkdown("alpha beta\n\ngamma delta\n");
  const firstContainer = listAnchorContainers(snapshot)[0];

  if (!firstContainer) {
    throw new Error("Expected anchor container for the first paragraph");
  }

  const thread = createCommentThread({
    anchor: createAnchorFromContainer(firstContainer, 0, 5),
    body: "anchor",
    createdAt: "2026-04-22T00:00:00.000Z",
    quote: extractQuoteFromContainer(firstContainer, 0, 5),
  });
  let state = createEditorState({ ...snapshot, comments: [thread] });
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(first.id, "alpha ".length, second.id, "gamma ".length),
  );
  state = deleteSelectionText(state);

  // Thread anchored in content before the selection start survives the
  // cross-region edit — same thread count, same quote, still resolvable.
  const threads = createDocumentFromEditorState(state).comments;
  expect(threads).toHaveLength(1);
  expect(threads[0]?.quote).toBe("alpha");
});

test("replaces the entire document with a single paragraph when every block is fully consumed", () => {
  let state = createEditorState(parseMarkdown("# Heading\n\nalpha\n\n- one\n- two\n\ngamma\n"));
  const firstRegion = state.documentIndex.regions[0];
  const lastRegion = state.documentIndex.regions.at(-1);

  if (!firstRegion || !lastRegion) {
    throw new Error("Expected regions at both document ends");
  }

  state = setSelection(
    state,
    selectionBetween(firstRegion.id, 0, lastRegion.id, lastRegion.text.length),
  );
  state = insertSelectionText(state, "x");

  // Both the start heading and the end paragraph are fully consumed — their
  // types don't leak into the result. The replacement becomes a fresh
  // paragraph rather than inheriting the first block's heading type.
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("x\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.blockType).toBe("paragraph");
});

test("cross-region delete drops a trailing heading when it is fully consumed by the selection", () => {
  let state = createEditorState(parseMarkdown("alpha paragraph\n\n# Trailing Heading\n"));
  const [paragraph, heading] = state.documentIndex.regions;

  if (!paragraph || !heading) {
    throw new Error("Expected paragraph and heading regions");
  }

  // Select from mid-paragraph through the entire trailing heading.
  state = setSelection(
    state,
    selectionBetween(paragraph.id, "alpha".length, heading.id, heading.text.length),
  );
  state = deleteSelectionText(state);

  // The paragraph keeps its partial prefix ("alpha"). The trailing heading
  // was fully consumed and drops — its type doesn't leak into the result.
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("alpha\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.blockType).toBe("paragraph");

  // Caret lands at the end of the preserved prefix — where the cursor sat
  // before the selection extended — not at offset 0.
  expect(state.selection.focus.offset).toBe("alpha".length);
});

test("cross-region type with a trailing heading fully consumed absorbs into the preserved prefix", () => {
  let state = createEditorState(parseMarkdown("alpha paragraph\n\n# Trailing Heading\n"));
  const [paragraph, heading] = state.documentIndex.regions;

  if (!paragraph || !heading) {
    throw new Error("Expected paragraph and heading regions");
  }

  state = setSelection(
    state,
    selectionBetween(paragraph.id, "alpha".length, heading.id, heading.text.length),
  );
  state = insertSelectionText(state, "X");

  // The trailing heading drops; the partial paragraph absorbs the typed
  // text at its end (start-block-wins since the start still has content).
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("alphaX\n");
  expect(state.selection.focus.offset).toBe("alphaX".length);
});

test("select-all + delete produces an empty paragraph even when the document starts with a heading", () => {
  let state = createEditorState(parseMarkdown("# Heading\n\nalpha\n"));
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected heading and paragraph regions");
  }

  state = setSelection(state, selectionBetween(first.id, 0, second.id, second.text.length));
  state = deleteSelectionText(state);

  // The heading's type must not survive — the deletion consumed it entirely.
  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe("\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.blockType).toBe("paragraph");
});

function selectionBetween(
  anchorRegionId: string,
  anchorOffset: number,
  focusRegionId: string,
  focusOffset: number,
): EditorSelection {
  return {
    anchor: { regionId: anchorRegionId, offset: anchorOffset },
    focus: { regionId: focusRegionId, offset: focusOffset },
  };
}
