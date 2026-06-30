import { describe, expect, test } from "bun:test";
import {
  equalDocumentCompletions,
  resolveDocumentCompletionApplication,
  resolveDocumentCompletionContext,
} from "@/component/completions/document-completions";
import type { CompletionSource } from "@/component/completions/completions";
import { getPath, placeAt, selectIn, setup } from "@test/editor/helpers";

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
    const path = getPath(state, "Hello @Ja");
    const active = resolveDocumentCompletionContext(placeAt(state, path, "end"), [mentionSource]);

    expect(active).toEqual({
      path: path.path,
      trigger: "@",
      query: "Ja",
      triggerStart: 6,
      caret: 9,
      matches: [{ label: "Jane", id: "u-jane" }],
    });
  });

  test("returns null for expanded selections", () => {
    const state = setup("Hello @Ja\n");
    const path = getPath(state, "Hello @Ja");

    expect(
      resolveDocumentCompletionContext(selectIn(state, path, 6, 9), [mentionSource]),
    ).toBeNull();
  });

  test("uses the focused path text rather than document-global offsets", () => {
    const state = setup("Before @No\n\nSecond :sp\n");
    const path = getPath(state, "Second :sp");
    const active = resolveDocumentCompletionContext(placeAt(state, path, "end"), [
      mentionSource,
      emojiSource,
    ]);

    expect(active).toEqual({
      path: path.path,
      trigger: ":",
      query: "sp",
      triggerStart: 7,
      caret: 10,
      matches: [{ label: "sparkles" }],
    });
  });

  test("returns null when no source matches the path-local trigger", () => {
    const state = setup("Hello :sp\n");
    const path = getPath(state, "Hello :sp");

    expect(
      resolveDocumentCompletionContext(placeAt(state, path, "end"), [mentionSource]),
    ).toBeNull();
  });
});

describe("equalDocumentCompletions", () => {
  test("compares completion item insertion metadata", () => {
    const base = {
      path: "path",
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
          path: "path",
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
        path: "path",
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
          path: "path",
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
          path: "path",
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
