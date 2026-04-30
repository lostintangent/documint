import { expect, test } from "bun:test";
import { insertText } from "@/editor/state";
import { createDocumentFromEditorState, createEditorState, setSelection } from "@/editor/state";
import { parseDocument, serializeDocument } from "@/markdown";

test("applies text input inside nested editable regions", () => {
  let state = createEditorState(parseDocument("- parent\n  - child\n"));
  const child = state.documentIndex.regions.find((container) => container.text === "child");

  if (!child) {
    throw new Error("Expected nested child container");
  }

  state = setSelection(state, {
    regionId: child.id,
    offset: 0,
  });
  state = insertText(state, "z") ?? state;

  expect(serializeDocument(createDocumentFromEditorState(state))).toBe("- parent\n  - zchild\n");
});

test("creates headings from lightweight markdown triggers", () => {
  let headingState = createEditorState(parseDocument("x\n"));
  const headingContainer = headingState.documentIndex.regions[0];

  if (!headingContainer) {
    throw new Error("Expected paragraph container");
  }

  headingState = setSelection(headingState, {
    anchor: {
      regionId: headingContainer.id,
      offset: 0,
    },
    focus: {
      regionId: headingContainer.id,
      offset: headingContainer.text.length,
    },
  });
  headingState = insertText(headingState, "#") ?? headingState;
  headingState = insertText(headingState, " ") ?? headingState;

  expect(serializeDocument(createDocumentFromEditorState(headingState))).toBe("#\n");
  expect(
    headingState.documentIndex.regions.some(
      (container) => container.id === headingState.selection.focus.regionId,
    ),
  ).toBe(true);

  let subheadingState = createEditorState(parseDocument("x\n"));
  const subheadingContainer = subheadingState.documentIndex.regions[0];

  if (!subheadingContainer) {
    throw new Error("Expected paragraph container");
  }

  subheadingState = setSelection(subheadingState, {
    anchor: {
      regionId: subheadingContainer.id,
      offset: 0,
    },
    focus: {
      regionId: subheadingContainer.id,
      offset: subheadingContainer.text.length,
    },
  });
  subheadingState = insertText(subheadingState, "####") ?? subheadingState;
  subheadingState = insertText(subheadingState, " ") ?? subheadingState;

  expect(serializeDocument(createDocumentFromEditorState(subheadingState))).toBe("####\n");
  expect(
    subheadingState.documentIndex.regions.some(
      (container) => container.id === subheadingState.selection.focus.regionId,
    ),
  ).toBe(true);
});

test("creates blockquotes from lightweight markdown triggers", () => {
  let quoteState = createEditorState(parseDocument("x\n"));
  const quoteContainer = quoteState.documentIndex.regions[0];

  if (!quoteContainer) {
    throw new Error("Expected paragraph container");
  }

  quoteState = setSelection(quoteState, {
    anchor: {
      regionId: quoteContainer.id,
      offset: 0,
    },
    focus: {
      regionId: quoteContainer.id,
      offset: quoteContainer.text.length,
    },
  });
  quoteState = insertText(quoteState, ">") ?? quoteState;
  quoteState = insertText(quoteState, " ") ?? quoteState;

  expect(serializeDocument(createDocumentFromEditorState(quoteState))).toBe(">\n");
  expect(
    quoteState.documentIndex.regions.some(
      (container) => container.id === quoteState.selection.focus.regionId,
    ),
  ).toBe(true);
});

test("transforms heading depth from typed markdown markers at the start of a heading", () => {
  let state = createEditorState(parseDocument("## Heading\n"));
  const heading = state.documentIndex.regions.find((container) => container.text === "Heading");

  if (!heading) {
    throw new Error("Expected heading container");
  }

  state = setSelection(state, {
    regionId: heading.id,
    offset: 0,
  });
  state = insertText(state, "#") ?? state;
  state = insertText(state, " ") ?? state;

  expect(serializeDocument(createDocumentFromEditorState(state))).toBe("# Heading\n");
});

test("transforms list type from typed markdown markers at the start of a list item", () => {
  let unorderedState = createEditorState(parseDocument("1. alpha\n2. beta\n"));
  const alpha = unorderedState.documentIndex.regions.find(
    (container) => container.text === "alpha",
  );

  if (!alpha) {
    throw new Error("Expected ordered list container");
  }

  unorderedState = setSelection(unorderedState, {
    regionId: alpha.id,
    offset: 0,
  });
  unorderedState = insertText(unorderedState, "-") ?? unorderedState;
  unorderedState = insertText(unorderedState, " ") ?? unorderedState;

  expect(serializeDocument(createDocumentFromEditorState(unorderedState))).toBe(
    "- alpha\n- beta\n",
  );

  let orderedState = createEditorState(parseDocument("- alpha\n- beta\n"));
  const beta = orderedState.documentIndex.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected unordered list container");
  }

  orderedState = setSelection(orderedState, {
    regionId: beta.id,
    offset: 0,
  });
  orderedState = insertText(orderedState, "1.") ?? orderedState;
  orderedState = insertText(orderedState, " ") ?? orderedState;

  expect(serializeDocument(createDocumentFromEditorState(orderedState))).toBe(
    "1. alpha\n1. beta\n",
  );
});
