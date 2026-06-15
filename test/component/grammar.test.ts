import { describe, expect, test } from "bun:test";
import { createBlockquoteBlock, createCodeBlock } from "@/document";
import type { CodeGrammarRule } from "@/types";
import {
  builtinGrammars,
  normalizeLanguage,
  resolveCodeGrammars,
} from "@/component/decorations/grammars";
import {
  compileCodeGrammars,
  resolveCodeDecorationRanges,
} from "@/component/decorations/worker/code";
import type { DocumintDecoration } from "@/types";

// Compile the built-in grammars with token-as-color, so each resolved range's
// `color` is exactly the token kind it matched — making assertions self-documenting.
function compileBuiltins(): Record<string, DocumintDecoration[]> {
  return compileCodeGrammars(resolveCodeGrammars(builtinGrammars, (token) => token));
}

describe("normalizeLanguage", () => {
  test("lowercases and maps common aliases onto canonical grammar keys", () => {
    expect(normalizeLanguage("TS")).toBe("typescript");
    expect(normalizeLanguage("js")).toBe("javascript");
    expect(normalizeLanguage("Markdown")).toBe("markdown");
    expect(normalizeLanguage("rust")).toBe("rust");
    expect(normalizeLanguage(null)).toBeNull();
    expect(normalizeLanguage("   ")).toBeNull();
  });
});

describe("resolveCodeDecorationRanges", () => {
  const grammars = compileBuiltins();

  test("tokenizes a JavaScript block at its source-region path", () => {
    const block = createCodeBlock({ language: "js", source: "const x = 1" });

    expect(resolveCodeDecorationRanges(block, 0, grammars)).toEqual([
      { color: "keyword", endOffset: 5, path: "root.0.source", startOffset: 0 },
      { color: "number", endOffset: 11, path: "root.0.source", startOffset: 10 },
    ]);
  });

  test("resolves the typescript alias to the shared javascript grammar", () => {
    const block = createCodeBlock({ language: "typescript", source: "type A = B" });

    expect(resolveCodeDecorationRanges(block, 0, grammars)).toEqual([
      { color: "keyword", endOffset: 4, path: "root.0.source", startOffset: 0 },
      { color: "type", endOffset: 6, path: "root.0.source", startOffset: 5 },
      { color: "type", endOffset: 10, path: "root.0.source", startOffset: 9 },
    ]);
  });

  test("tokenizes JavaScript singleton literals as atoms", () => {
    const block = createCodeBlock({ language: "js", source: "const x = null" });

    expect(resolveCodeDecorationRanges(block, 0, grammars)).toEqual([
      { color: "keyword", endOffset: 5, path: "root.0.source", startOffset: 0 },
      { color: "atom", endOffset: 14, path: "root.0.source", startOffset: 10 },
    ]);
  });

  test("tokenizes a Markdown block with the built-in markdown grammar", () => {
    const block = createCodeBlock({
      language: "markdown",
      source: "# Title\n\n---\n\n- item `x`",
    });

    expect(resolveCodeDecorationRanges(block, 0, grammars)).toEqual([
      { color: "heading", endOffset: 7, path: "root.0.source", startOffset: 0 },
      { color: "punctuation", endOffset: 12, path: "root.0.source", startOffset: 9 },
      { color: "punctuation", endOffset: 16, path: "root.0.source", startOffset: 14 },
      { color: "string", endOffset: 24, path: "root.0.source", startOffset: 21 },
    ]);
  });

  test("earlier rules win per character, so a keyword inside a comment stays comment", () => {
    const block = createCodeBlock({ language: "js", source: "// const" });

    expect(resolveCodeDecorationRanges(block, 0, grammars)).toEqual([
      { color: "comment", endOffset: 8, path: "root.0.source", startOffset: 0 },
    ]);
  });

  test("addresses code nested in a container by its real source path", () => {
    const block = createBlockquoteBlock([createCodeBlock({ language: "js", source: "return 1" })]);

    expect(resolveCodeDecorationRanges(block, 0, grammars)).toEqual([
      { color: "keyword", endOffset: 6, path: "root.0.children.0.source", startOffset: 0 },
      { color: "number", endOffset: 8, path: "root.0.children.0.source", startOffset: 7 },
    ]);
  });

  test("returns no ranges for unknown or missing languages", () => {
    const unknown = createCodeBlock({ language: "brainfuck", source: "const x" });
    const untagged = createCodeBlock({ source: "const x" });

    expect(resolveCodeDecorationRanges(unknown, 0, grammars)).toEqual([]);
    expect(resolveCodeDecorationRanges(untagged, 0, grammars)).toEqual([]);
  });

  test("skips pathologically large code blocks, rendering them plain", () => {
    const huge = createCodeBlock({ language: "js", source: "const value = 1;\n".repeat(8000) });

    expect(resolveCodeDecorationRanges(huge, 0, grammars)).toEqual([]);
  });

  test("does not mutate the code block", () => {
    const block = createCodeBlock({ language: "js", source: "const x = 1" });
    const before = structuredClone(block);

    resolveCodeDecorationRanges(block, 0, grammars);

    expect(block).toEqual(before);
  });
});

describe("resolveCodeGrammars", () => {
  const tokenAsColor = (token: string) => token;
  const custom: readonly CodeGrammarRule[] = [{ pattern: /x/, token: "keyword" }];

  test("normalizes alias keys onto the canonical languages the worker looks up", () => {
    const resolved = resolveCodeGrammars({ tsx: custom, js: custom }, tokenAsColor);

    expect(Object.keys(resolved).sort()).toEqual(["javascript", "typescript"]);
  });

  test("host grammars (merged after built-ins) win on an alias collision", () => {
    const resolved = resolveCodeGrammars({ ...builtinGrammars, ts: custom }, tokenAsColor);

    expect(resolved.typescript).toEqual([{ color: "keyword", pattern: /x/ }]);
  });

  test("resolves each token through the provided palette", () => {
    const resolved = resolveCodeGrammars(
      { javascript: [{ pattern: /x/, token: "keyword" }] },
      (token) => (token === "keyword" ? "#abc" : "#000"),
    );

    expect(resolved.javascript).toEqual([{ color: "#abc", pattern: /x/ }]);
  });

  test("drops grammars whose rules resolve to nothing", () => {
    expect(resolveCodeGrammars({ javascript: [] }, tokenAsColor)).toEqual({});
  });
});
