import { describe, expect, test } from "bun:test";
import { moveWordOffset, resolveWordRangeAtOffset } from "@/editor/text/words";

describe("Word ranges", () => {
  test("resolves Latin words around interior and edge offsets", () => {
    expect(resolveWordRangeAtOffset("hello, world", 1)).toEqual({ start: 0, end: 5 });
    expect(resolveWordRangeAtOffset("hello, world", 5)).toEqual({ start: 0, end: 5 });
    expect(resolveWordRangeAtOffset("hello, world", 7)).toEqual({ start: 7, end: 12 });
  });

  test("returns null for punctuation and whitespace between words", () => {
    expect(resolveWordRangeAtOffset("hello, world", 6)).toBeNull();
  });

  test("uses locale-aware segmentation for non-ASCII words", () => {
    expect(resolveWordRangeAtOffset("naïve café", 8)).toEqual({ start: 6, end: 10 });
    expect(resolveWordRangeAtOffset("hello 世界", 7)).toEqual({ start: 6, end: 8 });
  });
});

describe("Word movement", () => {
  test("moves to word and punctuation token edges", () => {
    expect(moveWordOffset("hello, world", 9, -1)).toBe(7);
    expect(moveWordOffset("hello, world", 9, 1)).toBe(12);
    expect(moveWordOffset("hello, world", 7, -1)).toBe(5);
    expect(moveWordOffset("hello, world", 5, 1)).toBe(6);
    expect(moveWordOffset("alpha beta gamma", 2, 1)).toBe(5);
    expect(moveWordOffset("alpha beta gamma", 6, 1)).toBe(10);
  });

  test("moves forward to token starts", () => {
    expect(moveWordOffset("alpha beta gamma", 0, 1, "tokenStarts")).toBe(6);
    expect(moveWordOffset("alpha beta gamma", 2, 1, "tokenStarts")).toBe(6);
    expect(moveWordOffset("alpha beta gamma", 6, 1, "tokenStarts")).toBe(11);
    expect(moveWordOffset("  alpha", 0, 1, "tokenStarts")).toBe(2);
  });

  test.each([
    ["abc ...", 4],
    ["abc $$$", 4],
    ["abc .more", 4],
    ["abc.more", 4],
    ["abc...more", 6],
  ])("preserves the token-start punctuation boundary in %s", (text, expectedOffset) => {
    expect(moveWordOffset(text, 3, 1, "tokenStarts")).toBe(expectedOffset);
  });

  test("moves backward through punctuation runs in both styles", () => {
    expect(moveWordOffset("abc ...", 7, -1, "tokenStarts")).toBe(4);
    expect(moveWordOffset("abc ...", 4, -1, "tokenStarts")).toBe(0);
    expect(moveWordOffset("abc...more", 6, -1, "wordEdges")).toBe(3);
    expect(moveWordOffset("abc...more", 3, -1, "wordEdges")).toBe(0);
  });

  test("treats inline object replacement characters as atomic tokens", () => {
    const text = `before \uFFFC after`;
    const objectStart = text.indexOf("\uFFFC");

    expect(moveWordOffset(text, objectStart, 1)).toBe(objectStart + 1);
    expect(moveWordOffset(text, objectStart + 1, -1)).toBe(objectStart);
  });

  test("returns path edges before reporting that no local target remains", () => {
    expect(moveWordOffset("...alpha...", 2, -1)).toBe(0);
    expect(moveWordOffset("alpha...", 5, 1)).toBe(8);
    expect(moveWordOffset("alpha", 0, -1)).toBeNull();
    expect(moveWordOffset("alpha", 5, 1)).toBeNull();
    expect(moveWordOffset("alpha", 0, 1, "tokenStarts")).toBeNull();
    expect(moveWordOffset("", 0, -1)).toBeNull();
    expect(moveWordOffset("", 0, 1)).toBeNull();
  });

  test("clamps offsets to the UTF-16 text range", () => {
    expect(moveWordOffset("alpha beta", -10, 1)).toBe(5);
    expect(moveWordOffset("alpha beta", 99, -1)).toBe(6);
  });
});
