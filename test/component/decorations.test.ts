import { describe, expect, test } from "bun:test";
import {
  createHeadingTextBlock,
  createLink,
  createParagraphBlock,
  createParagraphTextBlock,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
} from "@/document";
import { resolveDecorationsKey, serializeDecorations } from "@/component/decorations/client/config";
import { resolveBlockDecorationRanges } from "@/component/decorations/worker/prose";

describe("resolveBlockDecorationRanges", () => {
  test("returns no ranges when there are no rules", () => {
    const block = createParagraphTextBlock("hello");

    expect(resolveBlockDecorationRanges(block, 0, [])).toEqual([]);
  });

  test("resolves matching ranges without mutating the block", () => {
    const block = createParagraphTextBlock("hello world");
    const before = structuredClone(block);

    expect(resolveBlockDecorationRanges(block, 0, [{ color: "tomato", pattern: /world/ }])).toEqual(
      [{ color: "tomato", endOffset: 11, path: "root.0.children", startOffset: 6 }],
    );
    expect(block).toEqual(before);
  });

  test("decorates the first captured group when a rule includes captures", () => {
    const block = createParagraphTextBlock("Task (123) and (456)");

    expect(
      resolveBlockDecorationRanges(block, 0, [{ color: "gray", pattern: /\((\d+)\)/ }]),
    ).toEqual([
      { color: "gray", endOffset: 9, path: "root.0.children", startOffset: 6 },
      { color: "gray", endOffset: 19, path: "root.0.children", startOffset: 16 },
    ]);
  });

  test("uses the real captured group offset when captured text repeats in the full match", () => {
    const block = createParagraphTextBlock("aa");

    expect(resolveBlockDecorationRanges(block, 0, [{ color: "gray", pattern: /a(a)/ }])).toEqual([
      { color: "gray", endOffset: 2, path: "root.0.children", startOffset: 1 },
    ]);
  });

  test("skips capture rules when no capture participates", () => {
    const block = createParagraphTextBlock("Task () and (123)");

    expect(
      resolveBlockDecorationRanges(block, 0, [{ color: "gray", pattern: /\((\d+)?\)/ }]),
    ).toEqual([{ color: "gray", endOffset: 16, path: "root.0.children", startOffset: 13 }]);
  });

  test("does not match styled text or across styled text boundaries", () => {
    const block = createParagraphBlock([createText("al", ["bold"]), createText("pha", ["italic"])]);

    expect(resolveBlockDecorationRanges(block, 0, [{ color: "#f00", pattern: /alpha/ }])).toEqual(
      [],
    );
    expect(resolveBlockDecorationRanges(block, 0, [{ color: "#f00", pattern: /al/ }])).toEqual([]);
  });

  test("earlier overlapping rules win and later rules only fill unclaimed ranges", () => {
    const block = createParagraphTextBlock("abcde");

    expect(
      resolveBlockDecorationRanges(block, 0, [
        { color: "red", pattern: /abc/ },
        { color: "blue", pattern: /bcd/ },
      ]),
    ).toEqual([
      { color: "red", endOffset: 3, path: "root.0.children", startOffset: 0 },
      { color: "blue", endOffset: 4, path: "root.0.children", startOffset: 3 },
    ]);
  });

  test("resolves text and background color styles independently", () => {
    const block = createParagraphTextBlock("todo item");

    expect(
      resolveBlockDecorationRanges(block, 0, [
        { backgroundColor: "yellow", pattern: /todo item/ },
        { color: "black", pattern: /todo/ },
      ]),
    ).toEqual([
      {
        backgroundColor: "yellow",
        color: "black",
        endOffset: 4,
        path: "root.0.children",
        startOffset: 0,
      },
      {
        backgroundColor: "yellow",
        endOffset: 9,
        path: "root.0.children",
        startOffset: 4,
      },
    ]);
  });

  test("keeps pulse behavior attached to the winning background style", () => {
    const block = createParagraphTextBlock("sparkle TODO");

    expect(
      resolveBlockDecorationRanges(block, 0, [
        { backgroundColor: "gold", pulse: true, pattern: /sparkle TODO/ },
        { backgroundColor: "yellow", pattern: /TODO/ },
        { color: "black", pattern: /TODO/ },
      ]),
    ).toEqual([
      {
        backgroundColor: "gold",
        pulse: true,
        endOffset: 8,
        path: "root.0.children",
        startOffset: 0,
      },
      {
        backgroundColor: "gold",
        pulse: true,
        color: "black",
        endOffset: 12,
        path: "root.0.children",
        startOffset: 8,
      },
    ]);
  });

  test("does not match across inline code boundaries and preserves later offsets", () => {
    const block = createParagraphBlock([
      createText("foo"),
      createText("bar", ["code"]),
      createText("baz target"),
    ]);

    expect(resolveBlockDecorationRanges(block, 0, [{ color: "red", pattern: /foobaz/ }])).toEqual(
      [],
    );
    expect(resolveBlockDecorationRanges(block, 0, [{ color: "red", pattern: /target/ }])).toEqual([
      { color: "red", endOffset: 16, path: "root.0.children", startOffset: 10 },
    ]);
  });

  test("skips link text and preserves later offsets", () => {
    const block = createParagraphBlock([
      createText("before "),
      createLink({ children: [createText("pha")], url: "https://example.com" }),
      createText(" target"),
    ]);

    expect(resolveBlockDecorationRanges(block, 0, [{ color: "red", pattern: /pha/ }])).toEqual([]);
    expect(resolveBlockDecorationRanges(block, 0, [{ color: "red", pattern: /target/ }])).toEqual([
      { color: "red", endOffset: 17, path: "root.0.children", startOffset: 11 },
    ]);
  });

  test("includes headings and table cells", () => {
    const heading = createHeadingTextBlock({ depth: 2, text: "Heading target" });
    const table = createTableBlock({
      align: [null],
      rows: [createTableRow([createTableCell([createText("Cell target")])])],
    });

    expect(
      resolveBlockDecorationRanges(heading, 0, [{ color: "purple", pattern: /target/ }]),
    ).toEqual([{ color: "purple", endOffset: 14, path: "root.0.children", startOffset: 8 }]);
    expect(
      resolveBlockDecorationRanges(table, 1, [{ color: "purple", pattern: /target/ }]),
    ).toEqual([
      {
        color: "purple",
        endOffset: 11,
        path: "root.1.rows.0.cells.0",
        startOffset: 5,
      },
    ]);
  });

  test("ignores zero-length matches", () => {
    const block = createParagraphTextBlock("hello");

    expect(resolveBlockDecorationRanges(block, 0, [{ color: "red", pattern: /\b/ }])).toEqual([]);
  });
});

describe("decoration serialization", () => {
  test("ignore rules without styles at scheduling and worker boundaries", () => {
    const rules = [{ pattern: /TODO/ }, { backgroundColor: "yellow", pattern: /TODO/ }];

    expect(resolveDecorationsKey(rules)).toBe("TODO:::yellow:0");
    expect(serializeDecorations(rules)).toEqual([
      { backgroundColor: "yellow", flags: "", source: "TODO" },
    ]);
  });

  test("preserves animated background decoration styles across the worker boundary", () => {
    const rules = [{ backgroundColor: "gold", pulse: true, pattern: /sparkle/ }];

    expect(resolveDecorationsKey(rules)).toBe("sparkle:::gold:1");
    expect(serializeDecorations(rules)).toEqual([
      { backgroundColor: "gold", pulse: true, flags: "", source: "sparkle" },
    ]);
  });
});
