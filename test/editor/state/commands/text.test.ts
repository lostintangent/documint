import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
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
  insertText,
  readEditorEffects,
  replaceSelection,
  replaceTextRange,
  resolveEditorTextAtPath,
  setSelection,
  type EditorSelection,
} from "@/editor/state";
import { parseDocument } from "@/markdown";
import { getPath, getPathByType, placeAt, selectIn, setup, toMarkdown } from "../../helpers";

describe("Text commands", () => {
  test("replaces and deletes selected text within a single canvas container", () => {
    let state = setup("Paragraph body.\n");
    const paragraph = indexedTextEntries(state)[0];

    if (!paragraph) {
      throw new Error("Expected paragraph container");
    }

    state = setSelection(state, {
      anchor: {
        path: paragraph.path,
        offset: 0,
      },
      focus: {
        path: paragraph.path,
        offset: "Paragraph".length,
      },
    });
    state = replaceSelection(state, "Selected");

    expect(toMarkdown(state)).toBe("Selected body.\n");

    const selectedBody = indexedTextEntries(state)[0];

    if (!selectedBody) {
      throw new Error("Expected updated paragraph container");
    }

    state = setSelection(state, {
      anchor: {
        path: selectedBody.path,
        offset: "Selected".length,
      },
      focus: {
        path: selectedBody.path,
        offset: "Selected body".length,
      },
    });
    state = deleteSelection(state);

    expect(toMarkdown(state)).toBe("Selected.\n");
  });

  test("replaces an explicit text range in one path", () => {
    const state = setup("Hello @Ja friend\n");
    const nextState = replaceTextRange(state, 6, 9, "@Jane ");

    if (!nextState) {
      throw new Error("Expected replaceTextRange to produce a new state");
    }

    expect(toMarkdown(nextState)).toBe("Hello @Jane  friend\n");
    expect(nextState.selection.anchor).toEqual({
      path: nextState.selection.focus.path,
      offset: "Hello @Jane ".length,
    });
  });

  test("replacing an explicit text range emits a text inserted effect", () => {
    const state = setup("alpha\n");
    const path = getPath(state, "alpha");
    const stateWithInsertion = insertText(placeAt(state, path, "end"), "x");

    if (!stateWithInsertion) {
      throw new Error("Expected insertText to produce a new state");
    }

    const nextState = replaceTextRange(stateWithInsertion, 0, 1, "A");

    if (!nextState) {
      throw new Error("Expected replaceTextRange to produce a new state");
    }

    expect(readEditorEffects(nextState)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endOffset: 1,
          kind: "text-inserted",
          startOffset: 0,
          text: "A",
        }),
      ]),
    );
  });

  test("returns null when replacing an invalid explicit text range", () => {
    const state = setup("Hello @Ja\n");

    expect(replaceTextRange(state, 3, 0, "@Jane ")).toBeNull();
  });

  test("typing in a document with no text path is a no-op", () => {
    const state = createEditorState(parseDocument("---\n"));

    expect(state.selection.focus.path).toBe("root.0");
    expect(insertText(state, "x")).toBe(state);
  });

  test("keeps cached plain text canonical after a nested text edit", () => {
    const state = setup("> - alpha\n");
    const path = getPath(state, "alpha");
    const nextState = insertText(placeAt(state, path, "end"), " beta");

    if (!nextState) {
      throw new Error("Expected insertText to produce a new state");
    }

    const root = nextState.documentIndex.document.blocks[0];

    if (root?.type !== "blockquote") {
      throw new Error("Expected edited root to remain a blockquote");
    }

    const nestedList = root.children[0];
    const listItem = nestedList?.type === "list" ? nestedList.items[0] : null;
    const paragraph = listItem?.children[0];

    expect(root.plainText).toBe("alpha beta");
    expect(nestedList?.plainText).toBe("alpha beta");
    expect(listItem?.plainText).toBe("alpha beta");
    expect(paragraph?.plainText).toBe("alpha beta");
  });

  test("deleting all text within a single heading keeps the heading block", () => {
    let state = setup("# Heading\n");
    const heading = indexedTextEntries(state)[0];

    if (!heading) {
      throw new Error("Expected heading path");
    }

    state = selectIn(state, heading, 0, heading.text.length);
    state = deleteSelection(state);

    // Single-path deletes preserve block type — selecting the full contents
    // of a heading and deleting leaves an empty heading, not a paragraph.
    // This is the opposite of the cross-path case where a fully-consumed
    // boundary block drops.
    expect(toMarkdown(state)).toBe("#\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
    expect(indexedTextEntries(state)[0]?.block.type).toBe("heading");
  });

  test("merges two paragraphs when a cross-path selection is replaced with text", () => {
    let state = setup("alpha beta\n\ngamma delta\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected two paragraph paths");
    }

    state = setSelection(
      state,
      selectionBetween(first.path, "alpha ".length, second.path, "gamma ".length),
    );
    state = replaceSelection(state, "X");

    expect(toMarkdown(state)).toBe("alpha Xdelta\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
    expect(state.selection.anchor.offset).toBe("alpha X".length);
  });

  test("drops middle blocks when a cross-path selection spans three paragraphs", () => {
    let state = setup("alpha\n\nbeta\n\ngamma\n");
    const [first, , third] = indexedTextEntries(state);

    if (!first || !third) {
      throw new Error("Expected three paragraph paths");
    }

    state = setSelection(state, selectionBetween(first.path, 2, third.path, 3));
    state = replaceSelection(state, "-");

    expect(toMarkdown(state)).toBe("al-ma\n");
  });

  test("deleteBackward collapses a cross-path selection instead of deleting a single character", () => {
    let state = setup("alpha beta\n\ngamma delta\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected two paragraph paths");
    }

    state = setSelection(
      state,
      selectionBetween(first.path, "alpha ".length, second.path, "gamma ".length),
    );
    const nextState = deleteBackward(state);

    if (!nextState) {
      throw new Error("Expected deleteBackward to produce a new state for a cross-path selection");
    }

    expect(toMarkdown(nextState)).toBe("alpha delta\n");
  });

  test("deleteForward collapses a cross-path selection instead of deleting a single character", () => {
    let state = setup("alpha beta\n\ngamma delta\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected two paragraph paths");
    }

    state = setSelection(
      state,
      selectionBetween(first.path, "alpha ".length, second.path, "gamma ".length),
    );
    const nextState = deleteForward(state);

    if (!nextState) {
      throw new Error("Expected deleteForward to produce a new state for a cross-path selection");
    }

    expect(toMarkdown(nextState)).toBe("alpha delta\n");
  });

  test("cross-path deletion with empty text concatenates prefix and suffix without a separator", () => {
    let state = setup("alpha beta\n\ngamma delta\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected two paragraph paths");
    }

    state = setSelection(
      state,
      selectionBetween(first.path, "alpha ".length, second.path, "gamma ".length),
    );
    state = deleteSelection(state);

    expect(toMarkdown(state)).toBe("alpha delta\n");
  });

  test("merges a heading with a paragraph using the start block's type", () => {
    let state = setup("# Heading\n\nParagraph body\n");
    const [heading, paragraph] = indexedTextEntries(state);

    if (!heading || !paragraph) {
      throw new Error("Expected heading and paragraph paths");
    }

    state = setSelection(
      state,
      selectionBetween(heading.path, "Headin".length, paragraph.path, "Paragraph ".length),
    );
    state = replaceSelection(state, "/");

    expect(toMarkdown(state)).toBe("# Headin/body\n");
  });

  test("drops a code block between two paragraphs during cross-path replacement", () => {
    let state = setup("alpha\n\n```\ncode\n```\n\ngamma\n");
    const paths = indexedTextEntries(state);
    const first = paths[0];
    const last = paths.at(-1);

    if (!first || !last) {
      throw new Error("Expected paragraph paths around the code block");
    }

    state = setSelection(state, selectionBetween(first.path, 2, last.path, 3));
    state = replaceSelection(state, "!");

    expect(toMarkdown(state)).toBe("al!ma\n");
  });

  test("trims a code block when it is an endpoint of a cross-path selection", () => {
    let state = setup("```\nabcdef\n```\n\nalpha\n");
    const codePath = getPathByType(state, "code");
    const paragraphPath = getPathByType(state, "paragraph");

    state = setSelection(state, selectionBetween(codePath.path, 3, paragraphPath.path, 2));
    state = deleteSelection(state);

    // Code-block prefix kept; paragraph suffix kept; no inline merge (not text-like on both sides).
    expect(toMarkdown(state)).toBe("```\nabc\n```\n\npha\n");
  });

  test("drops tables entirely when a cross-path selection enters or exits them", () => {
    let state = setup("alpha\n\n| A | B |\n| --- | --- |\n| one | two |\n\nbeta\n");
    const paragraphs = indexedTextEntries(state).filter((path) => path.block.type === "paragraph");
    const [first, second] = paragraphs;

    if (!first || !second) {
      throw new Error("Expected paragraphs surrounding the table");
    }

    state = setSelection(state, selectionBetween(first.path, 2, second.path, 2));
    state = replaceSelection(state, "X");

    expect(toMarkdown(state)).toBe("alXta\n");
  });

  test("drops a fully-selected list when a cross-path selection spans through it", () => {
    // The user-visible contract for range delete: any block fully covered
    // by the selection disappears. Boundary blocks get trimmed at the
    // selection endpoints and merged at the seam if both ends are
    // text-mergeable; here `alpha` and `beta` join into one paragraph.
    let state = setup("alpha\n\n- one\n- two\n\nbeta\n");
    const alpha = getPath(state, "alpha");
    const two = getPath(state, "two");

    state = setSelection(state, {
      anchor: { path: alpha.path, offset: alpha.text.length },
      focus: { path: two.path, offset: two.text.length },
    });
    state = deleteSelection(state);

    expect(toMarkdown(state)).toBe("alpha\n\nbeta\n");
  });

  test("normalizes an empty document to a single empty paragraph after replacing everything", () => {
    let state = setup("alpha\n\nbeta\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected two paragraph paths");
    }

    state = setSelection(state, selectionBetween(first.path, 0, second.path, second.text.length));
    state = deleteSelection(state);

    expect(toMarkdown(state)).toBe("\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
    expect(indexedTextEntries(state)[0]?.text).toBe("");
  });

  test("trims a list when a cross-path selection starts in one list item and ends in a later paragraph", () => {
    let state = setup("- alpha\n- beta\n- gamma\n\nafter\n");
    const listEntries = indexedTextEntries(state).filter(
      (path) => path.block.type === "listItem" || path.block.type === "paragraph",
    );
    const firstListItem = listEntries.find((path) => path.text === "alpha");
    const afterParagraph = listEntries.find((path) => path.text === "after");

    if (!firstListItem || !afterParagraph) {
      throw new Error("Expected list item and trailing paragraph paths");
    }

    state = setSelection(
      state,
      selectionBetween(firstListItem.path, "al".length, afterParagraph.path, "af".length),
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
    expect(resolveEditorTextAtPath(state.documentIndex, state.selection.focus.path)).toBe("!ter");
    expect(state.selection.focus.offset).toBe("!".length);
  });

  test("preserves comment threads anchored before a cross-path edit", () => {
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
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected two paragraph paths");
    }

    state = setSelection(
      state,
      selectionBetween(first.path, "alpha ".length, second.path, "gamma ".length),
    );
    state = deleteSelection(state);

    // Thread anchored in content before the selection start survives the
    // cross-path edit — same thread count, same quote, still resolvable.
    const threads = createDocumentFromEditorState(state).comments;
    expect(threads).toHaveLength(1);
    expect(threads[0]?.quote).toBe("alpha");
  });

  test("replaces the entire document with a single paragraph when every block is fully consumed", () => {
    let state = setup("# Heading\n\nalpha\n\n- one\n- two\n\ngamma\n");
    const firstPath = indexedTextEntries(state)[0];
    const lastPath = indexedTextEntries(state).at(-1);

    if (!firstPath || !lastPath) {
      throw new Error("Expected paths at both document ends");
    }

    state = setSelection(
      state,
      selectionBetween(firstPath.path, 0, lastPath.path, lastPath.text.length),
    );
    state = replaceSelection(state, "x");

    // Both the start heading and the end paragraph are fully consumed — their
    // types don't leak into the result. The replacement becomes a fresh
    // paragraph rather than inheriting the first block's heading type.
    expect(toMarkdown(state)).toBe("x\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
    expect(indexedTextEntries(state)[0]?.block.type).toBe("paragraph");
  });

  test("cross-path delete drops a trailing heading when it is fully consumed by the selection", () => {
    let state = setup("alpha paragraph\n\n# Trailing Heading\n");
    const [paragraph, heading] = indexedTextEntries(state);

    if (!paragraph || !heading) {
      throw new Error("Expected paragraph and heading paths");
    }

    // Select from mid-paragraph through the entire trailing heading.
    state = setSelection(
      state,
      selectionBetween(paragraph.path, "alpha".length, heading.path, heading.text.length),
    );
    state = deleteSelection(state);

    // The paragraph keeps its partial prefix ("alpha"). The trailing heading
    // was fully consumed and drops — its type doesn't leak into the result.
    expect(toMarkdown(state)).toBe("alpha\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
    expect(indexedTextEntries(state)[0]?.block.type).toBe("paragraph");

    // Caret lands at the end of the preserved prefix — where the cursor sat
    // before the selection extended — not at offset 0.
    expect(state.selection.focus.offset).toBe("alpha".length);
  });

  test("cross-path type with a trailing heading fully consumed absorbs into the preserved prefix", () => {
    let state = setup("alpha paragraph\n\n# Trailing Heading\n");
    const [paragraph, heading] = indexedTextEntries(state);

    if (!paragraph || !heading) {
      throw new Error("Expected paragraph and heading paths");
    }

    state = setSelection(
      state,
      selectionBetween(paragraph.path, "alpha".length, heading.path, heading.text.length),
    );
    state = replaceSelection(state, "X");

    // The trailing heading drops; the partial paragraph absorbs the typed
    // text at its end (start-block-wins since the start still has content).
    expect(toMarkdown(state)).toBe("alphaX\n");
    expect(state.selection.focus.offset).toBe("alphaX".length);
  });

  test("select-all + delete produces an empty paragraph even when the document starts with a heading", () => {
    let state = setup("# Heading\n\nalpha\n");
    const [first, second] = indexedTextEntries(state);

    if (!first || !second) {
      throw new Error("Expected heading and paragraph paths");
    }

    state = setSelection(state, selectionBetween(first.path, 0, second.path, second.text.length));
    state = deleteSelection(state);

    // The heading's type must not survive — the deletion consumed it entirely.
    expect(toMarkdown(state)).toBe("\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
    expect(indexedTextEntries(state)[0]?.block.type).toBe("paragraph");
  });

  function selectionBetween(
    anchorPath: string,
    anchorOffset: number,
    focusPath: string,
    focusOffset: number,
  ): EditorSelection {
    return {
      anchor: { path: anchorPath, offset: anchorOffset },
      focus: { path: focusPath, offset: focusOffset },
    };
  }

  test("deletes adjacent images atomically with deleteBackward and deleteForward", () => {
    const state = setup("before ![alt](https://example.com/image.png) after\n");
    const path = indexedTextEntries(state)[0];

    if (!path) throw new Error("Expected paragraph path");

    const imageRun = (path.inlines ?? []).find((run) => run.node.type === "image");

    if (!imageRun) throw new Error("Expected image run");

    const backward = deleteBackward(placeAt(state, path, imageRun.end));
    const forward = deleteForward(placeAt(state, path, imageRun.start));

    expect(backward).not.toBeNull();
    expect(forward).not.toBeNull();
    expect(toMarkdown(backward!)).toBe("before  after\n");
    expect(toMarkdown(forward!)).toBe("before  after\n");
  });

  test("deletes emoji variation sequences as one character", () => {
    const state = setup("a ✈️b\n");
    const path = getPath(state, "a ✈️b");

    const backward = deleteBackward(placeAt(state, path, 4));
    const forward = deleteForward(placeAt(state, path, 2));

    expect(backward ? toMarkdown(backward) : null).toBe("a b\n");
    expect(forward ? toMarkdown(forward) : null).toBe("a b\n");
  });

  test("does not persist a typed trailing prose space as a markdown entity", () => {
    const state = setup("alpha\n");
    const path = getPath(state, "alpha");
    const result = insertText(placeAt(state, path, "end"), " ");

    expect(result).not.toBeNull();
    expect(toMarkdown(result!)).toBe("alpha\n");
  });
});
