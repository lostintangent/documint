import { describe, expect, test } from "bun:test";
import { insertText, setSelection } from "@/editor/state";
import { getRegion, placeAt, setup, toMarkdown } from "../../helpers";

describe("Text input", () => {
  test("applies text input inside nested editable regions", () => {
    let state = setup("- parent\n  - child\n");
    const child = getRegion(state, "child");

    state = placeAt(state, child, 0);
    state = insertText(state, "z") ?? state;

    expect(toMarkdown(state)).toBe("- parent\n  - zchild\n");
  });
});

describe("Markdown creation triggers", () => {
  test("creates headings from lightweight markdown triggers", () => {
    const headingState = applyTriggerToWholeRegion("x\n", "#");

    expect(toMarkdown(headingState)).toBe("#\n");
    expect(
      headingState.documentIndex.regions.some(
        (container) => container.id === headingState.selection.focus.regionId,
      ),
    ).toBe(true);

    const subheadingState = applyTriggerToWholeRegion("x\n", "####");

    expect(toMarkdown(subheadingState)).toBe("####\n");
    expect(
      subheadingState.documentIndex.regions.some(
        (container) => container.id === subheadingState.selection.focus.regionId,
      ),
    ).toBe(true);
  });

  test("creates blockquotes from lightweight markdown triggers", () => {
    const quoteState = applyTriggerToWholeRegion("x\n", ">");

    expect(toMarkdown(quoteState)).toBe(">\n");
    expect(
      quoteState.documentIndex.regions.some(
        (container) => container.id === quoteState.selection.focus.regionId,
      ),
    ).toBe(true);
  });
});

describe("Markdown transform triggers", () => {
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

    expect(toMarkdown(unorderedState)).toBe("- alpha\n- beta\n");

    let orderedState = setup("- alpha\n- beta\n");
    const beta = getRegion(orderedState, "beta");

    orderedState = placeAt(orderedState, beta, 0);
    orderedState = insertText(orderedState, "1.") ?? orderedState;
    orderedState = insertText(orderedState, " ") ?? orderedState;

    expect(toMarkdown(orderedState)).toBe("1. alpha\n1. beta\n");
  });
});

function applyTriggerToWholeRegion(markdown: string, marker: string) {
  let state = setup(markdown);
  const region = state.documentIndex.regions[0];

  if (!region) {
    throw new Error("Expected region");
  }

  state = setSelection(state, {
    anchor: {
      regionId: region.id,
      offset: 0,
    },
    focus: {
      regionId: region.id,
      offset: region.text.length,
    },
  });
  state = insertText(state, marker) ?? state;
  state = insertText(state, " ") ?? state;

  return state;
}
