import { describe, expect, test } from "bun:test";
import {
  equalDocumentCompletions,
  resolveDocumentCompletionApplication,
  resolveDocumentCompletionContext,
} from "@/component/completions/document-completions";
import type { CompletionSource } from "@/component/completions/completions";
import { getRegion, placeAt, selectIn, setup } from "@test/editor/helpers";

const mentionSource: CompletionSource = {
  trigger: "@",
  items: [
    { label: "Jane", id: "u-jane" },
    { label: "John", id: "u-john" },
  ],
};

const emojiSource: CompletionSource = {
  trigger: ":",
  items: [{ label: "smile" }, { label: "sparkles" }],
};

describe("resolveDocumentCompletionContext", () => {
  test("detects a completion context at the collapsed document caret", () => {
    const state = setup("Hello @Ja\n");
    const region = getRegion(state, "Hello @Ja");
    const active = resolveDocumentCompletionContext(placeAt(state, region, "end"), [mentionSource]);

    expect(active).toEqual({
      regionPath: region.path,
      trigger: "@",
      query: "Ja",
      triggerStart: 6,
      caret: 9,
      matches: [{ label: "Jane", id: "u-jane" }],
    });
  });

  test("returns null for expanded selections", () => {
    const state = setup("Hello @Ja\n");
    const region = getRegion(state, "Hello @Ja");

    expect(
      resolveDocumentCompletionContext(selectIn(state, region, 6, 9), [mentionSource]),
    ).toBeNull();
  });

  test("uses the focused region text rather than document-global offsets", () => {
    const state = setup("Before @No\n\nSecond :sp\n");
    const region = getRegion(state, "Second :sp");
    const active = resolveDocumentCompletionContext(placeAt(state, region, "end"), [
      mentionSource,
      emojiSource,
    ]);

    expect(active).toEqual({
      regionPath: region.path,
      trigger: ":",
      query: "sp",
      triggerStart: 7,
      caret: 10,
      matches: [{ label: "sparkles" }],
    });
  });

  test("returns null when no source matches the region-local trigger", () => {
    const state = setup("Hello :sp\n");
    const region = getRegion(state, "Hello :sp");

    expect(
      resolveDocumentCompletionContext(placeAt(state, region, "end"), [mentionSource]),
    ).toBeNull();
  });
});

describe("equalDocumentCompletions", () => {
  test("compares completion item insertion metadata", () => {
    const base = {
      regionPath: "region",
      trigger: ":",
      query: "sm",
      triggerStart: 0,
      caret: 3,
      matches: [{ label: "smile", icon: "😄", insertText: "😄" }],
    };

    expect(
      equalDocumentCompletions(base, {
        ...base,
        matches: [{ label: "smile", icon: "🙂", insertText: "🙂" }],
      }),
    ).toBe(false);
  });
});

describe("resolveDocumentCompletionApplication", () => {
  test("routes mention completion items to atomic mention replacement", () => {
    expect(
      resolveDocumentCompletionApplication(
        { kind: "mention", label: "Jane", id: "u-jane" },
        {
          regionPath: "region",
          trigger: "@",
          query: "Ja",
          triggerStart: 6,
          caret: 9,
          matches: [],
        },
      ),
    ).toEqual({
      kind: "mention",
      name: "Jane",
      target: {
        endOffset: 9,
        regionPath: "region",
        startOffset: 6,
      },
      trailingText: " ",
      userId: "u-jane",
    });
  });

  test("treats identified at-trigger items as user mentions", () => {
    expect(
      resolveDocumentCompletionApplication(
        { label: "Jane", id: "u-jane" },
        {
          regionPath: "region",
          trigger: "@",
          query: "Ja",
          triggerStart: 6,
          caret: 9,
          matches: [],
        },
      ).kind,
    ).toBe("mention");
  });

  test("routes emoji completion items to text replacement", () => {
    expect(
      resolveDocumentCompletionApplication(
        { label: "fire", icon: "🔥", insertText: "🔥" },
        {
          regionPath: "region",
          trigger: ":",
          query: "fi",
          triggerStart: 6,
          caret: 9,
          matches: [],
        },
      ),
    ).toEqual({
      endOffset: 9,
      kind: "text",
      startOffset: 6,
      text: "🔥",
    });
  });
});
