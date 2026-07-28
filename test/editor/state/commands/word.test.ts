import { describe, expect, test } from "bun:test";
import {
  createAnchorFromContainer,
  createCommentThread,
  createDocument,
  createHeadingTextBlock,
  createParagraphTextBlock,
  extractQuoteFromContainer,
  listAnchorContainers,
} from "@/document";
import {
  createDocumentFromEditorState,
  createEditorState,
  deleteSelection,
  deleteWord,
  redo,
  setSelection,
  undo,
} from "@/editor/state";
import { parseDocument } from "@/markdown";
import { indexedTextEntries } from "@test/editor/helpers";
import { getPath, placeAt, setup, toMarkdown } from "../../helpers";

describe("Word deletion", () => {
  test("deletes words backward and forward within one path", () => {
    const state = setup("alpha beta gamma");
    const path = getPath(state, "alpha beta gamma");
    const backward = deleteWord(placeAt(state, path, "alpha beta".length), "previousWord");
    const forward = deleteWord(placeAt(state, path, "alpha".length), "wordEnd");

    expect(indexedTextEntries(backward!)[0]?.text).toBe("alpha  gamma");
    expect(indexedTextEntries(forward!)[0]?.text).toBe("alpha gamma");
  });

  test("deletes to the next word", () => {
    const state = setup("alpha beta");
    const path = getPath(state, "alpha beta");
    const fromWord = deleteWord(placeAt(state, path, "start"), "nextWord");
    const fromWhitespace = deleteWord(placeAt(state, path, "alpha".length), "nextWord");

    expect(indexedTextEntries(fromWord!)[0]?.text).toBe("beta");
    expect(indexedTextEntries(fromWhitespace!)[0]?.text).toBe("alphabeta");
  });

  test("deletes an existing selection regardless of direction", () => {
    const state = setup("alpha beta");
    const path = getPath(state, "alpha beta");
    const selected = setSelection(state, {
      anchor: { path: path.path, offset: 0 },
      focus: { path: path.path, offset: "alpha".length },
    });

    expect(indexedTextEntries(deleteWord(selected, "previousWord")!)[0]?.text).toBe(" beta");
    expect(indexedTextEntries(deleteWord(selected, "wordEnd")!)[0]?.text).toBe(" beta");
  });

  test("deletes inline objects as atomic units", () => {
    const state = setup("before ![alt](https://example.com/image.png) after");
    const path = getPath(state, `before \uFFFC after`);
    const objectEnd = path.text.indexOf("\uFFFC") + 1;
    const nextState = deleteWord(placeAt(state, path, objectEnd), "previousWord");

    expect(toMarkdown(nextState!)).toBe("before  after\n");
  });

  test("deletes backward and forward across ordinary root text blocks", () => {
    const state = setup("alpha\n\nbeta");
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta");
    const backward = deleteWord(placeAt(state, beta, "start"), "previousWord");
    const forward = deleteWord(placeAt(state, alpha, "end"), "wordEnd");

    expect(toMarkdown(backward!)).toBe("beta\n");
    expect(toMarkdown(forward!)).toBe("alpha\n");
  });

  test("treats root headings as safe text seams", () => {
    const state = setup("# alpha\n\nbeta");
    const alpha = getPath(state, "alpha");
    const beta = getPath(state, "beta");

    expect(toMarkdown(deleteWord(placeAt(state, alpha, "end"), "wordEnd")!)).toBe("# alpha\n");
    expect(toMarkdown(deleteWord(placeAt(state, beta, "start"), "previousWord")!)).toBe("beta\n");
  });

  test("deletes to the next word across a safe text seam", () => {
    const state = setup("alpha\n\nbeta");
    const alpha = getPath(state, "alpha");
    const forward = deleteWord(placeAt(state, alpha, "end"), "nextWord");

    expect(toMarkdown(forward!)).toBe("alphabeta\n");
  });

  test("deletes trailing punctuation at a backward root seam", () => {
    const state = setup("alpha...\n\nbeta");
    const beta = getPath(state, "beta");
    const backward = deleteWord(placeAt(state, beta, "start"), "previousWord");

    expect(toMarkdown(backward!)).toBe("alphabeta\n");
  });

  test("falls back to the current path edge before a structural barrier", () => {
    const state = setup("alpha\n\n---\n\nomega");
    const alpha = getPath(state, "alpha");
    const nextState = deleteWord(placeAt(state, alpha, 2), "nextWord");

    expect(toMarkdown(nextState!)).toBe("al\n\n---\n\nomega\n");
  });

  test("falls back to the current path edge at the end of the document", () => {
    const state = setup("alpha");
    const alpha = getPath(state, "alpha");
    const nextState = deleteWord(placeAt(state, alpha, 2), "nextWord");

    expect(toMarkdown(nextState!)).toBe("al\n");
  });

  test("skips empty root paragraphs and headings between ordinary text blocks", () => {
    const state = createEditorState(
      createDocument([
        createParagraphTextBlock("alpha"),
        createParagraphTextBlock(""),
        createHeadingTextBlock({ depth: 2, text: "" }),
        createParagraphTextBlock("omega"),
      ]),
    );
    const alpha = getPath(state, "alpha");
    const omega = getPath(state, "omega");
    const forward = deleteWord(placeAt(state, alpha, "end"), "wordEnd");
    const backward = deleteWord(placeAt(state, omega, "start"), "previousWord");

    expect(toMarkdown(forward!)).toBe("alpha\n");
    expect(toMarkdown(backward!)).toBe("omega\n");
  });

  test.each([
    ["nested text", "alpha\n\n- nested words\n\nomega"],
    ["source text", "alpha\n\n```\nsource\n```\n\nomega"],
  ])("does not cross %s", (_label, markdown) => {
    const state = setup(markdown);
    const alpha = getPath(state, "alpha");
    const omega = getPath(state, "omega");
    const forwardState = placeAt(state, alpha, "end");
    const backwardState = placeAt(state, omega, "start");
    const markdownBeforeDelete = toMarkdown(state);
    const document = state.documentIndex.document;
    const history = state.history;

    expect(deleteWord(forwardState, "wordEnd")).toBeNull();
    expect(deleteWord(backwardState, "previousWord")).toBeNull();
    expect(state.documentIndex.document).toBe(document);
    expect(state.history).toBe(history);
    expect(toMarkdown(state)).toBe(markdownBeforeDelete);
  });

  test("deletes words within table cells", () => {
    const state = setup("| alpha beta | gamma |\n| --- | --- |");
    const cell = getPath(state, "alpha beta");
    const nextState = deleteWord(placeAt(state, cell, "end"), "previousWord");

    expect(toMarkdown(nextState!)).toBe("| alpha | gamma |\n| ----- | ----- |\n");
  });

  test("does not leave table cells or source blocks", () => {
    const tableState = setup("| alpha | beta |\n| --- | --- |");
    const alphaCell = getPath(tableState, "alpha");
    const betaCell = getPath(tableState, "beta");

    expect(deleteWord(placeAt(tableState, alphaCell, "end"), "wordEnd")).toBeNull();
    expect(deleteWord(placeAt(tableState, betaCell, "start"), "previousWord")).toBeNull();

    const codeState = setup("```\ncode line\n```");
    const code = getPath(codeState, "code line");

    expect(deleteWord(placeAt(codeState, code, "start"), "previousWord")).toBeNull();
    expect(deleteWord(placeAt(codeState, code, "end"), "wordEnd")).toBeNull();
  });

  test.each([
    ["code block", "```\nalpha beta\n```", "alpha beta", "alpha "],
    ["list item", "- alpha beta", "alpha beta", "alpha "],
  ])("deletes within a %s without crossing its structure", (_label, markdown, text, nextText) => {
    const state = setup(markdown);
    const path = getPath(state, text);
    const nextState = deleteWord(placeAt(state, path, "end"), "previousWord");

    expect(nextState).not.toBeNull();
    expect(getPath(nextState!, nextText).block.type).toBe(path.block.type);
  });

  test("deletes reversed and cross-structure selections like ordinary selection deletion", () => {
    const state = setup("alpha\n\n---\n\nomega");
    const alpha = getPath(state, "alpha");
    const omega = getPath(state, "omega");
    const selected = setSelection(state, {
      anchor: { path: omega.path, offset: "omega".length },
      focus: { path: alpha.path, offset: 0 },
    });
    const expected = deleteSelection(selected);

    expect(toMarkdown(deleteWord(selected, "previousWord")!)).toBe(toMarkdown(expected));
    expect(toMarkdown(deleteWord(selected, "wordEnd")!)).toBe(toMarkdown(expected));
  });

  test("records word deletion as one undoable mutation from the original caret", () => {
    const state = setup("alpha\n\nbeta gamma");
    const alpha = getPath(state, "alpha");
    const placed = placeAt(state, alpha, "end");
    const deleted = deleteWord(placed, "wordEnd");
    const restored = undo(deleted!);
    const redone = redo(restored!);

    expect(toMarkdown(deleted!)).toBe("alpha gamma\n");
    expect(toMarkdown(restored!)).toBe("alpha\n\nbeta gamma\n");
    expect(restored!.selection).toEqual(placed.selection);
    expect(toMarkdown(redone!)).toBe("alpha gamma\n");
  });

  test("repairs comments after cross-root word deletion", () => {
    const snapshot = parseDocument("alpha\n\nbeta gamma\n");
    const gammaContainer = listAnchorContainers(snapshot)[1];

    if (!gammaContainer) {
      throw new Error("Expected an anchor container for the second paragraph");
    }

    const thread = createCommentThread({
      anchor: createAnchorFromContainer(gammaContainer, "beta ".length, "beta gamma".length),
      body: "keep this",
      createdAt: "2026-07-28T00:00:00.000Z",
      quote: extractQuoteFromContainer(gammaContainer, "beta ".length, "beta gamma".length),
    });
    const state = createEditorState({ ...snapshot, comments: [thread] });
    const alpha = getPath(state, "alpha");
    const deleted = deleteWord(placeAt(state, alpha, "end"), "wordEnd");
    const comments = createDocumentFromEditorState(deleted!).comments;

    expect(indexedTextEntries(deleted!)[0]?.text).toBe("alpha gamma");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.quote).toBe("gamma");
  });

  test("does nothing at document boundaries", () => {
    const state = setup("alpha");
    const path = getPath(state, "alpha");

    expect(deleteWord(placeAt(state, path, "start"), "previousWord")).toBeNull();
    expect(deleteWord(placeAt(state, path, "end"), "wordEnd")).toBeNull();
  });
});
