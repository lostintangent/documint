import { expect, test } from "bun:test";
import {
  applyTextInputRule,
} from "@/editor/model/commands";
import {
  createDocumentFromEditorState,
  createEditorState,
  setCanvasSelection as setSelection,
} from "@/editor/model/state";
import { parseMarkdown, serializeMarkdown } from "@/markdown";

test("applies text input inside nested editable regions", () => {
  let state = createEditorState(parseMarkdown("- parent\n  - child\n"));
  const child = state.documentEditor.regions.find((container) => container.text === "child");

  if (!child) {
    throw new Error("Expected nested child container");
  }

  state = setSelection(state, {
    regionId: child.id,
    offset: 0,
  });
  state = applyTextInputRule(state, "z") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "- parent\n  - zchild\n",
  );
});

test("creates headings from lightweight markdown triggers", () => {
  let headingState = createEditorState(parseMarkdown("x\n"));
  const headingContainer = headingState.documentEditor.regions[0];

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
  headingState = applyTextInputRule(headingState, "#") ?? headingState;
  headingState = applyTextInputRule(headingState, " ") ?? headingState;

  expect(serializeMarkdown(createDocumentFromEditorState(headingState))).toBe(
    "#\n",
  );
  expect(
    headingState.documentEditor.regions.some((container) => container.id === headingState.selection.focus.regionId),
  ).toBe(true);

  let subheadingState = createEditorState(parseMarkdown("x\n"));
  const subheadingContainer = subheadingState.documentEditor.regions[0];

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
  subheadingState = applyTextInputRule(subheadingState, "####") ?? subheadingState;
  subheadingState = applyTextInputRule(subheadingState, " ") ?? subheadingState;

  expect(serializeMarkdown(createDocumentFromEditorState(subheadingState))).toBe(
    "####\n",
  );
  expect(
    subheadingState.documentEditor.regions.some((container) => container.id === subheadingState.selection.focus.regionId),
  ).toBe(true);
});

test("creates blockquotes from lightweight markdown triggers", () => {
  let quoteState = createEditorState(parseMarkdown("x\n"));
  const quoteContainer = quoteState.documentEditor.regions[0];

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
  quoteState = applyTextInputRule(quoteState, ">") ?? quoteState;
  quoteState = applyTextInputRule(quoteState, " ") ?? quoteState;

  expect(serializeMarkdown(createDocumentFromEditorState(quoteState))).toBe(
    ">\n",
  );
  expect(
    quoteState.documentEditor.regions.some((container) => container.id === quoteState.selection.focus.regionId),
  ).toBe(true);
});

test("transforms heading depth from typed markdown markers at the start of a heading", () => {
  let state = createEditorState(parseMarkdown("## Heading\n"));
  const heading = state.documentEditor.regions.find((container) => container.text === "Heading");

  if (!heading) {
    throw new Error("Expected heading container");
  }

  state = setSelection(state, {
    regionId: heading.id,
    offset: 0,
  });
  state = applyTextInputRule(state, "#") ?? state;
  state = applyTextInputRule(state, " ") ?? state;

  expect(serializeMarkdown(createDocumentFromEditorState(state))).toBe(
    "# Heading\n",
  );
});

test("transforms list type from typed markdown markers at the start of a list item", () => {
  let unorderedState = createEditorState(parseMarkdown("1. alpha\n2. beta\n"));
  const alpha = unorderedState.documentEditor.regions.find((container) => container.text === "alpha");

  if (!alpha) {
    throw new Error("Expected ordered list container");
  }

  unorderedState = setSelection(unorderedState, {
    regionId: alpha.id,
    offset: 0,
  });
  unorderedState = applyTextInputRule(unorderedState, "-") ?? unorderedState;
  unorderedState = applyTextInputRule(unorderedState, " ") ?? unorderedState;

  expect(serializeMarkdown(createDocumentFromEditorState(unorderedState))).toBe(
    "- alpha\n- beta\n",
  );

  let orderedState = createEditorState(parseMarkdown("- alpha\n- beta\n"));
  const beta = orderedState.documentEditor.regions.find((container) => container.text === "beta");

  if (!beta) {
    throw new Error("Expected unordered list container");
  }

  orderedState = setSelection(orderedState, {
    regionId: beta.id,
    offset: 0,
  });
  orderedState = applyTextInputRule(orderedState, "1.") ?? orderedState;
  orderedState = applyTextInputRule(orderedState, " ") ?? orderedState;

  expect(serializeMarkdown(createDocumentFromEditorState(orderedState))).toBe(
    "1. alpha\n1. beta\n",
  );
});
