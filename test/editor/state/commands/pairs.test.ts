import { describe, expect, test } from "bun:test";
import { insertText } from "@/editor/state";
import { getRegion, getRegionByType, placeAt, selectIn, setup, toMarkdown } from "../../helpers";

describe("Pair completion", () => {
  test("completes opening delimiters and lands the caret between the pair", () => {
    let state = setup("alpha\n");
    const region = getRegion(state, "alpha");

    state = placeAt(state, region, 2);
    state = insertText(state, "(") ?? state;

    expect(getRegion(state, "al()pha").text).toBe("al()pha");
    expect(state.selection.anchor).toEqual({
      regionPath: state.selection.focus.regionPath,
      offset: 3,
    });

    state = insertText(state, "[") ?? state;

    expect(getRegion(state, "al([])pha").text).toBe("al([])pha");
    expect(state.selection.anchor).toEqual({
      regionPath: state.selection.focus.regionPath,
      offset: 4,
    });

    state = insertText(state, "{") ?? state;

    expect(getRegion(state, "al([{}])pha").text).toBe("al([{}])pha");
    expect(state.selection.anchor).toEqual({
      regionPath: state.selection.focus.regionPath,
      offset: 5,
    });
  });

  test("completes delimiters inside nested editable regions", () => {
    let state = setup("- parent\n  - child\n");
    const child = getRegion(state, "child");

    state = placeAt(state, child, 0);
    state = insertText(state, "{") ?? state;

    expect(toMarkdown(state)).toBe("- parent\n  - {}child\n");
    expect(state.selection.anchor).toEqual({
      regionPath: state.selection.focus.regionPath,
      offset: 1,
    });
  });

  test("completes delimiters inside source text regions", () => {
    let state = setup("```ts\nalpha\n```\n");
    const code = getRegionByType(state, "code");

    state = placeAt(state, code, "end");
    state = insertText(state, "[") ?? state;

    expect(toMarkdown(state)).toBe("```ts\nalpha[]\n```\n");
    expect(state.selection.anchor).toEqual({
      regionPath: state.selection.focus.regionPath,
      offset: "alpha".length + 1,
    });
  });

  test("does not complete delimiters for multi-character inserts or selected ranges", () => {
    let state = setup("alpha\n");
    const region = getRegion(state, "alpha");

    state = placeAt(state, region, "end");
    state = insertText(state, "()") ?? state;

    expect(toMarkdown(state)).toBe("alpha()\n");
    expect(state.selection.anchor).toEqual({
      regionPath: state.selection.focus.regionPath,
      offset: "alpha()".length,
    });

    const nextRegion = getRegion(state, "alpha()");
    state = selectIn(state, nextRegion, 0, nextRegion.text.length);
    state = insertText(state, "(") ?? state;

    expect(toMarkdown(state)).toBe("(\n");
    expect(state.selection.anchor).toEqual({
      regionPath: state.selection.focus.regionPath,
      offset: 1,
    });
  });

  test("completed square brackets can still feed the task-list trigger", () => {
    let state = setup("\n");
    const region = getRegion(state, "");

    state = placeAt(state, region, 0);
    state = insertText(state, "[") ?? state;
    state = insertText(state, " ") ?? state;

    const completed = getRegion(state, "[ ]");
    state = placeAt(state, completed, "end");
    state = insertText(state, " ") ?? state;

    expect(toMarkdown(state)).toBe("- [ ] \n");
    expect(state.documentIndex.regions.some((r) => r.path === state.selection.focus.regionPath)).toBe(
      true,
    );
  });
});
