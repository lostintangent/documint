import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { insertText, setSelection } from "@/editor/state";
import { getPath, placeAt, setup, toMarkdown } from "../../helpers";

describe("Text input", () => {
  test("applies text input inside nested editable paths", () => {
    let state = setup("- parent\n  - child\n");
    const child = getPath(state, "child");

    state = placeAt(state, child, 0);
    state = insertText(state, "z") ?? state;

    expect(toMarkdown(state)).toBe("- parent\n  - zchild\n");
  });
});

describe("Markdown creation triggers", () => {
  test("creates headings from lightweight markdown triggers", () => {
    const headingState = applyTriggerToWholePath("x\n", "#");

    expect(toMarkdown(headingState)).toBe("#\n");
    expect(
      indexedTextEntries(headingState).some(
        (container) => container.path === headingState.selection.focus.path,
      ),
    ).toBe(true);

    const subheadingState = applyTriggerToWholePath("x\n", "####");

    expect(toMarkdown(subheadingState)).toBe("####\n");
    expect(
      indexedTextEntries(subheadingState).some(
        (container) => container.path === subheadingState.selection.focus.path,
      ),
    ).toBe(true);
  });

  test("creates blockquotes from lightweight markdown triggers", () => {
    const quoteState = applyTriggerToWholePath("x\n", ">");

    expect(toMarkdown(quoteState)).toBe(">\n");
    expect(
      indexedTextEntries(quoteState).some(
        (container) => container.path === quoteState.selection.focus.path,
      ),
    ).toBe(true);
  });

  test("does not complete creation triggers from pre-existing suffix whitespace", () => {
    for (const marker of [">", "#", "-", "*", "+", "1.", "---"]) {
      let state = setup("&#x20;\n");
      const path = getPath(state, " ");

      state = placeAt(state, path, 0);
      state = insertText(state, marker) ?? state;

      const active = indexedTextEntries(state).find(
        (container) => container.path === state.selection.focus.path,
      );

      expect(active?.block.type).toBe("paragraph");
      expect(active?.text).toBe(`${marker} `);
    }
  });
});

describe("Markdown transform triggers", () => {
  test("transforms heading depth from typed markdown markers at the start of a heading", () => {
    let state = setup("## Heading\n");
    const heading = getPath(state, "Heading");

    state = placeAt(state, heading, 0);
    state = insertText(state, "#") ?? state;
    state = insertText(state, " ") ?? state;

    expect(toMarkdown(state)).toBe("# Heading\n");
  });

  test("transforms list type from typed markdown markers at the start of a list item", () => {
    let unorderedState = setup("1. alpha\n2. beta\n");
    const alpha = getPath(unorderedState, "alpha");

    unorderedState = placeAt(unorderedState, alpha, 0);
    unorderedState = insertText(unorderedState, "-") ?? unorderedState;
    unorderedState = insertText(unorderedState, " ") ?? unorderedState;

    expect(toMarkdown(unorderedState)).toBe("- alpha\n- beta\n");

    let orderedState = setup("- alpha\n- beta\n");
    const beta = getPath(orderedState, "beta");

    orderedState = placeAt(orderedState, beta, 0);
    orderedState = insertText(orderedState, "1.") ?? orderedState;
    orderedState = insertText(orderedState, " ") ?? orderedState;

    expect(toMarkdown(orderedState)).toBe("1. alpha\n2. beta\n");
  });
});

function applyTriggerToWholePath(markdown: string, marker: string) {
  let state = setup(markdown);
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected path");
  }

  state = setSelection(state, {
    anchor: {
      path: path.path,
      offset: 0,
    },
    focus: {
      path: path.path,
      offset: path.text.length,
    },
  });
  state = insertText(state, marker) ?? state;
  state = insertText(state, " ") ?? state;

  return state;
}
