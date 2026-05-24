import { describe, expect, test } from "bun:test";
import { insertCodeBlock, insertLineBreak } from "@/editor/state";
import { getRegion, placeAt, setup, toMarkdown } from "../../helpers";

describe("Code block insertion", () => {
  test("inserts an empty code block from an empty root paragraph", () => {
    let state = setup("");
    const empty = getRegion(state, "");

    state = insertCodeBlock(placeAt(state, empty, "start"))!;

    expect(toMarkdown(state)).toBe("```\n\n```\n");

    const codeRegion = state.documentIndex.regions.find((region) => region.block.type === "code");

    expect(codeRegion).toBeDefined();
    expect(state.selection.focus.regionId).toBe(codeRegion!.id);
    expect(state.selection.focus.offset).toBe(0);
  });

  test("does not insert a code block from a non-empty paragraph", () => {
    const state = setup("Hello");
    const paragraph = getRegion(state, "Hello");

    expect(insertCodeBlock(placeAt(state, paragraph, "start"))).toBeNull();
  });
});

describe("Code block line breaks", () => {
  test("keeps trailing blank lines in source until the exit threshold", () => {
    let state = setup("```ts\nconst x = 1;\n```\n");
    const code = getRegion(state, "const x = 1;");

    state = placeAt(state, code, "end");
    state = insertLineBreak(state)!;
    state = insertLineBreak(state)!;

    expect(toMarkdown(state)).toBe("```ts\nconst x = 1;\n\n\n```\n");
    expect(state.documentIndex.regions).toHaveLength(1);
    expect(state.selection.focus.regionId).toBe(state.documentIndex.regions[0]?.id);
  });

  test("exits a code block from consecutive trailing blank lines", () => {
    let state = setup("```ts\nconst x = 1;\n\n\n```\n");
    const code = state.documentIndex.regions[0];

    if (!code) {
      throw new Error("Expected code region");
    }

    state = placeAt(state, code, "end");
    state = insertLineBreak(state)!;

    const [trimmedCode, paragraph] = state.documentIndex.regions;

    expect(toMarkdown(state)).toBe("```ts\nconst x = 1;\n```\n\n");
    expect(trimmedCode?.block.type).toBe("code");
    expect(trimmedCode?.text).toBe("const x = 1;");
    expect(paragraph?.block.type).toBe("paragraph");
    expect(paragraph?.text).toBe("");
    expect(state.selection.focus.regionId).toBe(paragraph?.id);
    expect(state.selection.focus.offset).toBe(0);
  });

  test("does not exit a code block from consecutive blank lines before the end", () => {
    let state = setup("```\nalpha\n\nbeta\n```\n");
    const code = state.documentIndex.regions[0];

    if (!code) {
      throw new Error("Expected code region");
    }

    state = placeAt(state, code, "alpha\n\n".length);
    state = insertLineBreak(state)!;

    expect(toMarkdown(state)).toBe("```\nalpha\n\n\nbeta\n```\n");
    expect(state.documentIndex.regions).toHaveLength(1);
  });
});
