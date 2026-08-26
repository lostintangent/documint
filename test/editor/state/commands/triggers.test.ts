import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { getCommentState } from "@/editor";
import { addComment, insertText, setSelection, type EditorState } from "@/editor/state";
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
  test("creates root structures while preserving content to the right", () => {
    const cases = [
      { marker: "*", markdown: "- alpha\n" },
      { marker: "  42.", markdown: "42. alpha\n" },
      { marker: "#", markdown: "# alpha\n" },
      { marker: ">", markdown: "> alpha\n" },
      { marker: "[x]", markdown: "- [x] alpha\n" },
      { marker: "---", markdown: "---\n\nalpha\n" },
    ];

    for (const { marker, markdown } of cases) {
      const state = applyTriggerAtStart("alpha\n", marker);

      expect(toMarkdown(state)).toBe(markdown);
      expectCaretAtStart(state, "alpha");
    }
  });

  test("preserves empty heading, blockquote, and divider triggers", () => {
    const cases = [
      { marker: "####", markdown: "####\n" },
      { marker: ">", markdown: ">\n" },
      { marker: "---", markdown: "---\n\n" },
    ];

    for (const { marker, markdown } of cases) {
      const state = applyTriggerAtStart("", marker);

      expect(toMarkdown(state)).toBe(markdown);
      expectCaretAtStart(state, "");
    }
  });

  test("preserves rich inline suffix content", () => {
    const content = "**alpha** [link](https://example.com) ![alt](https://example.com/image.png)";
    const state = applyTriggerAtStart(`${content}\n`, "#");

    expect(toMarkdown(state)).toBe(`# ${content}\n`);
  });

  test("preserves the suffix of a same-path selection replacement", () => {
    let state = setup("prefix alpha\n");
    const path = getPath(state, "prefix alpha");

    state = setSelection(state, {
      anchor: { path: path.path, offset: "prefix ".length },
      focus: { path: path.path, offset: 0 },
    });
    state = insertText(state, "> ") ?? state;

    expect(toMarkdown(state)).toBe("> alpha\n");
    expectCaretAtStart(state, "alpha");
  });

  test("does not complete creation triggers from pre-existing suffix whitespace", () => {
    let state = setup("&#x20;\n");
    const path = getPath(state, " ");

    state = placeAt(state, path, 0);
    state = insertText(state, "*") ?? state;

    expect(getPath(state, "* ").block.type).toBe("paragraph");
  });

  test("does not retroactively trigger from later whitespace", () => {
    let state = setup("\\* alpha\n");
    const path = getPath(state, "* alpha");

    state = placeAt(state, path, "end");
    state = insertText(state, " ") ?? state;

    expect(getPath(state, "* alpha ").block.type).toBe("paragraph");
  });

  test("does not trigger from markers in the middle of a paragraph", () => {
    let state = setup("alpha\n");
    const path = getPath(state, "alpha");

    state = placeAt(state, path, 2);
    state = insertText(state, "*") ?? state;
    state = insertText(state, " ") ?? state;

    expect(getPath(state, "al* pha").block.type).toBe("paragraph");
  });

  test("preserves comments anchored in suffix content", () => {
    let state = setup("alpha\n");
    const path = getPath(state, "alpha");

    state =
      addComment(state, { path: path.path, startOffset: 0, endOffset: path.text.length }, "note") ??
      state;
    state = applyTriggerAtStartOfState(state, "#");

    const commentState = getCommentState(state);

    expect(commentState.threads.map((thread) => thread.quote)).toEqual(["alpha"]);
    expect(commentState.ranges).toHaveLength(1);
  });
});

describe("Markdown transform triggers", () => {
  test("transforms heading depth while preserving inline content", () => {
    let state = setup("## **Heading**\n");
    const heading = getPath(state, "Heading");

    state = placeAt(state, heading, 0);
    state = insertText(state, "#") ?? state;
    state = insertText(state, " ") ?? state;

    expect(toMarkdown(state)).toBe("# **Heading**\n");
  });

  test("transforms list type while preserving inline content", () => {
    let unorderedState = setup("1. **alpha**\n2. beta\n");
    const alpha = getPath(unorderedState, "alpha");

    unorderedState = placeAt(unorderedState, alpha, 0);
    unorderedState = insertText(unorderedState, "-") ?? unorderedState;
    unorderedState = insertText(unorderedState, " ") ?? unorderedState;

    expect(toMarkdown(unorderedState)).toBe("- **alpha**\n- beta\n");

    let orderedState = setup("- alpha\n- beta\n");
    const beta = getPath(orderedState, "beta");

    orderedState = placeAt(orderedState, beta, 0);
    orderedState = insertText(orderedState, "1.") ?? orderedState;
    orderedState = insertText(orderedState, " ") ?? orderedState;

    expect(toMarkdown(orderedState)).toBe("1. alpha\n1. beta\n");

    let taskState = setup("- alpha\n- beta\n");
    const taskAlpha = getPath(taskState, "alpha");

    taskState = placeAt(taskState, taskAlpha, 0);
    taskState = insertText(taskState, "[x]") ?? taskState;
    taskState = insertText(taskState, " ") ?? taskState;

    expect(toMarkdown(taskState)).toBe("- [x] alpha\n- beta\n");
  });

  test("transforms empty headings and list items", () => {
    const headingState = applyTriggerAtStart("## \n", "#");
    const listState = applyTriggerAtStart("-\n", "1.");

    expect(toMarkdown(headingState)).toBe("#\n");
    expectCaretAtStart(headingState, "");
    expect(toMarkdown(listState)).toBe("1.\n");
    expectCaretAtStart(listState, "");
  });

  test("does not retroactively transform from later whitespace", () => {
    let state = setup("## \\# Heading\n");
    const heading = getPath(state, "# Heading");

    state = placeAt(state, heading, "end");
    state = insertText(state, " ") ?? state;

    expect(getPath(state, "# Heading ").block).toMatchObject({
      depth: 2,
      type: "heading",
    });
  });
});

function applyTriggerAtStart(markdown: string, marker: string) {
  return applyTriggerAtStartOfState(setup(markdown), marker);
}

function applyTriggerAtStartOfState(state: EditorState, marker: string) {
  const path = indexedTextEntries(state)[0];

  if (!path) {
    throw new Error("Expected path");
  }

  state = placeAt(state, path, 0);
  state = insertText(state, marker) ?? state;
  state = insertText(state, " ") ?? state;

  return state;
}

function expectCaretAtStart(state: EditorState, text: string) {
  const active = indexedTextEntries(state).find(
    (container) => container.path === state.selection.focus.path,
  );

  expect(active?.text).toBe(text);
  expect(state.selection.anchor.offset).toBe(0);
  expect(state.selection.focus.offset).toBe(0);
}
