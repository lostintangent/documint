import { expect, test } from "bun:test";
import { resolveWordBoundaryOffset, resolveWordRangeAtOffset } from "@/editor/text/words";

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

test("resolves directional word boundaries through separators", () => {
  expect(resolveWordBoundaryOffset("hello, world", 9, -1)).toBe(7);
  expect(resolveWordBoundaryOffset("hello, world", 9, 1)).toBe(12);
  expect(resolveWordBoundaryOffset("hello, world", 7, -1)).toBe(0);
  expect(resolveWordBoundaryOffset("hello, world", 5, 1)).toBe(12);
});

test("treats inline object replacement characters as atomic movement units", () => {
  const text = `before \uFFFC after`;
  const objectStart = text.indexOf("\uFFFC");

  expect(resolveWordBoundaryOffset(text, objectStart, 1)).toBe(objectStart + 1);
  expect(resolveWordBoundaryOffset(text, objectStart + 1, -1)).toBe(objectStart);
});

test("clamps directional word boundaries to text edges", () => {
  expect(resolveWordBoundaryOffset("alpha", 0, -1)).toBe(0);
  expect(resolveWordBoundaryOffset("alpha", 5, 1)).toBe(5);
  expect(resolveWordBoundaryOffset("", 0, -1)).toBe(0);
  expect(resolveWordBoundaryOffset("", 0, 1)).toBe(0);
});
