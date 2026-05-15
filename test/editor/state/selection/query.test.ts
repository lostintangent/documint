import { expect, test } from "bun:test";
import {
  getCaretTextContext,
  getSelectionContext,
  getSelectionRange,
  setSelection,
} from "@/editor/state";
import { setup } from "../../helpers";

test("derives the active block and span from the selection anchor", () => {
  let state = setup("Paragraph with **strong** text and [link](https://example.com).\n");
  const container = state.documentIndex.regions[0];

  if (!container) {
    throw new Error("Expected container");
  }

  state = setSelection(state, {
    regionId: container.id,
    offset: container.text.indexOf("strong") + 1,
  });

  const marked = getSelectionContext(state);

  expect(marked.block?.nodeType).toBe("paragraph");
  expect(marked.span.kind).toBe("marks");

  state = setSelection(state, {
    regionId: container.id,
    offset: container.text.indexOf("link") + 1,
  });

  const linked = getSelectionContext(state);

  expect(linked.span.kind).toBe("link");
  expect(linked.span.kind === "link" ? linked.span.url : null).toBe("https://example.com");
});

test("derives a same-region selection range", () => {
  let state = setup("alpha\n\nbeta\n");
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected regions");
  }

  state = setSelection(state, {
    anchor: { regionId: first.id, offset: 4 },
    focus: { regionId: first.id, offset: 1 },
  });

  expect(getSelectionRange(state)).toEqual({
    endOffset: 4,
    regionId: first.id,
    startOffset: 1,
  });

  state = setSelection(state, {
    anchor: { regionId: first.id, offset: 1 },
    focus: { regionId: second.id, offset: 1 },
  });

  expect(getSelectionRange(state)).toBeNull();

  state = setSelection(state, {
    regionId: first.id,
    offset: 1,
  });

  expect(getSelectionRange(state)).toBeNull();
});

test("derives caret text context", () => {
  let state = setup("alpha beta\n\ngamma\n");
  const [first, second] = state.documentIndex.regions;

  if (!first || !second) {
    throw new Error("Expected regions");
  }

  state = setSelection(state, {
    regionId: first.id,
    offset: 6,
  });

  expect(getCaretTextContext(state)).toEqual({
    offset: 6,
    regionId: first.id,
    text: "alpha beta",
  });

  state = setSelection(state, {
    anchor: { regionId: first.id, offset: 0 },
    focus: { regionId: second.id, offset: 1 },
  });

  expect(getCaretTextContext(state)).toBeNull();
});
