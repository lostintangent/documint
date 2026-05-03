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
  deleteSelection,
  extendSelectionToPoint,
  insertText,
  replaceSelection,
  setSelection,
  type EditorSelection,
} from "@/editor/state";
import { parseDocument } from "@/markdown";
import { getRegion, getRegionByType, placeAt, selectIn, setup, toMarkdown } from "../../helpers";

test("replaces and deletes selected text within a single canvas container", () => {
  let state = setup("Paragraph body.\n");
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
  state = replaceSelection(state, "Selected");

  expect(toMarkdown(state)).toBe("Selected body.\n");

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
  state = deleteSelection(state);

  expect(toMarkdown(state)).toBe("Selected.\n");
});

test("deleting all text within a single heading keeps the heading block", () => {
  let state = setup("# Heading\n");
  const heading = state.documentIndex.regions[0];

  if (!heading) {
    throw new Error("Expected heading region");
  }

  state = selectIn(state, heading, 0, heading.text.length);
  state = deleteSelection(state);

  // Single-region deletes preserve block type — selecting the full contents
  // of a heading and deleting leaves an empty heading, not a paragraph.
  // This is the opposite of the cross-region case where a fully-consumed
  // boundary block drops.
  expect(toMarkdown(state)).toBe("#\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.blockType).toBe("heading");
});

test("merges two paragraphs when a cross-region selection is replaced with text", () => {
  let state = setup("alpha beta\n\ngamma delta\n");
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(first.id, "alpha ".length, second.id, "gamma ".length),
  );
  state = replaceSelection(state, "X");

  expect(toMarkdown(state)).toBe("alpha Xdelta\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.selection.anchor.offset).toBe("alpha X".length);
});

test("drops middle blocks when a cross-region selection spans three paragraphs", () => {
  let state = setup("alpha\n\nbeta\n\ngamma\n");
  const [first, , third] = state.documentIndex.regions;

  if (!first || !third) {
    throw new Error("Expected three paragraph regions");
  }

  state = setSelection(state, selectionBetween(first.id, 2, third.id, 3));
  state = replaceSelection(state, "-");

  expect(toMarkdown(state)).toBe("al-ma\n");
});

test("deleteBackward collapses a cross-region selection instead of deleting a single character", () => {
  let state = setup("alpha beta\n\ngamma delta\n");
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

  expect(toMarkdown(nextState)).toBe("alpha delta\n");
});

test("deleteForward collapses a cross-region selection instead of deleting a single character", () => {
  let state = setup("alpha beta\n\ngamma delta\n");
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

  expect(toMarkdown(nextState)).toBe("alpha delta\n");
});

test("cross-region deletion with empty text concatenates prefix and suffix without a separator", () => {
  let state = setup("alpha beta\n\ngamma delta\n");
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(first.id, "alpha ".length, second.id, "gamma ".length),
  );
  state = deleteSelection(state);

  expect(toMarkdown(state)).toBe("alpha delta\n");
});

test("merges a heading with a paragraph using the start block's type", () => {
  let state = setup("# Heading\n\nParagraph body\n");
  const [heading, paragraph] = state.documentIndex.regions;

  if (!heading || !paragraph) {
    throw new Error("Expected heading and paragraph regions");
  }

  state = setSelection(
    state,
    selectionBetween(heading.id, "Headin".length, paragraph.id, "Paragraph ".length),
  );
  state = replaceSelection(state, "/");

  expect(toMarkdown(state)).toBe("# Headin/body\n");
});

test("drops a code block between two paragraphs during cross-region replacement", () => {
  let state = setup("alpha\n\n```\ncode\n```\n\ngamma\n");
  const regions = state.documentIndex.regions;
  const first = regions[0];
  const last = regions.at(-1);

  if (!first || !last) {
    throw new Error("Expected paragraph regions around the code block");
  }

  state = setSelection(state, selectionBetween(first.id, 2, last.id, 3));
  state = replaceSelection(state, "!");

  expect(toMarkdown(state)).toBe("al!ma\n");
});

test("trims a code block when it is an endpoint of a cross-region selection", () => {
  let state = setup("```\nabcdef\n```\n\nalpha\n");
  const codeRegion = getRegionByType(state, "code");
  const paragraphRegion = getRegionByType(state, "paragraph");

  state = setSelection(state, selectionBetween(codeRegion.id, 3, paragraphRegion.id, 2));
  state = deleteSelection(state);

  // Code-block prefix kept; paragraph suffix kept; no inline merge (not text-like on both sides).
  expect(toMarkdown(state)).toBe("```\nabc\n```\n\npha\n");
});

test("drops tables entirely when a cross-region selection enters or exits them", () => {
  let state = setup("alpha\n\n| A | B |\n| --- | --- |\n| one | two |\n\nbeta\n");
  const paragraphs = state.documentIndex.regions.filter(
    (region) => region.blockType === "paragraph",
  );
  const [first, second] = paragraphs;

  if (!first || !second) {
    throw new Error("Expected paragraphs surrounding the table");
  }

  state = setSelection(state, selectionBetween(first.id, 2, second.id, 2));
  state = replaceSelection(state, "X");

  expect(toMarkdown(state)).toBe("alXta\n");
});

test("drops a fully-selected list when a cross-region selection spans through it", () => {
  // The user-visible contract for range delete: any block fully covered
  // by the selection disappears. Boundary blocks get trimmed at the
  // selection endpoints and merged at the seam if both ends are
  // text-mergeable; here `alpha` and `beta` join into one paragraph.
  let state = setup("alpha\n\n- one\n- two\n\nbeta\n");
  const alpha = getRegion(state, "alpha");
  const two = getRegion(state, "two");

  state = setSelection(state, {
    anchor: { regionId: alpha.id, offset: alpha.text.length },
    focus: { regionId: two.id, offset: two.text.length },
  });
  state = deleteSelection(state);

  expect(toMarkdown(state)).toBe("alpha\n\nbeta\n");
});

test("normalizes an empty document to a single empty paragraph after replacing everything", () => {
  let state = setup("alpha\n\nbeta\n");
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected two paragraph regions");
  }

  state = setSelection(state, selectionBetween(first.id, 0, second.id, second.text.length));
  state = deleteSelection(state);

  expect(toMarkdown(state)).toBe("\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.text).toBe("");
});

test("trims a list when a cross-region selection starts in one list item and ends in a later paragraph", () => {
  let state = setup("- alpha\n- beta\n- gamma\n\nafter\n");
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
  state = replaceSelection(state, "!");

  // The first list item gets trimmed ("al"); later items are dropped. The
  // trimmed list is a container (not text-like), so it doesn't inline-merge
  // with the trailing paragraph — but since the trailing paragraph IS
  // text-like, the inserted text prepends into it rather than becoming a
  // standalone block. Result: list sibling + paragraph with typed text
  // prefixed onto the preserved tail.
  expect(toMarkdown(state)).toBe("- al\n\n!ter\n");

  // Caret lands inside the merged "!ter" paragraph, just after the typed
  // text — not at the start of the trimmed list.
  const caretRegion = state.documentIndex.regionIndex.get(state.selection.focus.regionId);
  expect(caretRegion?.text).toBe("!ter");
  expect(state.selection.focus.offset).toBe("!".length);
});

test("preserves comment threads anchored before a cross-region edit", () => {
  const snapshot = parseDocument("alpha beta\n\ngamma delta\n");
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
  state = deleteSelection(state);

  // Thread anchored in content before the selection start survives the
  // cross-region edit — same thread count, same quote, still resolvable.
  const threads = createDocumentFromEditorState(state).comments;
  expect(threads).toHaveLength(1);
  expect(threads[0]?.quote).toBe("alpha");
});

test("replaces the entire document with a single paragraph when every block is fully consumed", () => {
  let state = setup("# Heading\n\nalpha\n\n- one\n- two\n\ngamma\n");
  const firstRegion = state.documentIndex.regions[0];
  const lastRegion = state.documentIndex.regions.at(-1);

  if (!firstRegion || !lastRegion) {
    throw new Error("Expected regions at both document ends");
  }

  state = setSelection(
    state,
    selectionBetween(firstRegion.id, 0, lastRegion.id, lastRegion.text.length),
  );
  state = replaceSelection(state, "x");

  // Both the start heading and the end paragraph are fully consumed — their
  // types don't leak into the result. The replacement becomes a fresh
  // paragraph rather than inheriting the first block's heading type.
  expect(toMarkdown(state)).toBe("x\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.blockType).toBe("paragraph");
});

test("cross-region delete drops a trailing heading when it is fully consumed by the selection", () => {
  let state = setup("alpha paragraph\n\n# Trailing Heading\n");
  const [paragraph, heading] = state.documentIndex.regions;

  if (!paragraph || !heading) {
    throw new Error("Expected paragraph and heading regions");
  }

  // Select from mid-paragraph through the entire trailing heading.
  state = setSelection(
    state,
    selectionBetween(paragraph.id, "alpha".length, heading.id, heading.text.length),
  );
  state = deleteSelection(state);

  // The paragraph keeps its partial prefix ("alpha"). The trailing heading
  // was fully consumed and drops — its type doesn't leak into the result.
  expect(toMarkdown(state)).toBe("alpha\n");
  expect(state.documentIndex.regions).toHaveLength(1);
  expect(state.documentIndex.regions[0]?.blockType).toBe("paragraph");

  // Caret lands at the end of the preserved prefix — where the cursor sat
  // before the selection extended — not at offset 0.
  expect(state.selection.focus.offset).toBe("alpha".length);
});

test("cross-region type with a trailing heading fully consumed absorbs into the preserved prefix", () => {
  let state = setup("alpha paragraph\n\n# Trailing Heading\n");
  const [paragraph, heading] = state.documentIndex.regions;

  if (!paragraph || !heading) {
    throw new Error("Expected paragraph and heading regions");
  }

  state = setSelection(
    state,
    selectionBetween(paragraph.id, "alpha".length, heading.id, heading.text.length),
  );
  state = replaceSelection(state, "X");

  // The trailing heading drops; the partial paragraph absorbs the typed
  // text at its end (start-block-wins since the start still has content).
  expect(toMarkdown(state)).toBe("alphaX\n");
  expect(state.selection.focus.offset).toBe("alphaX".length);
});

test("select-all + delete produces an empty paragraph even when the document starts with a heading", () => {
  let state = setup("# Heading\n\nalpha\n");
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected heading and paragraph regions");
  }

  state = setSelection(state, selectionBetween(first.id, 0, second.id, second.text.length));
  state = deleteSelection(state);

  // The heading's type must not survive — the deletion consumed it entirely.
  expect(toMarkdown(state)).toBe("\n");
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

test("extends the selection focus to a new point while keeping the anchor fixed", () => {
  const state = setup("Hello world\n");
  const region = getRegion(state, "Hello world");
  const placed = placeAt(state, region, 0);
  const extended = extendSelectionToPoint(placed, region.id, 5);

  expect(extended.selection.anchor.regionId).toBe(region.id);
  expect(extended.selection.anchor.offset).toBe(0);
  expect(extended.selection.focus.regionId).toBe(region.id);
  expect(extended.selection.focus.offset).toBe(5);
});

test("deletes adjacent images atomically with deleteBackward and deleteForward", () => {
  const state = setup("before ![alt](https://example.com/image.png) after\n");
  const region = state.documentIndex.regions[0];

  if (!region) throw new Error("Expected paragraph region");

  const imageRun = region.inlines.find((run) => run.kind === "image");

  if (!imageRun) throw new Error("Expected image run");

  const backward = deleteBackward(placeAt(state, region, imageRun.end));
  const forward = deleteForward(placeAt(state, region, imageRun.start));

  expect(backward).not.toBeNull();
  expect(forward).not.toBeNull();
  expect(toMarkdown(backward!)).toBe("before  after\n");
  expect(toMarkdown(forward!)).toBe("before  after\n");
});

test("does not persist a typed trailing prose space as a markdown entity", () => {
  const state = setup("alpha\n");
  const region = getRegion(state, "alpha");
  const result = insertText(placeAt(state, region, "end"), " ");

  expect(result).not.toBeNull();
  expect(toMarkdown(result!)).toBe("alpha\n");
});
