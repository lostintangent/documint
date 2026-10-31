import { describe, expect, test } from "bun:test";
import {
  createImage,
  createHeadingTextBlock,
  createLink,
  createMention,
  createParagraphBlock,
  createParagraphTextBlock,
  createResource,
  createTableBlock,
  createTableCell,
  createTableRow,
  createText,
} from "@/document";
import { resolveDecorationsKey } from "@/component/decorations/client/config";
import { compileDecorations } from "@/component/decorations/worker/matching";
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
      [{ color: "tomato", endOffset: 11, path: "root.0", startOffset: 6 }],
    );
    expect(block).toEqual(before);
  });

  test("decorates the first captured group when a rule includes captures", () => {
    const block = createParagraphTextBlock("Task (123) and (456)");

    expect(
      resolveBlockDecorationRanges(block, 0, [{ color: "gray", pattern: /\((\d+)\)/ }]),
    ).toEqual([
      { color: "gray", endOffset: 9, path: "root.0", startOffset: 6 },
      { color: "gray", endOffset: 19, path: "root.0", startOffset: 16 },
    ]);
  });

  test("uses the real captured group offset when captured text repeats in the full match", () => {
    const block = createParagraphTextBlock("aa");

    expect(resolveBlockDecorationRanges(block, 0, [{ color: "gray", pattern: /a(a)/ }])).toEqual([
      { color: "gray", endOffset: 2, path: "root.0", startOffset: 1 },
    ]);
  });

  test("skips capture rules when no capture participates", () => {
    const block = createParagraphTextBlock("Task () and (123)");

    expect(
      resolveBlockDecorationRanges(block, 0, [{ color: "gray", pattern: /\((\d+)?\)/ }]),
    ).toEqual([{ color: "gray", endOffset: 16, path: "root.0", startOffset: 13 }]);
  });

  test("earlier overlapping rules win and later rules only fill unclaimed ranges", () => {
    const block = createParagraphTextBlock("abcde");

    expect(
      resolveBlockDecorationRanges(block, 0, [
        { color: "red", pattern: /abc/ },
        { color: "blue", pattern: /bcd/ },
      ]),
    ).toEqual([
      { color: "red", endOffset: 3, path: "root.0", startOffset: 0 },
      { color: "blue", endOffset: 4, path: "root.0", startOffset: 3 },
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
        path: "root.0",
        startOffset: 0,
      },
      {
        backgroundColor: "yellow",
        endOffset: 9,
        path: "root.0",
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
        path: "root.0",
        startOffset: 0,
      },
      {
        backgroundColor: "gold",
        pulse: true,
        color: "black",
        endOffset: 12,
        path: "root.0",
        startOffset: 8,
      },
    ]);
  });

  test.each([
    [
      "styled text",
      [createText("al", ["bold"]), createText("pha", ["italic"]), createText(" target")],
      [/alpha/, /al/],
      [6, 12],
    ],
    [
      "inline code boundaries",
      [createText("foo"), createText("bar", ["code"]), createText("baz target")],
      [/foobaz/],
      [10, 16],
    ],
    [
      "link text",
      [
        createText("before "),
        createLink({ children: [createText("pha")], url: "https://example.com" }),
        createText(" target"),
      ],
      [/pha/],
      [11, 17],
    ],
    [
      "reference inlines",
      [
        createText("before "),
        createImage({ alt: "preview", url: "https://example.com/image.png" }),
        createMention({ name: "Jane Doe", userId: "user-123" }),
        createResource({
          label: "Recording",
          protocol: "demo-resource:",
          url: "demo-resource://recording/live",
        }),
        createText(" target"),
      ],
      [/Jane/, /preview|Recording/],
      [11, 17],
    ],
    [
      "links containing references",
      [
        createText("before "),
        createLink({
          children: [createText("go"), createMention({ name: "Jane Doe", userId: "user-123" })],
          url: "https://example.com",
        }),
        createText(" target"),
      ],
      [/go|Jane/],
      [11, 17],
    ],
  ] as const)(
    "skips %s and preserves later offsets",
    (_label, children, skippedPatterns, [startOffset, endOffset]) => {
      const block = createParagraphBlock([...children]);

      for (const pattern of skippedPatterns) {
        expect(resolveBlockDecorationRanges(block, 0, [{ color: "red", pattern }])).toEqual([]);
      }
      expect(resolveBlockDecorationRanges(block, 0, [{ color: "red", pattern: /target/ }])).toEqual(
        [{ color: "red", endOffset, path: "root.0", startOffset }],
      );
    },
  );

  test("includes headings and table cells", () => {
    const heading = createHeadingTextBlock({ depth: 2, text: "Heading target" });
    const table = createTableBlock({
      align: [null],
      rows: [createTableRow([createTableCell([createText("Cell target")])])],
    });

    expect(
      resolveBlockDecorationRanges(heading, 0, [{ color: "purple", pattern: /target/ }]),
    ).toEqual([{ color: "purple", endOffset: 14, path: "root.0", startOffset: 8 }]);
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

describe("decoration config", () => {
  test("ignores rules without styles when keying and compiling", () => {
    const styled = { backgroundColor: "yellow", pattern: /TODO/ };
    const rules = [{ pattern: /TODO/ }, styled];

    expect(resolveDecorationsKey(rules)).toBe(resolveDecorationsKey([styled]));
    expect(compileDecorations(rules)).toEqual([{ backgroundColor: "yellow", pattern: /TODO/dg }]);
  });

  test("preserves animated background decoration styles", () => {
    const rules = [{ backgroundColor: "gold", pulse: true, pattern: /sparkle/ }];

    expect(resolveDecorationsKey(rules)).not.toBe(
      resolveDecorationsKey([{ backgroundColor: "gold", pattern: /sparkle/ }]),
    );
    expect(compileDecorations(rules)).toEqual([
      { backgroundColor: "gold", pulse: true, pattern: /sparkle/dg },
    ]);
  });

  test("compiles global match-index patterns and drops sticky matching", () => {
    expect(compileDecorations([{ color: "red", pattern: /todo/iy }])[0]!.pattern.flags).toBe("dgi");
    expect(compileDecorations([{ color: "red", pattern: /todo/dgm }])[0]!.pattern.flags).toBe(
      "dgm",
    );
  });
});
