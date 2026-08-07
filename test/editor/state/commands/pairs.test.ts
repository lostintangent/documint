import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { insertText } from "@/editor/state";
import { getPath, getPathByType, placeAt, selectIn, setup, toMarkdown } from "../../helpers";

describe("Pair completion", () => {
  test("completes opening delimiters and lands the caret between the pair", () => {
    let state = setup("alpha\n");
    const path = getPath(state, "alpha");

    state = placeAt(state, path, 2);
    state = insertText(state, "(") ?? state;

    expect(getPath(state, "al()pha").text).toBe("al()pha");
    expect(state.selection.anchor).toEqual({
      path: state.selection.focus.path,
      offset: 3,
    });

    state = insertText(state, "[") ?? state;

    expect(getPath(state, "al([])pha").text).toBe("al([])pha");
    expect(state.selection.anchor).toEqual({
      path: state.selection.focus.path,
      offset: 4,
    });

    state = insertText(state, "{") ?? state;

    expect(getPath(state, "al([{}])pha").text).toBe("al([{}])pha");
    expect(state.selection.anchor).toEqual({
      path: state.selection.focus.path,
      offset: 5,
    });
  });

  test("completes delimiters inside nested editable paths", () => {
    let state = setup("- parent\n  - child\n");
    const child = getPath(state, "child");

    state = placeAt(state, child, 0);
    state = insertText(state, "{") ?? state;

    expect(toMarkdown(state)).toBe("- parent\n  - {}child\n");
    expect(state.selection.anchor).toEqual({
      path: state.selection.focus.path,
      offset: 1,
    });
  });

  test("completes delimiters inside source text paths", () => {
    let state = setup("```ts\nalpha\n```\n");
    const code = getPathByType(state, "code");

    state = placeAt(state, code, "end");
    state = insertText(state, "[") ?? state;

    expect(toMarkdown(state)).toBe("```ts\nalpha[]\n```\n");
    expect(state.selection.anchor).toEqual({
      path: state.selection.focus.path,
      offset: "alpha".length + 1,
    });
  });

  test("does not complete delimiters for multi-character inserts or selected ranges", () => {
    let state = setup("alpha\n");
    const path = getPath(state, "alpha");

    state = placeAt(state, path, "end");
    state = insertText(state, "()") ?? state;

    expect(toMarkdown(state)).toBe("alpha()\n");
    expect(state.selection.anchor).toEqual({
      path: state.selection.focus.path,
      offset: "alpha()".length,
    });

    const nextPath = getPath(state, "alpha()");
    state = selectIn(state, nextPath, 0, nextPath.text.length);
    state = insertText(state, "(") ?? state;

    expect(toMarkdown(state)).toBe("(\n");
    expect(state.selection.anchor).toEqual({
      path: state.selection.focus.path,
      offset: 1,
    });
  });

  test("completed square brackets can still feed the task-list trigger", () => {
    let state = setup("\n");
    const path = getPath(state, "");

    state = placeAt(state, path, 0);
    state = insertText(state, "[") ?? state;
    state = insertText(state, " ") ?? state;

    const completed = getPath(state, "[ ]");
    state = placeAt(state, completed, "end");
    state = insertText(state, " ") ?? state;

    expect(toMarkdown(state)).toBe("- [ ] \n");
    expect(indexedTextEntries(state).some((r) => r.path === state.selection.focus.path)).toBe(true);
  });
});
