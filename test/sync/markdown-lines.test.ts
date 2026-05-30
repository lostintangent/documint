import { describe, expect, test } from "bun:test";
import { resolveMarkdownLineReplacement } from "@/sync/markdown-lines";

describe("resolveMarkdownLineReplacement", () => {
  describe("insertions", () => {
    test("inserts at the start", () => {
      expectReplacement({
        next: "zero\none\ntwo",
        previous: "one\ntwo",
        expected: {
          endLine: 0,
          nextText: "zero",
          startLine: 0,
        },
      });
    });

    test("inserts at the end", () => {
      expectReplacement({
        next: "one\ntwo\nthree",
        previous: "one\ntwo",
        expected: {
          endLine: 2,
          nextText: "three",
          startLine: 2,
        },
      });
    });
  });

  describe("replacements", () => {
    test("replaces a middle line", () => {
      expectReplacement({
        next: "one\nchanged\nthree",
        previous: "one\ntwo\nthree",
        expected: {
          endLine: 2,
          nextText: "changed",
          startLine: 1,
        },
      });
    });

    test("replaces multiple lines", () => {
      expectReplacement({
        next: "one\nchanged a\nchanged b\nfour",
        previous: "one\ntwo\nthree\nfour",
        expected: {
          endLine: 3,
          nextText: "changed a\nchanged b",
          startLine: 1,
        },
      });
    });
  });

  describe("deletions", () => {
    test("deletes a final line", () => {
      expectReplacement({
        next: "one\ntwo",
        previous: "one\ntwo\nthree",
        expected: {
          endLine: 3,
          nextText: "",
          startLine: 2,
        },
      });
    });

    test("returns null when markdown is unchanged", () => {
      expect(resolveMarkdownLineReplacement("one\ntwo", "one\ntwo")).toBeNull();
    });
  });
});

function expectReplacement({
  expected,
  next,
  previous,
}: {
  expected: NonNullable<ReturnType<typeof resolveMarkdownLineReplacement>>;
  next: string;
  previous: string;
}) {
  const replacement = resolveMarkdownLineReplacement(previous, next);

  expect(replacement).toEqual(expected);
  expect(applyReplacement(previous, replacement!)).toBe(next);
}

function applyReplacement(
  previous: string,
  replacement: NonNullable<ReturnType<typeof resolveMarkdownLineReplacement>>,
) {
  const lines = previous.split("\n");

  lines.splice(
    replacement.startLine,
    replacement.endLine - replacement.startLine,
    ...(replacement.nextText.length > 0 ? replacement.nextText.split("\n") : []),
  );

  return lines.join("\n");
}
