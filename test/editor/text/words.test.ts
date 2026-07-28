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
  test("moves to word ends and punctuation runs", () => {
    expect(moveWordOffset("hello, world", 9, "previousWord")).toBe(7);
    expect(moveWordOffset("hello, world", 9, "wordEnd")).toBe(12);
    expect(moveWordOffset("hello, world", 7, "previousWord")).toBe(5);
    expect(moveWordOffset("hello, world", 5, "wordEnd")).toBe(6);
    expect(moveWordOffset("alpha beta gamma", 2, "wordEnd")).toBe(5);
    expect(moveWordOffset("alpha beta gamma", 6, "wordEnd")).toBe(10);
  });

  test("moves to the next word", () => {
    expect(moveWordOffset("alpha beta gamma", 0, "nextWord")).toBe(6);
    expect(moveWordOffset("alpha beta gamma", 2, "nextWord")).toBe(6);
    expect(moveWordOffset("alpha beta gamma", 6, "nextWord")).toBe(11);
    expect(moveWordOffset("  alpha", 0, "nextWord")).toBe(2);
  });

  test.each([
    ["abc ...", 4],
    ["abc $$$", 4],
    ["abc .more", 4],
    ["abc...more", 6],
  ])("treats standalone punctuation as a word stop in %s", (text, expectedOffset) => {
    expect(moveWordOffset(text, 3, "nextWord")).toBe(expectedOffset);
  });

  test("groups contiguous standalone punctuation", () => {
    expect(moveWordOffset("abc...more", 0, "wordEnd")).toBe(3);
    expect(moveWordOffset("abc...more", 3, "wordEnd")).toBe(6);
    expect(moveWordOffset("abc...more", 6, "wordEnd")).toBe(10);
  });

  test("preserves locale-aware word-like spans", () => {
    expect(moveWordOffset("don't stop", 0, "wordEnd")).toBe(5);
    expect(moveWordOffset("don’t stop", 0, "wordEnd")).toBe(5);
    expect(moveWordOffset("100.00 dollars", 0, "wordEnd")).toBe(6);
    expect(moveWordOffset("example.com next", 0, "wordEnd")).toBe(11);
    expect(moveWordOffset("example.com next", 0, "nextWord")).toBe(12);
  });

  test("moves backward through punctuation runs", () => {
    expect(moveWordOffset("abc ...", 7, "previousWord")).toBe(4);
    expect(moveWordOffset("abc ...", 4, "previousWord")).toBe(0);
    expect(moveWordOffset("abc...more", 6, "previousWord")).toBe(3);
    expect(moveWordOffset("abc...more", 3, "previousWord")).toBe(0);
  });

  test("treats inline object replacement characters as atomic units", () => {
    const spacedText = `before \uFFFC after`;
    const objectStart = spacedText.indexOf("\uFFFC");

    expect(moveWordOffset(spacedText, objectStart, "wordEnd")).toBe(objectStart + 1);
    expect(moveWordOffset(spacedText, objectStart + 1, "previousWord")).toBe(objectStart);
    expect(moveWordOffset(`!\uFFFC?`, 0, "wordEnd")).toBe(1);
    expect(moveWordOffset(`!\uFFFC?`, 1, "wordEnd")).toBe(2);
    expect(moveWordOffset(`!\uFFFC?`, 2, "wordEnd")).toBe(3);
  });

  test("returns path edges before reporting that no local target remains", () => {
    expect(moveWordOffset("...alpha...", 2, "previousWord")).toBe(0);
    expect(moveWordOffset("alpha...", 5, "wordEnd")).toBe(8);
    expect(moveWordOffset("alpha", 0, "previousWord")).toBeNull();
    expect(moveWordOffset("alpha", 5, "wordEnd")).toBeNull();
    expect(moveWordOffset("alpha", 0, "nextWord")).toBeNull();
    expect(moveWordOffset("", 0, "previousWord")).toBeNull();
    expect(moveWordOffset("", 0, "wordEnd")).toBeNull();
  });

  test("clamps offsets to the UTF-16 text range", () => {
    expect(moveWordOffset("alpha beta", -10, "wordEnd")).toBe(5);
    expect(moveWordOffset("alpha beta", 99, "previousWord")).toBe(6);
  });
});
