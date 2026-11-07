import { indexedTextEntries } from "@test/editor/helpers";
import { describe, expect, test } from "bun:test";
import { deleteBackward, deleteForward, insertCodeBlock, insertLineBreak } from "@/editor/state";
import { getPath, placeAt, setup, toMarkdown } from "../../helpers";

describe("Code block insertion", () => {
  test("inserts an empty code block from an empty root paragraph", () => {
    let state = setup("");
    const empty = getPath(state, "");

    state = insertCodeBlock(placeAt(state, empty, "start"))!;

    expect(toMarkdown(state)).toBe("```\n\n```\n");

    const codePath = indexedTextEntries(state).find((path) => path.block.type === "code");

    expect(codePath).toBeDefined();
    expect(state.selection.focus.path).toBe(codePath!.path);
    expect(state.selection.focus.offset).toBe(0);
  });

  test.each([
    ["a non-empty paragraph", "Hello", "Hello"],
    ["an empty heading", "## \n", ""],
  ])("does not insert a code block from %s", (_, markdown, text) => {
    const state = setup(markdown);

    expect(insertCodeBlock(placeAt(state, getPath(state, text), "start"))).toBeNull();
  });
});

describe("Code block line breaks", () => {
  test("keeps trailing blank lines in source until the exit threshold", () => {
    let state = setup("```ts\nconst x = 1;\n```\n");
    const code = getPath(state, "const x = 1;");

    state = placeAt(state, code, "end");
    state = insertLineBreak(state)!;
    state = insertLineBreak(state)!;

    expect(toMarkdown(state)).toBe("```ts\nconst x = 1;\n\n\n```\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
    expect(state.selection.focus.path).toBe(indexedTextEntries(state)[0]?.path);
  });

  test("exits a code block from consecutive trailing blank lines", () => {
    let state = setup("```ts\nconst x = 1;\n\n\n```\n");
    const code = indexedTextEntries(state)[0];

    if (!code) {
      throw new Error("Expected code path");
    }

    state = placeAt(state, code, "end");
    state = insertLineBreak(state)!;

    const [trimmedCode, paragraph] = indexedTextEntries(state);

    expect(toMarkdown(state)).toBe("```ts\nconst x = 1;\n```\n\n");
    expect(trimmedCode?.block.type).toBe("code");
    expect(trimmedCode?.text).toBe("const x = 1;");
    expect(paragraph?.block.type).toBe("paragraph");
    expect(paragraph?.text).toBe("");
    expect(state.selection.focus.path).toBe(paragraph?.path);
    expect(state.selection.focus.offset).toBe(0);
  });

  test("does not exit a code block from consecutive blank lines before the end", () => {
    let state = setup("```\nalpha\n\nbeta\n```\n");
    const code = indexedTextEntries(state)[0];

    if (!code) {
      throw new Error("Expected code path");
    }

    state = placeAt(state, code, "alpha\n\n".length);
    state = insertLineBreak(state)!;

    expect(toMarkdown(state)).toBe("```\nalpha\n\n\nbeta\n```\n");
    expect(indexedTextEntries(state)).toHaveLength(1);
  });
});

describe("Code block deletion", () => {
  test("backspace at the start of an empty code block demotes it to an empty paragraph", () => {
    let state = setup("```\n\n```\n");
    const code = indexedTextEntries(state)[0];

    if (!code) {
      throw new Error("Expected code path");
    }

    state = placeAt(state, code, 0);
    state = deleteBackward(state) ?? state;

    const paragraph = indexedTextEntries(state)[0];

    expect(toMarkdown(state)).toBe("\n");
    expect(paragraph?.block.type).toBe("paragraph");
    expect(paragraph?.text).toBe("");
    expect(state.selection.focus.path).toBe(paragraph?.path);
    expect(state.selection.focus.offset).toBe(0);
  });

  test.each([
    ["backspace at the start of", "a\n\n```\nb\n```\n", "b", "start", deleteBackward],
    ["forward delete before", "a\n\n```\nb\n```\n", "a", "end", deleteForward],
    ["backspace after", "```\nb\n```\n\nc\n", "c", "start", deleteBackward],
    ["forward delete at the end of", "```\nb\n```\n\nc\n", "b", "end", deleteForward],
  ] as const)("%s a non-empty code block leaves source intact", (_, source, text, at, command) => {
    const state = setup(source);
    const result = command(placeAt(state, getPath(state, text), at));

    expect(toMarkdown(result ?? state)).toBe(source);
  });
});
