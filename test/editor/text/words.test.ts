import { expect, test } from "bun:test";
import { resolveWordRangeAtOffset } from "@/editor/text/words";

test("resolves latin word ranges around interior and edge offsets", () => {
  expect(resolveWordRangeAtOffset("hello, world", 1)).toEqual({ start: 0, end: 5 });
  expect(resolveWordRangeAtOffset("hello, world", 5)).toEqual({ start: 0, end: 5 });
  expect(resolveWordRangeAtOffset("hello, world", 7)).toEqual({ start: 7, end: 12 });
});

test("returns null for punctuation and whitespace between words", () => {
  expect(resolveWordRangeAtOffset("hello, world", 6)).toBeNull();
});

test("uses locale-aware word segmentation for non-ascii words", () => {
  expect(resolveWordRangeAtOffset("naïve café", 8)).toEqual({ start: 6, end: 10 });
  expect(resolveWordRangeAtOffset("hello 世界", 7)).toEqual({ start: 6, end: 8 });
});
