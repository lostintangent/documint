import { expect, test } from "bun:test";
import { insertText, setSelection } from "@/editor/state";
import { getRegion, placeAt, setup, toMarkdown } from "../../helpers";

test("applies text input inside nested editable regions", () => {
  let state = setup("- parent\n  - child\n");
  const child = getRegion(state, "child");

  state = placeAt(state, child, 0);
  state = insertText(state, "z") ?? state;

  expect(toMarkdown(state)).toBe("- parent\n  - zchild\n");
});

test("creates headings from lightweight markdown triggers", () => {
  let headingState = setup("x\n");
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

  expect(toMarkdown(headingState)).toBe("#\n");
  expect(
    headingState.documentIndex.regions.some(
      (container) => container.id === headingState.selection.focus.regionId,
    ),
  ).toBe(true);

  let subheadingState = setup("x\n");
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

  expect(toMarkdown(subheadingState)).toBe("####\n");
  expect(
    subheadingState.documentIndex.regions.some(
      (container) => container.id === subheadingState.selection.focus.regionId,
    ),
  ).toBe(true);
});

test("creates blockquotes from lightweight markdown triggers", () => {
  let quoteState = setup("x\n");
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

  expect(toMarkdown(quoteState)).toBe(">\n");
  expect(
    quoteState.documentIndex.regions.some(
      (container) => container.id === quoteState.selection.focus.regionId,
    ),
  ).toBe(true);
});

test("transforms heading depth from typed markdown markers at the start of a heading", () => {
  let state = setup("## Heading\n");
  const heading = getRegion(state, "Heading");

  state = placeAt(state, heading, 0);
  state = insertText(state, "#") ?? state;
  state = insertText(state, " ") ?? state;

  expect(toMarkdown(state)).toBe("# Heading\n");
});

test("transforms list type from typed markdown markers at the start of a list item", () => {
  let unorderedState = setup("1. alpha\n2. beta\n");
  const alpha = getRegion(unorderedState, "alpha");

  unorderedState = placeAt(unorderedState, alpha, 0);
  unorderedState = insertText(unorderedState, "-") ?? unorderedState;
  unorderedState = insertText(unorderedState, " ") ?? unorderedState;

  expect(toMarkdown(unorderedState)).toBe(
    "- alpha\n- beta\n",
  );

  let orderedState = setup("- alpha\n- beta\n");
  const beta = getRegion(orderedState, "beta");

  orderedState = placeAt(orderedState, beta, 0);
  orderedState = insertText(orderedState, "1.") ?? orderedState;
  orderedState = insertText(orderedState, " ") ?? orderedState;

  expect(toMarkdown(orderedState)).toBe(
    "1. alpha\n1. beta\n",
  );
});
