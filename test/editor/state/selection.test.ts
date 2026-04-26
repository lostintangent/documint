import { expect, test } from "bun:test";
import { createEditorState, getSelectionContext, selectAll, setSelection } from "@/editor/state";
import { parseMarkdown } from "@/markdown";

test("derives the active block and span from the selection anchor", () => {
  let state = createEditorState(
    parseMarkdown("Paragraph with **strong** text and [link](https://example.com).\n"),
  );
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

test("selectAll expands the selection from the start of the first region to the end of the last", () => {
  const state = createEditorState(parseMarkdown("# Heading\n\nalpha\n\n- one\n- two\n\ngamma\n"));
  const [first] = state.documentIndex.regions;
  const last = state.documentIndex.regions.at(-1);

  if (!first || !last) {
    throw new Error("Expected first and last regions");
  }

  const nextState = selectAll(state);

  expect(nextState.selection.anchor).toEqual({ offset: 0, regionId: first.id });
  expect(nextState.selection.focus).toEqual({
    offset: last.text.length,
    regionId: last.id,
  });
});

test("selectAll collapses to a single point on an empty document", () => {
  const state = createEditorState(parseMarkdown(""));
  const nextState = selectAll(state);

  // An empty document normalizes to a single empty paragraph, so the range
  // from first-region-start to last-region-end collapses to one point.
  expect(nextState.selection.anchor).toEqual(nextState.selection.focus);
});
