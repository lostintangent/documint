import { describe, expect, test } from "bun:test";
import {
  detectCompletionContext,
  filterCompletionItems,
  resolveCompletionInsertion,
  type CompletionSource,
} from "@/component/completions/completions";
import {
  createMentionCompletionSource,
  emojiCompletionSource,
} from "@/component/completions/sources";

const userSource: CompletionSource = {
  trigger: "@",
  items: [
    { label: "Jane", id: "u-jane" },
    { label: "Jane Doe", id: "u-jane-doe" },
    { label: "John", id: "u-john" },
  ],
};

describe("detectCompletionContext", () => {
  test("detects a trigger at the start of the value", () => {
    expect(detectCompletionContext("@Ja", 3, [userSource])).toEqual({
      trigger: "@",
      query: "Ja",
      triggerStart: 0,
      caret: 3,
      matches: [
        { label: "Jane", id: "u-jane" },
        { label: "Jane Doe", id: "u-jane-doe" },
      ],
    });
  });

  test("detects a trigger after whitespace", () => {
    expect(detectCompletionContext("hi @Jo", 6, [userSource])).toEqual({
      trigger: "@",
      query: "Jo",
      triggerStart: 3,
      caret: 6,
      matches: [{ label: "John", id: "u-john" }],
    });
  });

  test("stops a completion context at whitespace after the trigger", () => {
    expect(detectCompletionContext("@Jane ", 6, [userSource])).toBeNull();
  });

  test("ignores a trigger embedded inside a word", () => {
    expect(detectCompletionContext("email@Ja", 8, [userSource])).toBeNull();
  });

  test("ignores a trigger immediately after punctuation", () => {
    expect(detectCompletionContext("(@Ja", 4, [userSource])).toBeNull();
  });

  test("returns an active context with empty matches when the query has no results", () => {
    expect(detectCompletionContext("@Unknown", 8, [userSource])).toEqual({
      trigger: "@",
      query: "Unknown",
      triggerStart: 0,
      caret: 8,
      matches: [],
    });
  });
});

describe("filterCompletionItems", () => {
  test("returns all items for an empty query", () => {
    expect(filterCompletionItems(userSource.items, "")).toEqual(userSource.items);
  });

  test("caps returned matches for large sources", () => {
    const items = Array.from({ length: 75 }, (_, index) => ({ label: `item_${index}` }));

    expect(filterCompletionItems(items, "")).toHaveLength(50);
    expect(filterCompletionItems(items, "item")).toHaveLength(50);
  });

  test("filters items by case-insensitive substring", () => {
    expect(filterCompletionItems([{ label: "smile", icon: "😄", insertText: "😄" }], "😄")).toEqual(
      [],
    );

    expect(filterCompletionItems(userSource.items, "DOE")).toEqual([
      { label: "Jane Doe", id: "u-jane-doe" },
    ]);
  });
});

describe("resolveCompletionInsertion", () => {
  test("replaces the trigger query with the trigger, selected label, and trailing space", () => {
    const completion = detectCompletionContext("Hi @Ja!", 6, [userSource]);

    if (!completion) {
      throw new Error("Expected an active completion");
    }

    expect(resolveCompletionInsertion("Hi @Ja!", completion, userSource.items[0]!)).toEqual({
      caret: 9,
      value: "Hi @Jane !",
    });
  });

  test("uses exact item insertion text when provided", () => {
    const emojiSource: CompletionSource = {
      trigger: ":",
      items: [{ label: "smile", insertText: "😄" }],
    };
    const completion = detectCompletionContext("Hi :sm", 6, [emojiSource]);

    if (!completion) {
      throw new Error("Expected an active completion");
    }

    expect(resolveCompletionInsertion("Hi :sm", completion, emojiSource.items[0]!)).toEqual({
      caret: 5,
      value: "Hi 😄",
    });
  });
});

describe("completion sources", () => {
  test("labels mention items by full name or username and sorts them by label", () => {
    expect(
      createMentionCompletionSource([
        { id: "u-zoe", username: "zoe" },
        { id: "u-amy", username: "amy", fullName: "Amy Adams" },
      ]),
    ).toEqual({
      trigger: "@",
      items: [
        { label: "Amy Adams", id: "u-amy" },
        { label: "zoe", id: "u-zoe" },
      ],
    });
  });

  test("omits the mention source without users", () => {
    expect(createMentionCompletionSource(undefined)).toBeNull();
    expect(createMentionCompletionSource([])).toBeNull();
  });

  test("offers emoji through the colon trigger", () => {
    expect(emojiCompletionSource.trigger).toBe(":");
    expect(emojiCompletionSource.items).toContainEqual({
      label: "sparkles",
      icon: "✨",
      insertText: "✨",
    });
  });
});
