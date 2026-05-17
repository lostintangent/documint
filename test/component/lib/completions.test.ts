import { describe, expect, test } from "bun:test";
import {
  detectCompletionContext,
  filterCompletionItems,
  resolveCompletionInsertion,
  sortCompletionSources,
  tokenizeTriggers,
  type CompletionSource,
  type TriggerSegment,
} from "@/component/completions/completions";

type TokenizeTriggersRow = {
  name: string;
  input: string;
  sources: CompletionSource[] | undefined;
  expected: TriggerSegment[];
};

const userSource: CompletionSource = {
  trigger: "@",
  items: [
    { label: "Jane", id: "u-jane" },
    { label: "Jane Doe", id: "u-jane-doe" },
    { label: "John", id: "u-john" },
  ],
};

describe("sortCompletionSources", () => {
  test("returns an empty list when no sources are provided", () => {
    expect(sortCompletionSources(undefined)).toEqual([]);
  });

  test("sorts each source's items without mutating the original source", () => {
    const source: CompletionSource = {
      trigger: "@",
      items: [{ label: "Zoe" }, { label: "amy" }, { label: "Bob" }],
    };

    expect(sortCompletionSources([source])).toEqual([
      {
        trigger: "@",
        items: [{ label: "amy" }, { label: "Bob" }, { label: "Zoe" }],
      },
    ]);
    expect(source.items).toEqual([{ label: "Zoe" }, { label: "amy" }, { label: "Bob" }]);
  });
});

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

const emojiSource: CompletionSource = {
  trigger: ":",
  items: [
    { label: "smile", id: "emoji-smile" },
    { label: "wave", id: "emoji-wave" },
  ],
};

describe("tokenizeTriggers", () => {
  const rows: TokenizeTriggersRow[] = [
    {
      name: "returns a single text segment when no triggers are present",
      input: "nothing to see here",
      sources: [userSource],
      expected: [{ kind: "text", text: "nothing to see here" }],
    },
    {
      name: "tokenizes a mention at the start of the body",
      input: "@Jane shipped it",
      sources: [userSource],
      expected: [
        { kind: "token", trigger: "@", label: "Jane", id: "u-jane" },
        { kind: "text", text: " shipped it" },
      ],
    },
    {
      name: "tokenizes a mention after whitespace",
      input: "hi @John!",
      sources: [userSource],
      expected: [
        { kind: "text", text: "hi " },
        { kind: "token", trigger: "@", label: "John", id: "u-john" },
        { kind: "text", text: "!" },
      ],
    },
    {
      name: "tokenizes mentions after newline and tab boundaries",
      input: "first\n@Jane\t@John",
      sources: [userSource],
      expected: [
        { kind: "text", text: "first\n" },
        { kind: "token", trigger: "@", label: "Jane", id: "u-jane" },
        { kind: "text", text: "\t" },
        { kind: "token", trigger: "@", label: "John", id: "u-john" },
      ],
    },
    {
      name: "prefers the longest matching label",
      input: "@Jane Doe wrote this",
      sources: [userSource],
      expected: [
        { kind: "token", trigger: "@", label: "Jane Doe", id: "u-jane-doe" },
        { kind: "text", text: " wrote this" },
      ],
    },
    {
      name: "does not match a trigger embedded inside a word",
      input: "email@Jane.com",
      sources: [userSource],
      expected: [{ kind: "text", text: "email@Jane.com" }],
    },
    {
      name: "does not partially match a longer word after a trigger",
      input: "@JaneDoe and :smilewide",
      sources: [userSource, emojiSource],
      expected: [{ kind: "text", text: "@JaneDoe and :smilewide" }],
    },
    {
      name: "does not match a trigger immediately after punctuation",
      input: "(@Jane) and /@John",
      sources: [userSource],
      expected: [{ kind: "text", text: "(@Jane) and /@John" }],
    },
    {
      name: "ignores triggers that don't match any source item",
      input: "@Unknown person",
      sources: [userSource],
      expected: [{ kind: "text", text: "@Unknown person" }],
    },
    {
      name: "tokenizes multiple trigger sources independently",
      input: "Ping @Jane then :smile",
      sources: [userSource, emojiSource],
      expected: [
        { kind: "text", text: "Ping " },
        { kind: "token", trigger: "@", label: "Jane", id: "u-jane" },
        { kind: "text", text: " then " },
        { kind: "token", trigger: ":", label: "smile", id: "emoji-smile" },
      ],
    },
    {
      name: "returns a single text segment when no sources are provided",
      input: "@Jane",
      sources: undefined,
      expected: [{ kind: "text", text: "@Jane" }],
    },
  ];

  test.each(rows)("$name", ({ input, sources, expected }) => {
    expect(tokenizeTriggers(input, sources)).toEqual(expected);
  });
});
